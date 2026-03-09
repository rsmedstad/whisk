interface Env {
  WHISK_KV: KVNamespace;
}

interface CronConfig {
  zip: string;
  preferredStores: string[];
  enabled: boolean;
}

const KV_KEY = "cron:deals_config";

// GET /api/deals/config — returns the current cron deals config
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const raw = await env.WHISK_KV.get(KV_KEY);
  const config: CronConfig = raw
    ? JSON.parse(raw)
    : { zip: "", preferredStores: [], enabled: false };
  return new Response(JSON.stringify(config), {
    headers: { "Content-Type": "application/json" },
  });
};

// PUT /api/deals/config — save the cron deals config
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as Partial<CronConfig>;
  const config: CronConfig = {
    zip: body.zip ?? "",
    preferredStores: body.preferredStores ?? [],
    enabled: body.enabled ?? false,
  };
  await env.WHISK_KV.put(KV_KEY, JSON.stringify(config));
  return new Response(JSON.stringify(config), {
    headers: { "Content-Type": "application/json" },
  });
};
