interface Env {
  WHISK_KV: KVNamespace;
}

// GET /api/tags
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const tags = await env.WHISK_KV.get("tags:index", "json");
  return new Response(JSON.stringify(tags), {
    headers: { "Content-Type": "application/json" },
  });
};

// PUT /api/tags
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json();
  await env.WHISK_KV.put("tags:index", JSON.stringify(body));
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
};
