import { parseIngredientLines } from "../../src/lib/ingredient-parse";
import type { Ingredient, Step } from "../../src/types";

export const MAX_RECIPE_TEXT_CHARS = 12_000;
export const MIN_RECIPE_TEXT_CHARS = 40;

export interface TextRecipe {
  title: string;
  description?: string;
  ingredients: Ingredient[];
  steps: Step[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
}

/** Strip control characters (keep tab/newline) and cap length before prompting. */
export function cleanRecipeText(text: string): string {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").slice(0, MAX_RECIPE_TEXT_CHARS).trim();
}

function toMinutes(v: unknown): number | undefined {
  return typeof v === "number" && isFinite(v) && v > 0 && v < 10_000 ? Math.round(v) : undefined;
}

/** Validate the model's JSON into a recipe. Needs a title, >= 2 ingredients, >= 1 step. */
export function parseTextRecipeResponse(raw: string): TextRecipe | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      data = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
  const ingLines = Array.isArray(o.ingredients)
    ? (o.ingredients as unknown[]).filter((i): i is string => typeof i === "string" && i.trim().length > 1).slice(0, 200)
    : [];
  const steps = Array.isArray(o.steps)
    ? (o.steps as unknown[])
        .map((s) => (typeof s === "string" ? s : (s as { text?: unknown } | null)?.text))
        .filter((s): s is string => typeof s === "string" && s.trim().length > 5)
        .slice(0, 100)
        .map((text) => ({ text: text.trim().slice(0, 5000) }))
    : [];
  if (!title || ingLines.length < 2 || steps.length < 1) return null;
  const servings = typeof o.servings === "number" && o.servings > 0 && o.servings < 1000 ? Math.round(o.servings) : undefined;
  return {
    title,
    description: typeof o.description === "string" && o.description.trim() ? o.description.trim().slice(0, 1000) : undefined,
    ingredients: parseIngredientLines(ingLines) as Ingredient[],
    steps,
    prepTime: toMinutes(o.prepTime),
    cookTime: toMinutes(o.cookTime),
    servings,
  };
}
