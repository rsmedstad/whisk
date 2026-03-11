// Recipe complexity scoring
// Computes a "simple" | "moderate" | "elaborate" label from recipe metrics

export type Complexity = "simple" | "moderate" | "elaborate";

/** Numeric complexity score (0–6) from recipe metrics */
export function complexityScore(opts: {
  totalMinutes: number; // prepTime + cookTime
  ingredientCount: number;
  stepCount: number;
}): number {
  const { totalMinutes, ingredientCount, stepCount } = opts;

  // Time: 0 = ≤35min, 1 = ≤60min, 2 = >60min
  const timeScore = totalMinutes <= 0 ? 1 : totalMinutes <= 35 ? 0 : totalMinutes <= 60 ? 1 : 2;

  // Ingredients: 0 = ≤7, 1 = ≤12, 2 = >12
  const ingredientScore = ingredientCount <= 7 ? 0 : ingredientCount <= 12 ? 1 : 2;

  // Steps: 0 = ≤5, 1 = ≤10, 2 = >10
  const stepScore = stepCount <= 5 ? 0 : stepCount <= 10 ? 1 : 2;

  return timeScore + ingredientScore + stepScore;
}

/** Label from recipe metrics */
export function computeComplexity(opts: {
  totalMinutes: number;
  ingredientCount: number;
  stepCount: number;
}): Complexity {
  const score = complexityScore(opts);
  if (score <= 2) return "simple";
  if (score <= 4) return "moderate";
  return "elaborate";
}

/** Numeric sort value for complexity (lower = simpler) */
export function complexitySortValue(c: Complexity | undefined): number {
  switch (c) {
    case "simple": return 0;
    case "moderate": return 1;
    case "elaborate": return 2;
    default: return 1; // treat unknown as moderate
  }
}
