interface Env {
  WHISK_KV: KVNamespace;
}

// GET /api/plan?week=YYYY-WXX
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const week = url.searchParams.get("week") ?? "current";
  const plan = await env.WHISK_KV.get(`plan:${week}`, "json");
  return new Response(JSON.stringify(plan), {
    headers: { "Content-Type": "application/json" },
  });
};

// PUT /api/plan
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as { id: string };
  await env.WHISK_KV.put(`plan:${body.id}`, JSON.stringify(body));
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
};
