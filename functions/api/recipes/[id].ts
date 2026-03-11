import { upsertRecipeEmbedding, recipeToEmbeddingInput } from "../../lib/embeddings";

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
  cookedCount?: number;
  lastCookedAt?: string;
  avgRating?: number;
  ratingCount?: number;
  ingredientCount?: number;
  stepCount?: number;
  difficulty?: "easy" | "medium" | "hard";
  ingredientNames?: string[];
}

function computeDifficulty(totalMinutes: number, ingredientCount: number, stepCount: number): "easy" | "medium" | "hard" {
  const t = totalMinutes <= 0 ? 1 : totalMinutes <= 35 ? 0 : totalMinutes <= 60 ? 1 : 2;
  const i = ingredientCount <= 7 ? 0 : ingredientCount <= 12 ? 1 : 2;
  const s = stepCount <= 5 ? 0 : stepCount <= 10 ? 1 : 2;
  const score = t + i + s;
  return score <= 2 ? "easy" : score <= 4 ? "medium" : "hard";
}

function computeAvgRating(ratings: Record<string, number> | undefined): number | undefined {
  if (!ratings) return undefined;
  const values = Object.values(ratings);
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
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
  waitUntil,
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

  // Handle per-user rating
  if ("rating" in updates && userId) {
    const ratings = (existing.ratings as Record<string, number>) ?? {};
    const ratingValue = updates.rating as number;
    if (ratingValue >= 1 && ratingValue <= 5) {
      ratings[userId] = ratingValue;
    } else if (ratingValue === 0) {
      delete ratings[userId];
    }
    updates.ratings = ratings;
    delete updates.rating; // don't store the per-request field
  }

  const updated: Record<string, unknown> = { ...existing, ...updates, updatedAt: now };

  await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(updated));

  // Update index entry
  const index =
    ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[]) ?? [];

  const newIndex = index.map((entry) => {
    if (entry.id !== id) return entry;
    const ingCount = Array.isArray(updated.ingredients) ? (updated.ingredients as unknown[]).length : entry.ingredientCount ?? 0;
    const stpCount = Array.isArray(updated.steps) ? (updated.steps as unknown[]).length : entry.stepCount ?? 0;
    const totalMin = ((updated.prepTime as number) ?? 0) + ((updated.cookTime as number) ?? 0);
    return {
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
      cookedCount: updated.cookedCount as number | undefined,
      lastCookedAt: updated.lastCookedAt as string | undefined,
      avgRating: computeAvgRating(updated.ratings as Record<string, number> | undefined),
      ratingCount: Object.keys((updated.ratings as Record<string, number>) ?? {}).length || undefined,
      ingredientCount: ingCount,
      stepCount: stpCount,
      difficulty: computeDifficulty(totalMin, ingCount, stpCount),
      ingredientNames: Array.isArray(updated.ingredients)
        ? (updated.ingredients as { name?: string }[]).map((i) => i.name).filter((n): n is string => !!n).slice(0, 30)
        : entry.ingredientNames,
    };
  });

  await env.WHISK_KV.put("recipes:index", JSON.stringify(newIndex));

  // Re-embed in Vectorize if title, tags, ingredients, or description changed
  if (env.AI && env.VECTORIZE && ("title" in updates || "tags" in updates || "ingredients" in updates || "description" in updates || "cuisine" in updates)) {
    waitUntil(upsertRecipeEmbedding(env.AI, env.VECTORIZE, recipeToEmbeddingInput(updated)).catch(() => {}));
  }

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
export const onRequestDelete: PagesFunction<Env> = async ({ params, env, waitUntil }) => {
  const id = params.id as string;
  await env.WHISK_KV.delete(`recipe:${id}`);

  // Remove from index
  const index =
    ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[]) ?? [];
  const newIndex = index.filter((entry) => entry.id !== id);
  await env.WHISK_KV.put("recipes:index", JSON.stringify(newIndex));

  // Remove from Vectorize
  if (env.VECTORIZE) {
    waitUntil(env.VECTORIZE.deleteByIds([id]).catch(() => {}));
  }

  return new Response(null, { status: 204 });
};
