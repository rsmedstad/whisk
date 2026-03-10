interface Env {
  WHISK_KV: KVNamespace;
}

interface FlippFlyer {
  id: number;
  merchant: string;
  merchant_id: number;
  name: string;
  categories: string[];
  valid_from: string;
  valid_to: string;
}

interface FlippItem {
  id: number;
  flyer_id: number;
  name: string;
  brand?: string;
  price?: string;
  current_price?: number;
  pre_price_text?: string;
  post_price_text?: string;
  sale_story?: string;
  valid_from: string;
  valid_to: string;
  cutout_image_url?: string;
  discount?: number;
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
  source: "flipp";
}

interface DealIndex {
  deals: StoredDeal[];
  lastScanned: Record<string, string>;
  updatedAt: string;
}

const FLIPP_BASE = "https://backflipp.wishabi.com/flipp";

// Major US grocery chains — normalized names for fuzzy matching.
// Stores matching this list (or with 2+ active flyers) are flagged as "popular".
const KNOWN_CHAINS = new Set([
  "aldi", "costco", "heb", "harristeeter", "hyve", "jewelosco",
  "kingsooper", "kroger", "lidl", "marianos", "meijer", "picknsave",
  "publix", "ralphs", "safeway", "samsclub", "shaws", "shoprite",
  "smiths", "sprouts", "staterbrothers", "stopshop", "target",
  "traderjoes", "vons", "walmart", "wegmans", "wholefoods",
  "winndixie", "wincofood", "foodlion", "giantfood", "gianteagle",
  "freshthyme", "petesfreshmarket", "caputos", "hmart", "freshmarket",
  "aldisud", "savemart", "foodcity", "pigglywiggly", "bjs",
]);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Normalize store name for fuzzy matching. */
function normalizeStoreName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Check if user's preferred store name matches a Flipp merchant name. */
function storeMatches(preferred: string, merchant: string): boolean {
  const a = normalizeStoreName(preferred);
  const b = normalizeStoreName(merchant);
  return b.includes(a) || a.includes(b);
}

/** Parse Flipp price fields into a normalized price + notes. */
function parseFlippPrice(item: FlippItem): { price: number; unit?: string; notes?: string } {
  // Try to get price from the price string or current_price
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

  // "2/" or "sale 3/" pattern — multi-buy pricing
  const multiMatch = pre.match(/(\d+)\s*\/\s*$/);
  if (multiMatch) {
    const qty = parseInt(multiMatch[1]!, 10);
    if (qty > 1 && price > 0) {
      unit = `${qty} for $${price.toFixed(2)}`;
      price = price / qty;
    }
  }

  // BOGO
  if (story.match(/buy\s*(one|1)\s*get\s*(one|1)\s*free/i) && price > 0) {
    notes = "BOGO";
    price = price / 2;
  }

  // Collect additional notes from post-price text
  if (post && !/^(ea\.?|\+)$/i.test(post)) {
    notes = [notes, post].filter(Boolean).join(" · ");
  }

  if (story && !notes?.includes("BOGO") && story.length < 60) {
    notes = [notes, story].filter(Boolean).join(" · ");
  }

  return { price, unit, notes };
}

/** Keywords indicating snacks, beverages, or non-food items we want to skip. */
const SKIP_KEYWORDS = [
  // Beverages
  "soda", "cola", "pepsi", "coke", "sprite", "fanta", "dr pepper", "mountain dew",
  "gatorade", "powerade", "energy drink", "red bull", "monster energy",
  "sparkling water", "la croix", "lacroix", "topo chico",
  "juice box", "capri sun", "kool-aid",
  "beer", "wine", "vodka", "whiskey", "bourbon", "tequila", "rum", "gin",
  "hard seltzer", "white claw", "truly", "smirnoff",
  "bottled water", "water bottles", "case of water",
  // Snacks
  "chips", "doritos", "cheetos", "fritos", "lays", "pringles", "ruffles", "tostitos",
  "crackers", "goldfish", "cheez-it", "ritz",
  "cookies", "oreo", "chips ahoy", "nutter butter",
  "candy", "chocolate bar", "gummy", "skittles", "m&m", "snickers", "reese",
  "popcorn", "microwave popcorn",
  "pretzels", "trail mix", "granola bar", "protein bar",
  // Non-food
  "paper towel", "toilet paper", "tissue", "napkin",
  "detergent", "laundry", "fabric softener", "dryer sheet",
  "dish soap", "dishwasher", "cleaning", "disinfectant", "bleach", "wipes",
  "trash bag", "garbage bag", "aluminum foil", "plastic wrap", "ziploc",
  "shampoo", "conditioner", "body wash", "soap bar", "deodorant", "toothpaste",
  "pet food", "dog food", "cat food", "cat litter",
  "diapers", "baby wipes",
  "batteries", "light bulb",
];

/** Check if a Flipp item name matches something we want to skip. */
function shouldSkipItem(name: string): boolean {
  const lower = name.toLowerCase();
  return SKIP_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Clean up a Flipp item name for display. */
function cleanItemName(name: string): string {
  return name
    .replace(/\s*,\s*or\s+.*$/i, "") // strip "or ..." alternatives
    .replace(/\s+/g, " ")
    .trim();
}

// GET /api/deals/flipp?zip=60601 — discover grocery stores near a zip code
// POST /api/deals/flipp { zip, stores } — fetch deals for preferred stores and merge into deal_index

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const url = new URL(request.url);
  const zip = url.searchParams.get("zip");
  if (!zip) return jsonResponse({ error: "zip parameter required" }, 400);

  try {
    const res = await fetch(
      `${FLIPP_BASE}/flyers?locale=en-us&postal_code=${encodeURIComponent(zip)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return jsonResponse({ error: `Flipp API returned ${res.status}` }, 502);

    const flyersData = await res.json();
    const flyers: FlippFlyer[] = Array.isArray(flyersData) ? flyersData : (flyersData as { flyers?: FlippFlyer[] }).flyers ?? [];

    // Filter to grocery flyers and deduplicate by merchant
    const groceryMerchants = new Map<number, { id: number; name: string; flyerCount: number; popular: boolean }>();
    for (const flyer of flyers) {
      if (!flyer.categories?.some((c) => c.toLowerCase().includes("grocer"))) continue;
      const existing = groceryMerchants.get(flyer.merchant_id);
      if (existing) {
        existing.flyerCount++;
      } else {
        const normalized = normalizeStoreName(flyer.merchant);
        const isKnownChain = [...KNOWN_CHAINS].some(
          (chain) => normalized.includes(chain) || chain.includes(normalized)
        );
        groceryMerchants.set(flyer.merchant_id, {
          id: flyer.merchant_id,
          name: flyer.merchant,
          flyerCount: 1,
          popular: isKnownChain,
        });
      }
    }

    // Mark stores with 2+ flyers as popular even if not in the known list
    for (const store of groceryMerchants.values()) {
      if (store.flyerCount >= 2) store.popular = true;
    }

    // Sort: popular first (alphabetical), then others (alphabetical)
    const stores = Array.from(groceryMerchants.values()).sort((a, b) => {
      if (a.popular !== b.popular) return a.popular ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return jsonResponse({ stores });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Failed to fetch stores" },
      502
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as { zip: string; stores: string[] };
  const { zip, stores: preferredStores } = body;

  if (!zip || !preferredStores?.length) {
    return jsonResponse({ error: "zip and stores[] required" }, 400);
  }

  try {
    // 1. Get all grocery flyers for this zip
    const flyersRes = await fetch(
      `${FLIPP_BASE}/flyers?locale=en-us&postal_code=${encodeURIComponent(zip)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!flyersRes.ok) return jsonResponse({ error: `Flipp API returned ${flyersRes.status}` }, 502);

    const flyersData = await flyersRes.json();
    const allFlyers: FlippFlyer[] = Array.isArray(flyersData) ? flyersData : (flyersData as { flyers?: FlippFlyer[] }).flyers ?? [];

    // 2. Match preferred stores to Flipp merchants
    const matchedFlyers: FlippFlyer[] = [];
    for (const flyer of allFlyers) {
      if (!flyer.categories?.some((c) => c.toLowerCase().includes("grocer"))) continue;
      if (preferredStores.some((pref) => storeMatches(pref, flyer.merchant))) {
        matchedFlyers.push(flyer);
      }
    }

    if (matchedFlyers.length === 0) {
      return jsonResponse({ deals: [], message: "No matching stores found in your area" });
    }

    // 3. Fetch items for each matched flyer (limit to 8 flyers to stay within subrequest limits)
    const flyersToFetch = matchedFlyers.slice(0, 8);
    const allDeals: StoredDeal[] = [];
    const now = new Date().toISOString();
    const lastScanned: Record<string, string> = {};

    const flyerFetches = flyersToFetch.map(async (flyer) => {
      try {
        const res = await fetch(
          `${FLIPP_BASE}/flyers/${flyer.id}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (!res.ok) return;

        const data = (await res.json()) as { items?: FlippItem[] };
        const items = data.items ?? [];
        const storeId = `flipp-${flyer.merchant_id}`;

        lastScanned[storeId] = now;

        for (const item of items) {
          if (!item.name?.trim()) continue;
          if (shouldSkipItem(item.name)) continue; // skip snacks, beverages, non-food

          const { price, unit, notes } = parseFlippPrice(item);
          if (price <= 0) continue; // skip items with no price

          allDeals.push({
            id: `flipp-${flyer.id}-${item.id}`,
            storeId,
            storeName: flyer.merchant,
            item: cleanItemName(item.name),
            price,
            unit,
            validFrom: flyer.valid_from?.slice(0, 10) ?? item.valid_from?.slice(0, 10) ?? "",
            validTo: flyer.valid_to?.slice(0, 10) ?? item.valid_to?.slice(0, 10) ?? "",
            notes,
            scannedAt: now,
            source: "flipp",
          });
        }
      } catch {
        // Skip failed flyers silently
      }
    });

    await Promise.all(flyerFetches);

    // 4. Merge into deal_index in KV — remove old Flipp deals, keep scan/manual deals
    const raw = await env.WHISK_KV.get("deal_index");
    const index: DealIndex = raw
      ? (JSON.parse(raw) as DealIndex)
      : { deals: [], lastScanned: {}, updatedAt: "" };

    // Remove old flipp-sourced deals
    index.deals = index.deals.filter(
      (d) => !(d as StoredDeal).source || (d as StoredDeal).source !== "flipp"
    );

    // Add new flipp deals
    index.deals.push(...allDeals);

    // Merge lastScanned timestamps
    Object.assign(index.lastScanned, lastScanned);
    index.updatedAt = now;

    await env.WHISK_KV.put("deal_index", JSON.stringify(index));

    return jsonResponse({
      deals: allDeals.length,
      stores: Object.keys(lastScanned).length,
      message: `Found ${allDeals.length} deals from ${Object.keys(lastScanned).length} store(s)`,
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Failed to fetch deals" },
      502
    );
  }
};
