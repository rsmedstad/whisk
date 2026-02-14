interface Env {
  WHISK_KV: KVNamespace;
}

interface RecipeIndexEntry {
  id: string;
  title: string;
  tags: string[];
  cuisine?: string;
  favorite: boolean;
  updatedAt: string;
  thumbnailUrl?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  description?: string;
}

// GET /api/recipes - List all recipes (returns index)
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const index = await env.WHISK_KV.get("recipes:index", "json");
  return new Response(JSON.stringify(index ?? []), {
    headers: { "Content-Type": "application/json" },
  });
};

// POST /api/recipes - Create a new recipe
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = `r_${crypto.randomUUID().split("-")[0]}`;
    const now = new Date().toISOString();

    const recipe = {
      ...body,
      id,
      createdAt: now,
      updatedAt: now,
    } as Record<string, unknown>;

    // Store full recipe
    await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(recipe));

    // Update index
    const index =
      ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[]) ??
      [];

    const entry: RecipeIndexEntry = {
      id,
      title: recipe.title as string,
      tags: (recipe.tags as string[]) ?? [],
      cuisine: recipe.cuisine as string | undefined,
      favorite: (recipe.favorite as boolean) ?? false,
      updatedAt: now,
      thumbnailUrl: recipe.thumbnailUrl as string | undefined,
      prepTime: recipe.prepTime as number | undefined,
      cookTime: recipe.cookTime as number | undefined,
      servings: recipe.servings as number | undefined,
      description: recipe.description as string | undefined,
    };

    index.unshift(entry);
    await env.WHISK_KV.put("recipes:index", JSON.stringify(index));

    return new Response(JSON.stringify(recipe), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Failed to create recipe" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
