interface Env {
  WHISK_KV: KVNamespace;
}

interface RecipeIndexEntry {
  id: string;
  title: string;
  tags: string[];
  cuisine?: string;
  favorite: boolean;
  favoritedBy?: string[];
  updatedAt: string;
  thumbnailUrl?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  description?: string;
}

// GET /api/recipes/:id
export const onRequestGet: PagesFunction<Env> = async ({ params, env, data }) => {
  const id = params.id as string;
  const recipe = (await env.WHISK_KV.get(`recipe:${id}`, "json")) as Record<string, unknown> | null;

  if (!recipe) {
    return new Response(JSON.stringify({ error: "Recipe not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Update lastViewedAt
  const updated: Record<string, unknown> = { ...recipe, lastViewedAt: new Date().toISOString() };
  await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(updated));

  // Resolve favorite for requesting user
  const userId = (data as Record<string, string>).userId;
  if (userId) {
    const favoritedBy = (updated.favoritedBy as string[]) ?? [];
    updated.favorite = favoritedBy.includes(userId);
  }

  return new Response(JSON.stringify(updated), {
    headers: { "Content-Type": "application/json" },
  });
};

// PUT /api/recipes/:id
export const onRequestPut: PagesFunction<Env> = async ({
  params,
  request,
  env,
  data,
}) => {
  const id = params.id as string;
  const existing = (await env.WHISK_KV.get(`recipe:${id}`, "json")) as Record<string, unknown> | null;

  if (!existing) {
    return new Response(JSON.stringify({ error: "Recipe not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updates = (await request.json()) as Record<string, unknown>;
  const now = new Date().toISOString();
  const userId = (data as Record<string, string>).userId;

  // Handle per-user favorite toggling
  if ("favorite" in updates && userId) {
    const favoritedBy = new Set((existing.favoritedBy as string[]) ?? []);
    if (updates.favorite) {
      favoritedBy.add(userId);
    } else {
      favoritedBy.delete(userId);
    }
    updates.favoritedBy = [...favoritedBy];
    // Legacy fallback: favorite is true if anyone has favorited
    updates.favorite = favoritedBy.size > 0;
  }

  const updated: Record<string, unknown> = { ...existing, ...updates, updatedAt: now };

  await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(updated));

  // Update index entry
  const index =
    ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[]) ?? [];

  const newIndex = index.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          title: (updated.title as string) ?? entry.title,
          tags: (updated.tags as string[]) ?? entry.tags,
          cuisine: updated.cuisine as string | undefined,
          favorite: (updated.favorite as boolean) ?? entry.favorite,
          favoritedBy: (updated.favoritedBy as string[]) ?? entry.favoritedBy,
          updatedAt: now,
          thumbnailUrl: updated.thumbnailUrl as string | undefined,
          prepTime: updated.prepTime as number | undefined,
          cookTime: updated.cookTime as number | undefined,
          servings: updated.servings as number | undefined,
          description: updated.description as string | undefined,
        }
      : entry
  );

  await env.WHISK_KV.put("recipes:index", JSON.stringify(newIndex));

  // Resolve favorite for the requesting user in the response
  if (userId) {
    const favoritedBy = (updated.favoritedBy as string[]) ?? [];
    updated.favorite = favoritedBy.includes(userId);
  }

  return new Response(JSON.stringify(updated), {
    headers: { "Content-Type": "application/json" },
  });
};

// DELETE /api/recipes/:id
export const onRequestDelete: PagesFunction<Env> = async ({ params, env }) => {
  const id = params.id as string;
  await env.WHISK_KV.delete(`recipe:${id}`);

  // Remove from index
  const index =
    ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[]) ?? [];
  const newIndex = index.filter((entry) => entry.id !== id);
  await env.WHISK_KV.put("recipes:index", JSON.stringify(newIndex));

  return new Response(null, { status: 204 });
};
