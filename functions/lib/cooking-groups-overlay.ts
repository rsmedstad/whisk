import {
  cleanGroupName,
  collectHtmlIngredientLines,
  howToStepGroup,
  isIngredientGroupHeader,
  overlayIngredientGroups,
  type GroupableIngredient,
} from "./cooking-groups";

function decodeBasic(str: string): string {
  return str
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\u00a0/g, " ");
}

function stripTags(html: string): string {
  return decodeBasic(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

export interface GroupableStep {
  text: string;
  group?: string;
  photoUrl?: string;
  timerMinutes?: number;
}

/** Turn "GroupName:" sentinels plus ingredient lines into grouped rows. */
export function parseGroupSentinelLines(
  lines: string[]
): GroupableIngredient[] {
  const results: GroupableIngredient[] = [];
  let currentGroup: string | undefined;
  for (const line of lines) {
    if (isIngredientGroupHeader(line)) {
      currentGroup = cleanGroupName(line);
      if (
        currentGroup &&
        currentGroup === currentGroup.toUpperCase() &&
        currentGroup.length > 1
      ) {
        currentGroup =
          currentGroup.charAt(0) + currentGroup.slice(1).toLowerCase();
      }
      continue;
    }
    results.push({ name: line, group: currentGroup });
  }
  return results;
}

function findRecipeInLd(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInLd(item);
      if (found) return found;
    }
    return null;
  }
  const obj = data as Record<string, unknown>;
  const type = obj["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) {
    return obj;
  }
  if (Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"] as unknown[]) {
      const found = findRecipeInLd(item);
      if (found) return found;
    }
  }
  return null;
}

function collectHowToSteps(
  raw: unknown,
  sectionGroup?: string
): { name?: string; text: string; group?: string }[] {
  const out: { name?: string; text: string; group?: string }[] = [];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const step of list) {
    if (typeof step === "string") {
      const text = stripTags(step);
      if (text) out.push({ text, group: sectionGroup });
      continue;
    }
    if (!step || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    const type = s["@type"] as string | undefined;
    if (type === "HowToSection" && Array.isArray(s.itemListElement)) {
      const groupName =
        typeof s.name === "string" ? stripTags(s.name).replace(/:$/, "").trim() : sectionGroup;
      out.push(...collectHowToSteps(s.itemListElement, groupName));
      continue;
    }
    const rawText =
      typeof s.text === "string" && s.text.trim()
        ? s.text
        : typeof s.name === "string"
          ? s.name
          : "";
    const text = stripTags(rawText);
    if (!text) continue;
    out.push({
      name: typeof s.name === "string" ? s.name : undefined,
      text,
      group: howToStepGroup(s.name, s.text, sectionGroup),
    });
  }
  return out;
}

/** Copy HowToStep/HowToSection names onto already-parsed steps by matching text. */
export function overlayStepGroupsFromHtml(
  steps: GroupableStep[],
  html: string
): GroupableStep[] {
  if (steps.length === 0) return steps;
  if (steps.some((s) => (s.group ?? "").trim())) return steps;
  const jsonLdMatch = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  );
  let recipe: Record<string, unknown> | null = null;
  for (const match of jsonLdMatch) {
    try {
      const parsed = JSON.parse(match[1] ?? "");
      recipe = findRecipeInLd(parsed);
      if (recipe) break;
    } catch {
      continue;
    }
  }
  if (!recipe) return steps;
  const extracted = collectHowToSteps(recipe.recipeInstructions);
  if (!extracted.some((s) => (s.group ?? "").trim())) return steps;
  const used = new Set<number>();
  return steps.map((step) => {
    const key = (step.text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!key) return step;
    let found = -1;
    for (let i = 0; i < extracted.length; i++) {
      if (used.has(i)) continue;
      const other = (extracted[i]?.text ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!other) continue;
      if (other === key || other.includes(key) || key.includes(other)) {
        found = i;
        break;
      }
    }
    if (found < 0) return step;
    used.add(found);
    const g = extracted[found]?.group?.trim();
    return g ? { ...step, group: g } : step;
  });
}

export interface ImportedRecipeShape {
  ingredients?: GroupableIngredient[];
  steps?: GroupableStep[];
}

/**
 * Overlay cooking groups onto an already-imported recipe using page HTML.
 * Amounts/names/step text are not replaced.
 */
export function overlayImportedRecipe<T extends ImportedRecipeShape>(
  recipe: T,
  html: string
): T {
  if (!html || html.length < 200) return recipe;
  const next = { ...recipe };
  const ingredients = Array.isArray(next.ingredients) ? next.ingredients : [];
  if (ingredients.length && ingredients.every((i) => !(i.group ?? "").trim())) {
    const grouped = parseGroupSentinelLines(collectHtmlIngredientLines(html));
    next.ingredients = overlayIngredientGroups(ingredients, grouped);
  }
  const steps = Array.isArray(next.steps) ? next.steps : [];
  if (steps.length && steps.every((s) => !(s.group ?? "").trim())) {
    next.steps = overlayStepGroupsFromHtml(steps, html);
  }
  return next;
}
