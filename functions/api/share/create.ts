interface Env {
  WHISK_KV: KVNamespace;
}

// POST /api/share/create - Generate share token for a recipe
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { recipeId } = (await request.json()) as { recipeId: string };
    const recipe = (await env.WHISK_KV.get(`recipe:${recipeId}`, "json")) as Record<string, unknown> | null;

    if (!recipe) {
      return new Response(JSON.stringify({ error: "Recipe not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Reuse existing token if present
    if (recipe.shareToken) {
      return new Response(
        JSON.stringify({ token: recipe.shareToken }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate new token
    const tokenBytes = new Uint8Array(16);
    crypto.getRandomValues(tokenBytes);
    const token = btoa(String.fromCharCode(...tokenBytes))
      .replace(/[+/=]/g, "")
      .slice(0, 12);

    // Store share mapping
    await env.WHISK_KV.put(
      `share:${token}`,
      JSON.stringify({ recipeId, createdAt: new Date().toISOString() })
    );

    // Update recipe with share token
    recipe.shareToken = token;
    await env.WHISK_KV.put(`recipe:${recipeId}`, JSON.stringify(recipe));

    return new Response(JSON.stringify({ token }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to create share link" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
