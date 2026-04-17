import type { Recipe } from "../../../src/types";

interface Env {
  WHISK_KV: KVNamespace;
}

// Public-safe subset of Recipe. Excludes household-scoped fields like
// createdBy, createdAt, updatedAt, lastViewedAt, favoritedBy, shareToken,
// ratings, cookedCount, lastCookedAt, wantToMake.
type PublicRecipe = Pick<
  Recipe,
  | "id"
  | "title"
  | "description"
  | "ingredients"
  | "steps"
  | "photos"
  | "thumbnailUrl"
  | "videoUrl"
  | "source"
  | "tags"
  | "cuisine"
  | "prepTime"
  | "cookTime"
  | "servings"
  | "yield"
  | "difficulty"
  | "sourceRating"
  | "sourceRatingCount"
>;

function sanitizeRecipe(recipe: Recipe): PublicRecipe {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    photos: recipe.photos,
    thumbnailUrl: recipe.thumbnailUrl,
    videoUrl: recipe.videoUrl,
    tags: recipe.tags,
    cuisine: recipe.cuisine,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    servings: recipe.servings,
    yield: recipe.yield,
    difficulty: recipe.difficulty,
    sourceRating: recipe.sourceRating,
    sourceRatingCount: recipe.sourceRatingCount,
    source: recipe.source,
  };
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

  const recipe = (await env.WHISK_KV.get(`recipe:${share.recipeId}`, "json")) as Recipe | null;

  if (!recipe) {
    return new Response(JSON.stringify({ error: "Recipe not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(sanitizeRecipe(recipe)), {
    headers: { "Content-Type": "application/json" },
  });
};
