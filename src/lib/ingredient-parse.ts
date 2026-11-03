// Ingredient line parsing shared by URL import, the Discover feed, the shopping
// list and scripts. Pure: input lines must already be HTML-stripped.

/** Known ingredient/cooking words for re-joining split text artifacts */
const KNOWN_WORDS = new Set([
  // Sizes & descriptors
  "large", "medium", "small", "extra", "thin", "thick", "whole", "half",
  "light", "heavy", "packed", "level", "heaped", "heaping", "about",
  // Cooking prep words
  "chopped", "minced", "diced", "sliced", "peeled", "grated", "shredded",
  "crushed", "frozen", "softened", "melted", "toasted", "divided", "optional",
  "quartered", "halved", "trimmed", "rinsed", "drained", "deveined",
  "julienned", "blanched", "sifted", "warmed", "chilled", "cubed", "pitted",
  "seeded", "cored", "roasted", "steamed", "braised", "grilled", "broiled",
  "smoked", "pickled", "fermented", "marinated", "soaked", "sauteed",
  "caramelized", "charred", "poached", "fried", "baked", "dried", "ground",
  "crumbled", "mashed", "pureed", "shaved", "spiralized", "torn", "snipped",
  // Adverbs
  "roughly", "finely", "coarsely", "thinly", "lightly", "freshly", "loosely",
  "firmly", "well", "very", "just",
  // Meat/protein descriptors
  "boneless", "skinless", "skinned", "bone", "deboned",
  // States
  "unsalted", "salted", "fresh", "dried", "raw", "cooked", "uncooked",
  // Colors
  "black", "white", "red", "green", "yellow", "orange", "brown", "golden",
  "purple", "dark", "bright",
  // Common ingredients
  "sugar", "butter", "cream", "flour", "water", "olive", "virgin", "vegetable",
  "canola", "coconut", "sesame", "vanilla", "extract", "baking", "powder",
  "soda", "salt", "pepper", "chicken", "turkey", "beef", "pork", "lamb",
  "onion", "onions", "garlic", "ginger", "lemon", "lime", "juice", "zest",
  "whipping", "sour", "plain", "greek", "yogurt", "milk", "egg", "eggs",
  "yolk", "yolks", "purpose", "bread", "cake", "wheat", "oat", "corn",
  "starch", "sauce", "paste", "tomato", "canned", "wine", "broth", "stock",
  "honey", "maple", "syrup", "vinegar", "mustard", "mayo", "mayonnaise",
  "ketchup", "soy", "fish", "oyster", "worcestershire", "sriracha",
  // Spices & herbs
  "cinnamon", "cumin", "paprika", "turmeric", "coriander", "cardamom",
  "nutmeg", "cloves", "allspice", "anise", "fennel", "fenugreek",
  "saffron", "oregano", "basil", "thyme", "rosemary", "parsley", "cilantro",
  "dill", "mint", "sage", "tarragon", "chives", "chili", "cayenne",
  "garam", "masala", "curry", "peppercorns", "bay",
  // Produce
  "potato", "potatoes", "carrot", "carrots", "celery", "spinach", "kale",
  "lettuce", "cabbage", "broccoli", "cauliflower", "zucchini", "squash",
  "eggplant", "mushroom", "mushrooms", "bell", "jalapeno", "serrano",
  "habanero", "poblano", "avocado", "cucumber", "peas", "beans", "lentils",
  "chickpeas", "rice", "noodles", "pasta", "lasagna",
  // Dairy & nuts
  "cheese", "parmesan", "mozzarella", "cheddar", "ricotta", "gouda",
  "provolone", "gruyere", "brie", "feta", "paneer", "ghee",
  "almond", "almonds", "walnut", "walnuts", "pecan", "pecans",
  "cashew", "cashews", "pistachio", "pistachios", "peanut", "peanuts",
  // Units/measures that might get split
  "tablespoon", "tablespoons", "teaspoon", "teaspoons", "ounce", "ounces",
  "pound", "pounds", "cup", "cups", "clove", "cloves", "pinch", "dash",
  "slice", "slices", "piece", "pieces", "stick", "bunch", "head", "stalk",
  "sprig", "can", "package",
]);

function cleanIngredientText(str: string): string {
  return str
    // Fix "teaspoon s" / "tablespoon s" / "cup s" artifacts from HTML stripping
    .replace(/\b(teaspoon|tablespoon|cup|ounce|pound|clove|pinch|dash|slice|piece|stick|bunch|can|package|head|stalk|sprig)\s+s\b/gi, "$1s")
    // Fix multi-letter spacing artifacts from HTML tag stripping
    // e.g. "l arge" → "large", "m edium" → "medium", "g reen" → "green"
    // Apply repeatedly to handle chains like "g r een" → "gr een" → "green"
    .replace(/\b(\w{1,3})\s+(\w{2,})\b/g, (match, prefix, rest) => {
      const combined = (prefix as string).toLowerCase() + (rest as string).toLowerCase();
      if (!KNOWN_WORDS.has(combined)) return match;
      // Display code capitalized the fragment of some stored names ("g Arlic")
      return /^[a-z]/.test(prefix as string) && /^[A-Z][a-z]/.test(rest as string)
        ? combined
        : (prefix as string) + (rest as string);
    })
    // Second pass for longer prefix splits like "card amom" or "core d"
    .replace(/\b(\w{2,5})\s+(\w{1,3})\b/g, (match, prefix, suffix) => {
      const combined = (prefix as string).toLowerCase() + (suffix as string).toLowerCase();
      return KNOWN_WORDS.has(combined) ? (prefix as string) + (suffix as string) : match;
    })
    // Third pass for mid-word splits like "carda mom", "cilan tro"
    .replace(/\b(\w{3,})\s+(\w{2,})\b/g, (match, prefix, suffix) => {
      const combined = (prefix as string).toLowerCase() + (suffix as string).toLowerCase();
      return KNOWN_WORDS.has(combined) ? (prefix as string) + (suffix as string) : match;
    })
    // Collapse multiple spaces
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Convert decimal fractions to readable unicode fractions */
function normalizeAmount(amount: string): string {
  // Already a unicode fraction or contains one — return as-is
  if (/[½⅓⅔¼¾⅛⅜⅝⅞]/.test(amount)) return amount;

  // Handle slash fractions like "1/3", "1/2", "3 1/4"
  const slashMatch = amount.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (slashMatch) {
    const whole = parseInt(slashMatch[1]!, 10);
    const num = parseInt(slashMatch[2]!, 10);
    const den = parseInt(slashMatch[3]!, 10);
    if (den > 0) {
      const symbol = fractionToUnicode(num / den);
      if (symbol) return whole > 0 ? `${whole} ${symbol}` : symbol;
    }
    return amount; // Can't convert, return as-is
  }
  const simpleSlash = amount.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (simpleSlash) {
    const num = parseInt(simpleSlash[1]!, 10);
    const den = parseInt(simpleSlash[2]!, 10);
    if (den > 0) {
      const symbol = fractionToUnicode(num / den);
      if (symbol) return symbol;
    }
    return amount;
  }

  // Handle decimals like "0.33333334326744" or "0.25" or "1.5"
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;

  const whole = Math.floor(num);
  const decimal = num - whole;

  // Clean integer
  if (Math.abs(decimal) < 0.01) return String(whole);

  // Try to convert decimal part to unicode fraction
  const symbol = fractionToUnicode(decimal);
  if (symbol) return whole > 0 ? `${whole} ${symbol}` : symbol;

  // No close fraction match — round to 2 decimal places
  return num % 1 === 0 ? String(num) : num.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Map a decimal value (0-1) to a unicode fraction symbol, or null if no close match */
function fractionToUnicode(value: number): string | null {
  const fractions: [number, string][] = [
    [0.125, "⅛"], [0.25, "¼"], [1/3, "⅓"], [0.375, "⅜"],
    [0.5, "½"], [0.625, "⅝"], [2/3, "⅔"], [0.75, "¾"], [0.875, "⅞"],
  ];
  for (const [frac, symbol] of fractions) {
    if (Math.abs(value - frac) < 0.03) return symbol;
  }
  return null;
}

function isIngredientGroupHeader(text: string): boolean {
  // No digits or fractions — group headers never start with amounts
  if (/[\d½⅓⅔¼¾⅛⅜⅝⅞]/.test(text)) return false;
  // Must be short (typical headers are 1-6 words)
  if (text.split(/\s+/).length > 8) return false;
  // Explicit patterns: "For the X:", "For X:", trailing colon
  if (/^for\s+(the\s+)?/i.test(text)) return true;
  if (text.endsWith(":")) return true;
  // ALL CAPS header (at least 3 chars, e.g. "DIPPING SAUCE")
  if (text.length >= 3 && text === text.toUpperCase() && /[A-Z]/.test(text)) return true;
  return false;
}

function cleanGroupName(text: string): string {
  return text
    .replace(/^for\s+(the\s+)?/i, "")
    .replace(/:$/, "")
    .trim();
}

export interface ParsedIngredient {
  name: string;
  amount?: string;
  unit?: string;
  group?: string;
}

const FRACTION_CHARS = "½⅓⅔¼¾⅛⅜⅝⅞";
// One quantity: "2", "1.5", "1/2", "1 1/2", "1½", "½"
const QTY = String.raw`(?:\d+(?:\.\d+)?(?:\s+\d+\s*/\s*\d+|\s*/\s*\d+|\s*[${FRACTION_CHARS}])?|[${FRACTION_CHARS}])`;
const RANGE_SEP = String.raw`\s*(?:-|–|\bto\b|\bor\b)\s*`;
const UNITS =
  "cups?|tbsps?|tsps?|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g|kg|ml|l|liters?|litres?|quarts?|qts?|pints?|pts?|gallons?|cloves?|cans?|jars?|packages?|pkgs?|bunche?s?|pieces?|slices?|sticks?|heads?|stalks?|ribs?|sprigs?|pinche?s?|dashes?|packets?|envelopes?";
// amount (optionally a range "1-2", "1 to 2", "1 or 2"), optional "(15-ounce)" size,
// optional unit, then the name. The unit needs \b so single-letter units (l, g)
// don't bite the first letter of a name: "9 lasagna noodles" is not 9 l "asagna".
const LINE_RE = new RegExp(
  String.raw`^(${QTY}(?:${RANGE_SEP}${QTY})?)\s*(\([^)]*\))?\s*(?:(${UNITS})\b\.?)?\s*(.+)`,
  "i",
);
// Second measure at the start of a name: "plus 1 tablespoon sugar", "/2½ ounces parmesan".
// Kept in recipe text (it's part of the amount); the shopping list strips it.
export const EXTRA_MEASURE_RE =new RegExp(String.raw`^(?:plus\s+|\+\s*|/\s*)${QTY}\s*(?:(?:${UNITS})\b\.?)?\s*`, "i");

/** Normalize a captured amount: "1 or 2" -> "1-2", "1 1/2" -> "1 ½". */
function normalizeAmountRange(raw: string): string {
  const parts = raw.split(new RegExp(RANGE_SEP, "i")).filter(Boolean);
  if (parts.length === 2) return `${normalizeAmount(parts[0]!.trim())}-${normalizeAmount(parts[1]!.trim())}`;
  return normalizeAmount(raw.trim());
}

/** Parse one HTML-free ingredient line into amount, unit and name. */
export function parseIngredientLine(line: string): ParsedIngredient | null {
  const cleaned = cleanIngredientText(line)
    // "2-1/4" and "1 -3/4" are mixed numbers, not ranges
    .replace(/(\d)\s*-\s*(\d+\s*\/\s*\d+)/g, "$1 $2")
    // "1 .5 tablespoons" is 1.5
    .replace(/(\d)\s+\.(\d)/g, "$1.$2")
    // "28 -ounce can" (split by older saves) is "28-ounce can"
    .replace(/(\d)\s+-(ounce|oz|inch|pound|lb|gram|quart|pint)/gi, "$1-$2");
  if (!cleaned) return null;
  const match = cleaned.match(LINE_RE);
  if (!match) return { name: cleaned };
  const size = match[2]?.trim();
  const rest = (match[4] ?? "").trim();
  // "1 to taste" style lines: no real name after the amount
  if (!rest) return { name: cleaned };
  return {
    amount: normalizeAmountRange(match[1] ?? ""),
    unit: match[3]?.trim(),
    name: size ? `${size} ${rest}` : rest,
  };
}

/** Parse HTML-free ingredient lines, turning section headers into groups. */
export function parseIngredientLines(lines: string[]): ParsedIngredient[] {
  const results: ParsedIngredient[] = [];
  let currentGroup: string | undefined;
  for (const line of lines) {
    const cleaned = cleanIngredientText(line);
    if (!cleaned) continue;

    // Check if this line is a section header (e.g. "For the crispy skirt:", "DIPPING SAUCE")
    if (isIngredientGroupHeader(cleaned)) {
      currentGroup = cleanGroupName(cleaned);
      // Title-case the group name if it was all caps
      if (currentGroup === currentGroup.toUpperCase() && currentGroup.length > 1) {
        currentGroup = currentGroup.charAt(0) + currentGroup.slice(1).toLowerCase();
      }
      continue; // Don't add as an ingredient
    }

    const parsed = parseIngredientLine(cleaned);
    if (parsed) results.push({ ...parsed, group: currentGroup });
  }
  return results;
}
