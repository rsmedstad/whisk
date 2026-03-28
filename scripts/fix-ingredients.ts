// Audit and fix ingredient text artifacts in existing recipes
// Fixes: "teaspoon s" → "teaspoons", "g arlic" → "garlic", HTML entities, etc.
// Usage: CF_ACCOUNT_ID=your-id bun scripts/fix-ingredients.ts [--dry-run]

import { getKVClient } from "./lib/cloudflare";

const dryRun = process.argv.includes("--dry-run");

// ── Known words for re-joining split text (same as import/url.ts) ──

const KNOWN_WORDS = new Set([
  "large", "medium", "small", "extra", "thin", "thick", "whole", "half",
  "light", "heavy", "packed", "level", "heaped", "heaping", "about",
  "chopped", "minced", "diced", "sliced", "peeled", "grated", "shredded",
  "crushed", "frozen", "softened", "melted", "toasted", "divided", "optional",
  "quartered", "halved", "trimmed", "rinsed", "drained", "deveined",
  "julienned", "blanched", "sifted", "warmed", "chilled", "cubed", "pitted",
  "seeded", "cored", "roasted", "steamed", "braised", "grilled", "broiled",
  "smoked", "pickled", "fermented", "marinated", "soaked", "sauteed",
  "caramelized", "charred", "poached", "fried", "baked", "dried", "ground",
  "crumbled", "mashed", "pureed", "shaved", "spiralized", "torn", "snipped",
  "roughly", "finely", "coarsely", "thinly", "lightly", "freshly", "loosely",
  "firmly", "well", "very", "just",
  "boneless", "skinless", "skinned", "bone", "deboned",
  "unsalted", "salted", "fresh", "dried", "raw", "cooked", "uncooked",
  "black", "white", "red", "green", "yellow", "orange", "brown", "golden",
  "purple", "dark", "bright",
  "sugar", "butter", "cream", "flour", "water", "olive", "virgin", "vegetable",
  "canola", "coconut", "sesame", "vanilla", "extract", "baking", "powder",
  "soda", "salt", "pepper", "chicken", "turkey", "beef", "pork", "lamb",
  "onion", "onions", "garlic", "ginger", "lemon", "lime", "juice", "zest",
  "whipping", "sour", "plain", "greek", "yogurt", "milk", "egg", "eggs",
  "yolk", "yolks", "purpose", "bread", "cake", "wheat", "oat", "corn",
  "starch", "sauce", "paste", "tomato", "canned", "wine", "broth", "stock",
  "honey", "maple", "syrup", "vinegar", "mustard", "mayo", "mayonnaise",
  "ketchup", "soy", "fish", "oyster", "worcestershire", "sriracha",
  "cinnamon", "cumin", "paprika", "turmeric", "coriander", "cardamom",
  "nutmeg", "cloves", "allspice", "anise", "fennel", "fenugreek",
  "saffron", "oregano", "basil", "thyme", "rosemary", "parsley", "cilantro",
  "dill", "mint", "sage", "tarragon", "chives", "chili", "cayenne",
  "garam", "masala", "curry", "peppercorns", "bay",
  "potato", "potatoes", "carrot", "carrots", "celery", "spinach", "kale",
  "lettuce", "cabbage", "broccoli", "cauliflower", "zucchini", "squash",
  "eggplant", "mushroom", "mushrooms", "bell", "jalapeno", "serrano",
  "habanero", "poblano", "avocado", "cucumber", "peas", "beans", "lentils",
  "chickpeas", "rice", "noodles", "pasta",
  "cheese", "parmesan", "mozzarella", "cheddar", "ricotta", "gouda",
  "provolone", "gruyere", "brie", "feta", "paneer", "ghee",
  "almond", "almonds", "walnut", "walnuts", "pecan", "pecans",
  "cashew", "cashews", "pistachio", "pistachios", "peanut", "peanuts",
  "tablespoon", "tablespoons", "teaspoon", "teaspoons", "ounce", "ounces",
  "pound", "pounds", "cup", "cups", "clove", "cloves", "pinch", "dash",
  "slice", "slices", "piece", "pieces", "stick", "bunch", "head", "stalk",
  "sprig", "can", "package",
]);

// ── HTML entity decoding ──

const HTML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ndash: "\u2013", mdash: "\u2014",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
  deg: "\u00B0", frac12: "\u00BD", frac14: "\u00BC", frac34: "\u00BE",
};

function decodeEntities(str: string): string {
  if (!str.includes("&")) return str;
  let result = str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES[name.toLowerCase()] ?? match);
  if (result.includes("&") && result !== str) {
    result = result
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES[name.toLowerCase()] ?? match);
  }
  return result;
}

// ── Text fixing logic ──

function fixIngredientText(str: string): string {
  return str
    // Decode HTML entities
    .replace(/&[#\w]+;/g, () => "") // placeholder — apply full decode below
    ;
}

function fixField(str: string): string {
  if (!str) return str;
  let result = decodeEntities(str);

  // Fix "teaspoon s" / "tablespoon s" / "cup s" artifacts
  result = result.replace(
    /\b(teaspoon|tablespoon|cup|ounce|pound|clove|pinch|dash|slice|piece|stick|bunch|can|package|head|stalk|sprig)\s+s\b/gi,
    "$1s"
  );

  // Fix short prefix splits: "g arlic" → "garlic", "l arge" → "large"
  result = result.replace(/\b(\w{1,3})\s+(\w{2,})\b/g, (match, prefix, rest) => {
    const combined = (prefix as string).toLowerCase() + (rest as string).toLowerCase();
    return KNOWN_WORDS.has(combined) ? (prefix as string) + (rest as string) : match;
  });
  // Fix longer prefix splits: "card amom" → "cardamom"
  result = result.replace(/\b(\w{2,5})\s+(\w{1,3})\b/g, (match, prefix, suffix) => {
    const combined = (prefix as string).toLowerCase() + (suffix as string).toLowerCase();
    return KNOWN_WORDS.has(combined) ? (prefix as string) + (suffix as string) : match;
  });
  // Fix mid-word splits: "cilan tro" → "cilantro"
  result = result.replace(/\b(\w{3,})\s+(\w{2,})\b/g, (match, prefix, suffix) => {
    const combined = (prefix as string).toLowerCase() + (suffix as string).toLowerCase();
    return KNOWN_WORDS.has(combined) ? (prefix as string) + (suffix as string) : match;
  });

  return result.replace(/\s{2,}/g, " ").trim();
}

// ── Main ──

interface Ingredient {
  name: string;
  amount?: string;
  unit?: string;
  group?: string;
}

interface Recipe {
  id: string;
  title: string;
  ingredients: Ingredient[];
  steps: { text: string }[];
  [key: string]: unknown;
}

const { baseUrl, headers } = await getKVClient();

// Fetch all recipe keys
const listRes = await fetch(`${baseUrl}/keys?prefix=recipe:`, { headers });
const listData = (await listRes.json()) as { result: { name: string }[] };
console.log(`Found ${listData.result.length} recipes to audit\n`);

let recipesFixed = 0;
let totalFieldsFixed = 0;

for (const { name: key } of listData.result) {
  const res = await fetch(`${baseUrl}/values/${encodeURIComponent(key)}`, { headers });
  const text = await res.text();
  let recipe: Recipe;
  try {
    recipe = JSON.parse(text);
  } catch {
    console.log(`  SKIP ${key} — parse error`);
    continue;
  }

  let changed = false;
  const fixes: string[] = [];

  // Fix title
  const fixedTitle = fixField(recipe.title);
  if (fixedTitle !== recipe.title) {
    fixes.push(`  title: "${recipe.title}" → "${fixedTitle}"`);
    recipe.title = fixedTitle;
    changed = true;
  }

  // Fix ingredients
  for (const ing of recipe.ingredients ?? []) {
    const fixedName = fixField(ing.name);
    if (fixedName !== ing.name) {
      fixes.push(`  name: "${ing.name}" → "${fixedName}"`);
      ing.name = fixedName;
      changed = true;
    }
    if (ing.unit) {
      const fixedUnit = fixField(ing.unit);
      if (fixedUnit !== ing.unit) {
        fixes.push(`  unit: "${ing.unit}" → "${fixedUnit}"`);
        ing.unit = fixedUnit;
        changed = true;
      }
    }
    if (ing.group) {
      const fixedGroup = fixField(ing.group);
      if (fixedGroup !== ing.group) {
        fixes.push(`  group: "${ing.group}" → "${fixedGroup}"`);
        ing.group = fixedGroup;
        changed = true;
      }
    }
  }

  // Fix step text
  for (const step of recipe.steps ?? []) {
    if (!step.text) continue;
    const fixedText = decodeEntities(step.text);
    if (fixedText !== step.text) {
      fixes.push(`  step: "${step.text.slice(0, 60)}..." → "${fixedText.slice(0, 60)}..."`);
      step.text = fixedText;
      changed = true;
    }
  }

  if (changed) {
    recipesFixed++;
    totalFieldsFixed += fixes.length;
    const id = key.replace("recipe:", "");
    console.log(`\n${recipe.title} (${id}):`);
    for (const fix of fixes) console.log(fix);

    if (!dryRun) {
      const putRes = await fetch(`${baseUrl}/values/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(recipe),
      });
      if (!putRes.ok) {
        console.log(`  ❌ Failed to update: ${putRes.status} ${putRes.statusText}`);
      } else {
        console.log(`  ✅ Updated`);
      }
    } else {
      console.log(`  (dry run — not saved)`);
    }
  }
}

console.log(`\n${"─".repeat(50)}`);
console.log(`Recipes with fixes: ${recipesFixed}`);
console.log(`Total fields fixed: ${totalFieldsFixed}`);
if (dryRun) console.log(`\nDry run — no changes written. Remove --dry-run to apply.`);
else if (recipesFixed > 0) console.log(`\nDon't forget to run: CF_ACCOUNT_ID=$CF_ACCOUNT_ID bun scripts/rebuild-index.ts`);
