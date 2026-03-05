interface Env {
  WHISK_KV: KVNamespace;
}

interface RecipeIndexEntry {
  id: string;
  title: string;
  [key: string]: unknown;
}

interface Ingredient {
  name: string;
  amount?: string;
  unit?: string;
  group?: string;
}

interface Recipe {
  id: string;
  title: string;
  description?: string;
  notes?: string;
  ingredients: Ingredient[];
  steps: { text: string; group?: string }[];
  [key: string]: unknown;
}

// Fix "teaspoon s" -> "teaspoons" and similar artifacts from HTML stripping
const UNIT_PLURAL_FIX =
  /\b(teaspoon|tablespoon|cup|ounce|pound|clove|pinch|dash|slice|piece|stick|bunch|can|package|head|stalk|sprig)\s+s\b/gi;

function fixText(str: string): string {
  return str.replace(UNIT_PLURAL_FIX, "$1s");
}

// POST /api/recipes/fix-text - Fix HTML stripping artifacts in stored recipes
export const onRequestPost: PagesFunction<Env> = async ({ env }) => {
  const index =
    ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[] | null) ?? [];

  let updated = 0;

  for (const entry of index) {
    const raw = await env.WHISK_KV.get(`recipe:${entry.id}`, "text");
    if (!raw) continue;

    const recipe = JSON.parse(raw) as Recipe;
    let changed = false;

    // Fix ingredients
    for (const ing of recipe.ingredients) {
      const fixedName = fixText(ing.name);
      const fixedUnit = ing.unit ? fixText(ing.unit) : ing.unit;
      if (fixedName !== ing.name) { ing.name = fixedName; changed = true; }
      if (fixedUnit !== ing.unit) { ing.unit = fixedUnit; changed = true; }
    }

    // Fix steps
    for (const step of recipe.steps) {
      const fixedStep = fixText(step.text);
      if (fixedStep !== step.text) { step.text = fixedStep; changed = true; }
    }

    // Fix title, description, notes
    for (const field of ["title", "description", "notes"] as const) {
      const val = recipe[field];
      if (typeof val === "string") {
        const fixedVal = fixText(val);
        if (fixedVal !== val) { (recipe[field] as string) = fixedVal; changed = true; }
      }
    }

    if (changed) {
      await env.WHISK_KV.put(`recipe:${entry.id}`, JSON.stringify(recipe));
      // Update index entry title if it changed
      const fixedTitle = fixText(entry.title);
      if (fixedTitle !== entry.title) entry.title = fixedTitle;
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
