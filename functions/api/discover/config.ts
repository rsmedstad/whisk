import type { Env, DiscoverConfig } from "../../../src/types";

const KV_KEY = "discover_config";

/** Default sources — pre-populated for new installs */
const DEFAULT_CONFIG: DiscoverConfig = {
  sources: [
    {
      id: "nyt",
      label: "NYT Cooking",
      url: "https://cooking.nytimes.com/",
      enabled: true,
    },
    {
      id: "allrecipes",
      label: "AllRecipes",
      url: "https://www.allrecipes.com/",
      enabled: true,
    },
    {
      id: "seriouseats",
      label: "Serious Eats",
      url: "https://www.seriouseats.com/",
      enabled: true,
    },
  ],
  expirationEnabled: true,
  itemLifetimeDays: 7,
  refreshIntervalDays: 2,
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const config = await env.WHISK_KV.get<DiscoverConfig>(KV_KEY, "json");
  return Response.json(config ?? DEFAULT_CONFIG);
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as Partial<DiscoverConfig>;

  // Merge with existing config (or defaults)
  const existing = await env.WHISK_KV.get<DiscoverConfig>(KV_KEY, "json") ?? DEFAULT_CONFIG;

  const updated: DiscoverConfig = {
    sources: body.sources ?? existing.sources,
    expirationEnabled: body.expirationEnabled ?? existing.expirationEnabled,
    itemLifetimeDays: body.itemLifetimeDays ?? existing.itemLifetimeDays,
    refreshIntervalDays: body.refreshIntervalDays ?? existing.refreshIntervalDays,
  };

  // Cap at 10 sources
  if (updated.sources.length > 10) {
    return new Response(
      JSON.stringify({ error: "Maximum 10 sources allowed" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate sources have required fields
  for (const src of updated.sources) {
    if (!src.id || !src.url || !src.label) {
      return new Response(
        JSON.stringify({ error: "Each source needs id, label, and url" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    // Auto-generate id from label if missing
    if (!src.id) {
      src.id = src.label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20);
    }
  }

  await env.WHISK_KV.put(KV_KEY, JSON.stringify(updated));
  return Response.json(updated);
};
