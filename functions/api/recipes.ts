import { upsertRecipeEmbedding, recipeToEmbeddingInput } from "../lib/embeddings";
import { readJsonBody, normalizeRecipeInput } from "../lib/recipe-input";

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
  wantToMake?: boolean;
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
    const body = await readJsonBody(request);
    if (!body.ok) {
      return new Response(JSON.stringify({ error: body.error }), {
        status: body.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const normalized = normalizeRecipeInput(body.data);
    if (!normalized) {
      return new Response(JSON.stringify({ error: "Recipe title is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const id = `r_${crypto.randomUUID().split("-")[0]}`;
    const now = new Date().toISOString();
    const userId = (data as Record<string, string>).userId;

    // If this user favorited the recipe at creation, track in favoritedBy
    const favoritedBy: string[] = normalized.favorite && userId ? [userId] : [];

    const recipe = {
      ...normalized,
      id,
      favoritedBy,
      createdAt: now,
      updatedAt: now,
      createdBy: userId ?? undefined,
    };

    await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(recipe));

    // Update index
    const index =
      ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[]) ??
      [];

    const ingredientCount = recipe.ingredients.length;
    const stepCount = recipe.steps.length;
    const totalMinutes = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0);

    const entry: RecipeIndexEntry = {
      id,
      title: recipe.title,
      tags: recipe.tags,
      cuisine: recipe.cuisine,
      favorite: normalized.favorite,
      favoritedBy,
      wantToMake: normalized.wantToMake,
      updatedAt: now,
      thumbnailUrl: recipe.thumbnailUrl,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      servings: recipe.servings,
      description: recipe.description,
      ingredientCount,
      stepCount,
      difficulty: computeDifficulty(totalMinutes, ingredientCount, stepCount),
      ingredientNames: recipe.ingredients.map((i) => i.name).slice(0, 30),
      sourceUrl: (recipe.source as { url?: string } | undefined)?.url,
      sourceRating: recipe.sourceRating,
      sourceRatingCount: recipe.sourceRatingCount,
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
