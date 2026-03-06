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

interface Recipe {
  id: string;
  tags: string[];
  prepTime?: number;
  cookTime?: number;
  [key: string]: unknown;
}

// Legacy speed tags to remove (replaced by time-based filtering)
const LEGACY_SPEED_TAGS = new Set(["under 30 min", "quick", "weeknight"]);

function recomputeTags(existingTags: string[]): string[] {
  return existingTags.filter((t) => !LEGACY_SPEED_TAGS.has(t));
}

function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}

// POST /api/recipes/retag - Bulk recompute speed tags for all recipes
export const onRequestPost: PagesFunction<Env> = async ({ env }) => {
  const index =
    ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[] | null) ?? [];

  let updated = 0;

  for (const entry of index) {
    const raw = await env.WHISK_KV.get(`recipe:${entry.id}`, "text");
    if (!raw) continue;

    const recipe = JSON.parse(raw) as Recipe;
    const newTags = recomputeTags(recipe.tags);

    if (!tagsEqual(recipe.tags, newTags)) {
      recipe.tags = newTags;
      await env.WHISK_KV.put(`recipe:${entry.id}`, JSON.stringify(recipe));
      entry.tags = newTags;
      updated++;
    }
  }

  if (updated > 0) {
    await env.WHISK_KV.put("recipes:index", JSON.stringify(index));
  }

  return new Response(
    JSON.stringify({ updated, total: index.length }),
    { headers: { "Content-Type": "application/json" } }
  );
};
