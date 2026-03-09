interface Env {
  WHISK_KV: KVNamespace;
}

interface Store {
  id: string;
  name: string;
  adUrl?: string;
}

interface DealIndex {
  deals: unknown[];
  lastScanned: Record<string, string>;
  updatedAt: string;
}

// POST /api/deals/refresh — trigger deal scan for all configured stores with adUrls
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Load stores config
  const storesRaw = await env.WHISK_KV.get("stores:config");
  const stores: Store[] = storesRaw ? JSON.parse(storesRaw) : [];

  // Load current deal index
  const indexRaw = await env.WHISK_KV.get("deal_index");
  const index: DealIndex = indexRaw ? JSON.parse(indexRaw) : { deals: [], lastScanned: {}, updatedAt: "" };

  const today = new Date().toISOString().slice(0, 10);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Find stores that need refreshing
  const storesNeedingRefresh = stores.filter((store) => {
    if (!store.adUrl) return false;
    const lastScan = index.lastScanned[store.id];
    if (!lastScan) return true;
    return lastScan < oneDayAgo;
  });

  if (storesNeedingRefresh.length === 0) {
    return new Response(
      JSON.stringify({ refreshed: 0, message: "All stores are up to date" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Trigger scan for each store by calling the scan endpoint internally
  const origin = new URL(request.url).origin;
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
        body: JSON.stringify({
          storeId: store.id,
          url: store.adUrl,
        }),
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

  return new Response(
    JSON.stringify({
      refreshed,
      total: storesNeedingRefresh.length,
      errors: errors.length > 0 ? errors : undefined,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
};
