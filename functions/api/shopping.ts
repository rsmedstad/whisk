interface Env {
  WHISK_KV: KVNamespace;
}

// GET /api/shopping
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const list = await env.WHISK_KV.get("shopping:current", "json");
  return new Response(JSON.stringify(list ?? { id: "current", items: [], updatedAt: new Date().toISOString() }), {
    headers: { "Content-Type": "application/json" },
  });
};

// PUT /api/shopping
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json();
  await env.WHISK_KV.put("shopping:current", JSON.stringify(body));
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
};
