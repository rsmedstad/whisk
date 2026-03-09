import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  callVisionAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
  CRON_SECRET?: string;
}

interface CronConfig {
  zip: string;
  preferredStores: string[];
  enabled: boolean;
}

interface Store {
  id: string;
  name: string;
  adUrl?: string;
}

interface StoredDeal {
  id: string;
  storeId: string;
  storeName: string;
  item: string;
  price: number;
  originalPrice?: number;
  unit?: string;
  category?: string;
  validFrom: string;
  validTo: string;
  notes?: string;
  scannedAt: string;
  source?: "flipp" | "scan" | "manual";
}

interface DealIndex {
  deals: StoredDeal[];
  lastScanned: Record<string, string>;
  updatedAt: string;
}

interface FlippFlyer {
  id: number;
  merchant: string;
  merchant_id: number;
  categories: string[];
  valid_from: string;
  valid_to: string;
}

interface FlippItem {
  id: number;
  flyer_id: number;
  name: string;
  price?: string;
  current_price?: number;
  pre_price_text?: string;
  post_price_text?: string;
  sale_story?: string;
  valid_from: string;
  valid_to: string;
}

const FLIPP_BASE = "https://backflipp.wishabi.com/flipp";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeStoreName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function storeMatches(preferred: string, merchant: string): boolean {
  const a = normalizeStoreName(preferred);
  const b = normalizeStoreName(merchant);
  return b.includes(a) || a.includes(b);
}

function parseFlippPrice(item: FlippItem): { price: number; unit?: string; notes?: string } {
  let price = 0;
  if (item.current_price != null) {
    price = item.current_price;
  } else if (item.price) {
    const match = item.price.replace(/[^0-9.]/g, "");
    price = parseFloat(match) || 0;
  }

  let unit: string | undefined;
  let notes: string | undefined;

  const pre = (item.pre_price_text ?? "").trim();
  const post = (item.post_price_text ?? "").trim();
  const story = (item.sale_story ?? "").trim();

  const multiMatch = pre.match(/(\d+)\s*\/\s*$/);
  if (multiMatch) {
    const qty = parseInt(multiMatch[1]!, 10);
    if (qty > 1 && price > 0) {
      unit = `${qty} for $${price.toFixed(2)}`;
      price = price / qty;
    }
  }

  if (story.match(/buy\s*(one|1)\s*get\s*(one|1)\s*free/i) && price > 0) {
    notes = "BOGO";
    price = price / 2;
  }

  if (post && !/^(ea\.?|\+)$/i.test(post)) {
    notes = [notes, post].filter(Boolean).join(" · ");
  }

  if (story && !notes?.includes("BOGO") && story.length < 60) {
    notes = [notes, story].filter(Boolean).join(" · ");
  }

  return { price, unit, notes };
}

function cleanItemName(name: string): string {
  return name
    .replace(/\s*,\s*or\s+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// POST /api/deals/cron — run full deal refresh (Flipp + URL scans)
// Auth: CRON_SECRET header or standard Bearer token (middleware allows unauthenticated, we check CRON_SECRET here)
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Verify authorization: either CRON_SECRET header or regular auth token
  const cronSecret = request.headers.get("X-Cron-Secret");
  const authHeader = request.headers.get("Authorization");

  if (env.CRON_SECRET) {
    // If CRON_SECRET is configured, require it for unauthenticated requests
    if (!cronSecret && !authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    if (cronSecret && cronSecret !== env.CRON_SECRET) {
      return jsonResponse({ error: "Invalid cron secret" }, 403);
    }
  } else if (!authHeader) {
    // No CRON_SECRET configured, require regular auth
    return jsonResponse({ error: "Unauthorized — set CRON_SECRET env var for cron access" }, 401);
  }

  const results: { flipp?: { deals: number; stores: number }; urlScans?: { refreshed: number; errors?: string[] }; error?: string } = {};

  // 1. Refresh Flipp deals from cron config stored in KV
  try {
    const configRaw = await env.WHISK_KV.get("cron:deals_config");
    const config: CronConfig | null = configRaw ? JSON.parse(configRaw) : null;

    if (config?.enabled && config.zip && config.preferredStores.length > 0) {
      const flippResult = await refreshFlippDeals(env, config.zip, config.preferredStores);
      results.flipp = flippResult;
    }
  } catch (err) {
    results.error = `Flipp refresh failed: ${err instanceof Error ? err.message : "unknown"}`;
  }

  // 2. Refresh URL-based store ad scans
  try {
    const urlResult = await refreshUrlScans(request, env);
    results.urlScans = urlResult;
  } catch (err) {
    const msg = `URL scan refresh failed: ${err instanceof Error ? err.message : "unknown"}`;
    results.error = results.error ? `${results.error}; ${msg}` : msg;
  }

  return jsonResponse({
    ...results,
    timestamp: new Date().toISOString(),
  });
};

async function refreshFlippDeals(
  env: Env,
  zip: string,
  preferredStores: string[]
): Promise<{ deals: number; stores: number }> {
  // Fetch grocery flyers
  const flyersRes = await fetch(
    `${FLIPP_BASE}/flyers?locale=en-us&postal_code=${encodeURIComponent(zip)}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!flyersRes.ok) throw new Error(`Flipp API returned ${flyersRes.status}`);

  const allFlyers = (await flyersRes.json()) as FlippFlyer[];

  // Match preferred stores
  const matchedFlyers = allFlyers.filter(
    (f) =>
      f.categories?.some((c) => c.toLowerCase().includes("grocer")) &&
      preferredStores.some((pref) => storeMatches(pref, f.merchant))
  );

  if (matchedFlyers.length === 0) return { deals: 0, stores: 0 };

  const flyersToFetch = matchedFlyers.slice(0, 8);
  const allDeals: StoredDeal[] = [];
  const now = new Date().toISOString();
  const lastScanned: Record<string, string> = {};

  await Promise.all(
    flyersToFetch.map(async (flyer) => {
      try {
        const res = await fetch(`${FLIPP_BASE}/flyers/${flyer.id}`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return;

        const data = (await res.json()) as { items?: FlippItem[] };
        const items = data.items ?? [];
        const storeId = `flipp-${flyer.merchant_id}`;
        lastScanned[storeId] = now;

        for (const item of items) {
          if (!item.name?.trim()) continue;
          const { price, unit, notes } = parseFlippPrice(item);
          if (price <= 0) continue;

          allDeals.push({
            id: `flipp-${flyer.id}-${item.id}`,
            storeId,
            storeName: flyer.merchant,
            item: cleanItemName(item.name),
            price,
            unit,
            validFrom: flyer.valid_from?.slice(0, 10) ?? "",
            validTo: flyer.valid_to?.slice(0, 10) ?? "",
            notes,
            scannedAt: now,
            source: "flipp",
          });
        }
      } catch {
        // Skip failed flyers
      }
    })
  );

  // Merge into deal_index
  const raw = await env.WHISK_KV.get("deal_index");
  const index: DealIndex = raw
    ? (JSON.parse(raw) as DealIndex)
    : { deals: [], lastScanned: {}, updatedAt: "" };

  // Remove old flipp deals, add new
  index.deals = index.deals.filter((d) => d.source !== "flipp");
  index.deals.push(...allDeals);
  Object.assign(index.lastScanned, lastScanned);
  index.updatedAt = now;

  await env.WHISK_KV.put("deal_index", JSON.stringify(index));

  return { deals: allDeals.length, stores: Object.keys(lastScanned).length };
}

async function refreshUrlScans(
  request: Request,
  env: Env
): Promise<{ refreshed: number; errors?: string[] }> {
  const storesRaw = await env.WHISK_KV.get("stores:config");
  const stores: Store[] = storesRaw ? JSON.parse(storesRaw) : [];

  const indexRaw = await env.WHISK_KV.get("deal_index");
  const index: DealIndex = indexRaw
    ? JSON.parse(indexRaw)
    : { deals: [], lastScanned: {}, updatedAt: "" };

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const storesNeedingRefresh = stores.filter((store) => {
    if (!store.adUrl) return false;
    const lastScan = index.lastScanned[store.id];
    return !lastScan || lastScan < oneDayAgo;
  });

  if (storesNeedingRefresh.length === 0) return { refreshed: 0 };

  const origin = new URL(request.url).origin;
  // Use the auth header if present, or create one from a session for internal calls
  const authHeader = request.headers.get("Authorization") ?? "";
  let refreshed = 0;
  const errors: string[] = [];

  for (const store of storesNeedingRefresh) {
    try {
      const res = await fetch(`${origin}/api/deals/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ storeId: store.id, url: store.adUrl }),
      });
      if (res.ok) {
        refreshed++;
      } else {
        errors.push(`${store.name}: ${res.status}`);
      }
    } catch (err) {
      errors.push(`${store.name}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  return { refreshed, errors: errors.length > 0 ? errors : undefined };
}
