import { upsertRecipeEmbedding, recipeToEmbeddingInput } from "../lib/embeddings";

interface Env {
  WHISK_KV: KVNamespace;
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
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
  ingredientCount?: number;
  stepCount?: number;
  difficulty?: "easy" | "medium" | "hard";
  ingredientNames?: string[];
  sourceUrl?: string;
  sourceRating?: number;
  sourceRatingCount?: number;
}

function computeDifficulty(totalMinutes: number, ingredientCount: number, stepCount: number): "easy" | "medium" | "hard" {
  const t = totalMinutes <= 0 ? 1 : totalMinutes <= 35 ? 0 : totalMinutes <= 60 ? 1 : 2;
  const i = ingredientCount <= 7 ? 0 : ingredientCount <= 12 ? 1 : 2;
  const s = stepCount <= 5 ? 0 : stepCount <= 10 ? 1 : 2;
  const score = t + i + s;
  return score <= 2 ? "easy" : score <= 4 ? "medium" : "hard";
}

// GET /api/recipes - List all recipes (returns index with per-user favorites)
export const onRequestGet: PagesFunction<Env> = async ({ env, data }) => {
  const index =
    ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[]) ?? [];

  const userId = (data as Record<string, string>).userId;

  // Resolve favorites per user and strip favoritedBy from response
  const resolved = index.map(({ favoritedBy, ...entry }) => ({
    ...entry,
    favorite: userId
      ? (favoritedBy ?? []).includes(userId)
      : entry.favorite,
  }));

  return new Response(JSON.stringify(resolved), {
    headers: { "Content-Type": "application/json" },
  });
};

// POST /api/recipes - Create a new recipe
export const onRequestPost: PagesFunction<Env> = async ({ request, env, data, waitUntil }) => {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = `r_${crypto.randomUUID().split("-")[0]}`;
    const now = new Date().toISOString();
    const userId = (data as Record<string, string>).userId;

    // If this user favorited the recipe at creation, track in favoritedBy
    const isFavorite = (body.favorite as boolean) ?? false;
    const favoritedBy: string[] = isFavorite && userId ? [userId] : [];

    const recipe = {
      ...body,
      id,
      favoritedBy,
      createdAt: now,
      updatedAt: now,
      createdBy: userId ?? undefined,
    } as Record<string, unknown>;

    await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(recipe));

    // Update index
    const index =
      ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[]) ??
      [];

    const ingredientCount = Array.isArray(recipe.ingredients) ? (recipe.ingredients as unknown[]).length : 0;
    const stepCount = Array.isArray(recipe.steps) ? (recipe.steps as unknown[]).length : 0;
    const totalMinutes = ((recipe.prepTime as number) ?? 0) + ((recipe.cookTime as number) ?? 0);

    const entry: RecipeIndexEntry = {
      id,
      title: recipe.title as string,
      tags: (recipe.tags as string[]) ?? [],
      cuisine: recipe.cuisine as string | undefined,
      favorite: isFavorite,
      favoritedBy,
      updatedAt: now,
      thumbnailUrl: recipe.thumbnailUrl as string | undefined,
      prepTime: recipe.prepTime as number | undefined,
      cookTime: recipe.cookTime as number | undefined,
      servings: recipe.servings as number | undefined,
      description: recipe.description as string | undefined,
      ingredientCount,
      stepCount,
      difficulty: computeDifficulty(totalMinutes, ingredientCount, stepCount),
      ingredientNames: Array.isArray(recipe.ingredients)
        ? (recipe.ingredients as { name?: string }[]).map((i) => i.name).filter((n): n is string => !!n).slice(0, 30)
        : undefined,
      sourceUrl: (recipe.source as { url?: string } | undefined)?.url,
      sourceRating: recipe.sourceRating as number | undefined,
      sourceRatingCount: recipe.sourceRatingCount as number | undefined,
    };

    index.unshift(entry);
    await env.WHISK_KV.put("recipes:index", JSON.stringify(index));

    // Upsert embedding into Vectorize (fire-and-forget)
    if (env.AI && env.VECTORIZE) {
      waitUntil(upsertRecipeEmbedding(env.AI, env.VECTORIZE, recipeToEmbeddingInput(recipe)).catch(() => {}));
    }

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
