interface Env {
  WHISK_KV: KVNamespace;
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
}

interface DealIndex {
  deals: StoredDeal[];
  lastScanned: Record<string, string>;
  updatedAt: string;
}

// GET /api/deals — returns all active (non-expired) deals
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const storeFilter = url.searchParams.get("store");

  const raw = await env.WHISK_KV.get("deal_index");
  if (!raw) {
    return new Response(JSON.stringify({ deals: [], lastScanned: {}, updatedAt: "" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const index = JSON.parse(raw) as DealIndex;
  const today = new Date().toISOString().slice(0, 10);

  // Filter expired deals and non-fresh categories (legacy data cleanup)
  const freshCategories = new Set(["produce", "dairy", "meat", "pantry", "frozen", "bakery"]);
  let activeDeals = index.deals.filter(
    (d) => d.validTo >= today && (!d.category || freshCategories.has(d.category))
  );

  // Filter by store if requested
  if (storeFilter) {
    activeDeals = activeDeals.filter((d) => d.storeId === storeFilter);
  }

  return new Response(
    JSON.stringify({ ...index, deals: activeDeals }),
    { headers: { "Content-Type": "application/json" } }
  );
};
