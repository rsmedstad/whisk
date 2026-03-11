interface Env {
  WHISK_KV: KVNamespace;
}

// GET /api/ai/logs — Retrieve recent AI interaction logs for debugging
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const logs = await env.WHISK_KV.get("ai_logs", "json");
  return new Response(JSON.stringify(logs ?? []), {
    headers: { "Content-Type": "application/json" },
  });
};

// DELETE /api/ai/logs — Clear AI logs
export const onRequestDelete: PagesFunction<Env> = async ({ env }) => {
  await env.WHISK_KV.delete("ai_logs");
  return new Response(null, { status: 204 });
};
