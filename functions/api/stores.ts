interface Env {
  WHISK_KV: KVNamespace;
}

const KV_KEY = "stores:config";

// GET /api/stores — returns configured stores
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const raw = await env.WHISK_KV.get(KV_KEY);
  const stores = raw ? JSON.parse(raw) : [];
  return new Response(JSON.stringify(stores), {
    headers: { "Content-Type": "application/json" },
  });
};

// PUT /api/stores — save store configuration
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const stores = await request.json();
  if (!Array.isArray(stores)) {
    return new Response(JSON.stringify({ error: "Expected an array of stores" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  await env.WHISK_KV.put(KV_KEY, JSON.stringify(stores));
  return new Response(JSON.stringify(stores), {
    headers: { "Content-Type": "application/json" },
  });
};
