interface Env {
  WHISK_KV: KVNamespace;
}

// GET /api/share/:token - Public recipe view (no auth required)
export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const token = params.token as string;

  const share = (await env.WHISK_KV.get(`share:${token}`, "json")) as { recipeId: string } | null;

  if (!share) {
    return new Response(JSON.stringify({ error: "Share link not found or expired" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const recipe = await env.WHISK_KV.get(`recipe:${share.recipeId}`, "json");

  if (!recipe) {
    return new Response(JSON.stringify({ error: "Recipe not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(recipe), {
    headers: { "Content-Type": "application/json" },
  });
};
