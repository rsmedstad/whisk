// Recipe difficulty scoring
// Computes an "easy" | "medium" | "hard" label from recipe metrics

export type Difficulty = "easy" | "medium" | "hard";

/** Numeric difficulty score (0–6) from recipe metrics */
export function difficultyScore(opts: {
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
export function computeDifficulty(opts: {
  totalMinutes: number;
  ingredientCount: number;
  stepCount: number;
}): Difficulty {
  const score = difficultyScore(opts);
  if (score <= 2) return "easy";
  if (score <= 4) return "medium";
  return "hard";
}

/** Numeric sort value for difficulty (lower = easier) */
export function difficultySortValue(d: Difficulty | undefined): number {
  switch (d) {
    case "easy": return 0;
    case "medium": return 1;
    case "hard": return 2;
    default: return 1; // treat unknown as medium
  }
}
