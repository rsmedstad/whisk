/**
 * Author cooking groups (dough vs toppings, etc.) — not shopping aisles.
 *
 * JSON-LD recipeIngredient is a flat list; visible recipe-card HTML often has
 * headings between <ul> blocks. Overlay copies those headings onto JSON-LD
 * amounts/names. Shopping aisles stay on Ingredient.category.
 */

export interface GroupableIngredient {
  name: string;
  amount?: string;
  unit?: string;
  group?: string;
}

/** Headings that name the ingredients section, not a cooking group. */
const SKIP_SECTION_TITLES =
  /^(ingredients?|what you.?ll need|you.?ll need|what you need|ingredients list)$/i;

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

export function isIngredientGroupHeader(text: string): boolean {
  // No digits or fractions — group headers never start with amounts
  if (/[\d½⅓⅔¼¾⅛⅜⅝⅞]/.test(text)) return false;
  // Must be short (typical headers are 1-6 words)
  if (text.split(/\s+/).length > 8) return false;
  // Explicit patterns: "For the X:", "For X:", trailing colon
  if (/^for\s+(the\s+)?/i.test(text)) return true;
  if (text.endsWith(":")) return true;
  // ALL CAPS header (at least 3 chars, e.g. "DIPPING SAUCE")
  if (text.length >= 3 && text === text.toUpperCase() && /[A-Z]/.test(text))
    return true;
  return false;
}

export function cleanGroupName(text: string): string {
  return text
    .replace(/^for\s+(the\s+)?/i, "")
    .replace(/:$/, "")
    .trim();
}

/**
 * HowToStep.name becomes step.group only when both name and text exist.
 * HowToSection still supplies sectionGroup for steps that lack a name.
 * Does not treat name as the step text — caller keeps that split.
 */
export function howToStepGroup(
  name: unknown,
  text: unknown,
  sectionGroup?: string
): string | undefined {
  const nameStr =
    typeof name === "string" ? stripTags(name).replace(/:$/, "").trim() : "";
  const textStr = typeof text === "string" ? stripTags(text).trim() : "";
  if (nameStr && textStr) {
    return nameStr.length > 100 ? nameStr.slice(0, 100) : nameStr;
  }
  return sectionGroup;
}

/**
 * Slice the Tasty Recipes ingredients card without stopping at the first
 * nested </div> (header clipboard, units, etc.).
 */
export function extractTastyIngredientsHtml(html: string): string | null {
  const bodyRe = /class="[^"]*\btasty-recipes-ingredients-body\b[^"]*"/i;
  const outerRe = /class="[^"]*\btasty-recipes-ingredients\b(?!-)/i;
  const bodyMatch = bodyRe.exec(html);
  const outerMatch = outerRe.exec(html);
  const start = bodyMatch?.index ?? outerMatch?.index;
  if (start === undefined) return null;
  const rest = html.slice(start);
  const end = rest.search(
    /class="[^"]*tasty-recipes-(?:cook-mode|instructions|notes|nutrition|keywords)\b/i
  );
  return end === -1 ? rest.slice(0, 80_000) : rest.slice(0, end);
}

/**
 * Walk ul/ol blocks and inject "GroupName:" sentinels from headings between
 * them (h3/h4/`<p><strong>`). First unnamed block stays unlabeled — do not
 * invent "Dough". Section titles like "Ingredients" are skipped.
 */
export function extractIngredientLinesWithHeadings(sectionHtml: string): string[] {
  const lines: string[] = [];
  const parts = sectionHtml.split(/(<(?:ul|ol)\b[^>]*>[\s\S]*?<\/(?:ul|ol)>)/gi);
  for (const part of parts) {
    if (!part) continue;
    if (/<(?:ul|ol)\b/i.test(part)) {
      const lis = part.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi);
      if (!lis) continue;
      for (const li of lis) {
        const text = stripTags(li);
        if (text.length > 1 && text.length < 300) lines.push(text);
      }
      continue;
    }
    const headingRe =
      /<(?:p|h[2-6])\b[^>]*>\s*(?:<(?:strong|b|span)[^>]*>)?\s*([^<]+?)\s*(?::)?\s*(?:<\/(?:strong|b|span)>)?\s*<\/(?:p|h[2-6])>/gi;
    let hm: RegExpExecArray | null;
    while ((hm = headingRe.exec(part)) !== null) {
      const headerText = stripTags(hm[1] ?? "")
        .replace(/:$/, "")
        .trim();
      if (!headerText || headerText.length < 1 || headerText.length >= 60) {
        continue;
      }
      if (SKIP_SECTION_TITLES.test(headerText)) continue;
      // Only treat a group as optional if the heading contains "optional".
      // Callers must not drop "recommended toppings" or similar.
      lines.push(`${headerText}:`);
    }
  }
  return lines;
}

function extractWprmIngredientLines(html: string): string[] {
  const groups = html.match(
    /<div[^>]*class="[^"]*wprm-recipe-ingredient-group[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*wprm-recipe-ingredient-group|<div[^>]*class="[^"]*wprm-recipe-instruction|$)/gi
  );
  if (!groups || groups.length === 0) return [];
  const lines: string[] = [];
  for (const groupBlock of groups) {
    const groupNameMatch = groupBlock.match(
      /class="[^"]*wprm-recipe-group-name[^"]*"[^>]*>([\s\S]*?)<\//i
    );
    const groupName = groupNameMatch
      ? stripTags(groupNameMatch[1] ?? "").trim()
      : "";
    if (groupName) lines.push(`${groupName}:`);
    const lis = groupBlock.match(
      /<li[^>]*class="[^"]*wprm-recipe-ingredient[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
    );
    if (!lis) continue;
    for (const li of lis) {
      const text = stripTags(li);
      if (text.length > 1 && text.length < 300) lines.push(text);
    }
  }
  return lines;
}

function extractGenericIngredientLines(html: string): string[] {
  const start = html.search(/(?:class|id)="[^"]*ingredient[^"]*"/i);
  if (start === -1) return [];
  const rest = html.slice(start);
  const end = rest.search(
    /(?:class|id)="[^"]*(?:instruction|direction|method)[^"]*"/i
  );
  const section = end === -1 ? rest.slice(0, 50_000) : rest.slice(0, end);
  return extractIngredientLinesWithHeadings(section);
}

/**
 * Collect ingredient lines (with "GroupName:" sentinels) from visible
 * recipe-card HTML: Tasty, WPRM groups, then generic h3/h4/`<p><strong>`.
 */
export function collectHtmlIngredientLines(html: string): string[] {
  const tasty = extractTastyIngredientsHtml(html);
  if (tasty) {
    const lines = extractIngredientLinesWithHeadings(tasty);
    if (lines.length) return lines;
  }
  const wprm = extractWprmIngredientLines(html);
  if (wprm.length) return wprm;
  const generic = extractGenericIngredientLines(html);
  if (generic.length) return generic;
  return [];
}

function nameKey(ing: GroupableIngredient): string {
  return (ing.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Copy cooking-group headings onto JSON-LD ingredients. JSON-LD still owns
 * amounts and names. No-op if the target already has any group, or if the
 * HTML parse produced none. Does not invent unlabeled first-block names.
 */
export function overlayIngredientGroups(
  target: GroupableIngredient[],
  grouped: GroupableIngredient[]
): GroupableIngredient[] {
  if (target.length === 0) return target;
  if (target.some((i) => (i.group ?? "").trim())) return target;
  if (!grouped.some((i) => (i.group ?? "").trim())) return target;

  if (target.length === grouped.length) {
    return target.map((ing, i) => {
      const g = grouped[i]?.group?.trim();
      return g ? { ...ing, group: g } : ing;
    });
  }

  const used = new Set<number>();
  return target.map((ing) => {
    const key = nameKey(ing);
    if (!key) return ing;
    let found = -1;
    for (let i = 0; i < grouped.length; i++) {
      if (used.has(i)) continue;
      const other = nameKey(grouped[i]!);
      if (!other) continue;
      if (other === key || other.includes(key) || key.includes(other)) {
        found = i;
        break;
      }
    }
    if (found < 0) return ing;
    used.add(found);
    const g = grouped[found]?.group?.trim();
    return g ? { ...ing, group: g } : ing;
  });
}
