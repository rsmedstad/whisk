/**
 * Abbreviate ingredient descriptions for concise shopping list display.
 * Strips cooking instructions, preparation notes, and verbose qualifiers
 * while keeping the essential item name.
 */

// Phrases to strip from ingredient names (cooking instructions, prep notes)
const STRIP_PATTERNS = [
  // Preparation methods
  /\b(finely |roughly |coarsely |thinly |freshly )?(chopped|diced|minced|sliced|grated|shredded|julienned|crushed|cubed|halved|quartered|peeled|trimmed|cored|deveined|deboned|deseeded|seeded|pitted|stemmed|rinsed|drained|thawed|defrosted|sifted|toasted|melted|softened|chilled|warmed|cooled|beaten|whisked|separated)\b/gi,
  // Cooking state
  /\b(at room temperature|room temp|to taste|as needed|for garnish|for serving|for topping|for drizzling|for dusting|optional)\b/gi,
  // Size qualifiers
  /\b(small|medium|large|extra-large|extra large|xl|thin|thick|bite-size|bite sized)\b/gi,
  // Vague measurements that aren't useful on a list
  /\b(a pinch of|a dash of|a handful of|a splash of|a drizzle of|a squeeze of)\b/gi,
  // Trailing commas, parenthetical notes
  /\(.*?\)/g,
  // "or substitute X"
  /\bor\b.*$/gi,
  // "divided" — recipe instruction not relevant to shopping
  /\bdivided\b/gi,
  // "plus more for..."
  /\bplus more.*$/gi,
  // "about" before amounts
  /\babout\b/gi,
];

// Common unit abbreviations for shopping
const UNIT_ABBREVIATIONS: Record<string, string> = {
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  ounce: "oz",
  ounces: "oz",
  pound: "lb",
  pounds: "lb",
  cup: "cup",
  cups: "cups",
  quart: "qt",
  quarts: "qt",
  gallon: "gal",
  gallons: "gal",
  pint: "pt",
  pints: "pt",
  kilogram: "kg",
  kilograms: "kg",
  gram: "g",
  grams: "g",
  milliliter: "ml",
  milliliters: "ml",
  liter: "L",
  liters: "L",
  package: "pkg",
  packages: "pkg",
  can: "can",
  cans: "cans",
  bottle: "bottle",
  bottles: "bottles",
  bunch: "bunch",
  bunches: "bunches",
  head: "head",
  heads: "heads",
  clove: "clove",
  cloves: "cloves",
  piece: "pc",
  pieces: "pcs",
  slice: "slice",
  slices: "slices",
  stick: "stick",
  sticks: "sticks",
  sprig: "sprig",
  sprigs: "sprigs",
  whole: "whole",
  container: "container",
  containers: "containers",
  jar: "jar",
  jars: "jars",
  bag: "bag",
  bags: "bags",
  box: "box",
  boxes: "boxes",
};

/** Abbreviate a unit string */
export function abbreviateUnit(unit: string | undefined): string | undefined {
  if (!unit) return undefined;
  const lower = unit.toLowerCase().trim();
  return UNIT_ABBREVIATIONS[lower] ?? unit;
}

/** Clean up an ingredient name for shopping display */
export function abbreviateName(name: string): string {
  let result = name;
  for (const pattern of STRIP_PATTERNS) {
    result = result.replace(pattern, "");
  }
  // Clean up extra whitespace and trailing/leading commas
  result = result.replace(/,\s*,/g, ",").replace(/^[\s,]+|[\s,]+$/g, "").replace(/\s{2,}/g, " ").trim();
  // Capitalize first letter
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  return result || name; // fallback to original if everything was stripped
}
