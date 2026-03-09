/**
 * Audit and fix existing recipes for:
 * 1. Broken ingredient text (spaces inserted mid-word like "g reen", "clove s")
 * 2. Duplicate photos (same image at different sizes/CDN paths)
 *
 * Usage: bun scripts/fix-recipes.ts [--dry-run]
 */

const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";

const dryRun = process.argv.includes("--dry-run");

// Extract OAuth token from wrangler config
const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token found"); process.exit(1); }
const token = tokenMatch[1];

const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const headers = { Authorization: `Bearer ${token}` };

// ── Known words set (same as in import/url.ts) ──
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

function cleanIngredientText(str: string): string {
  return str
    .replace(/\b(teaspoon|tablespoon|cup|ounce|pound|clove|pinch|dash|slice|piece|stick|bunch|can|package|head|stalk|sprig)\s+s\b/gi, "$1s")
    .replace(/\b(\w{1,3})\s+(\w{2,})\b/g, (match, prefix, rest) => {
      const combined = (prefix as string).toLowerCase() + (rest as string).toLowerCase();
      return KNOWN_WORDS.has(combined) ? (prefix as string) + (rest as string) : match;
    })
    .replace(/\b(\w{2,5})\s+(\w{1,3})\b/g, (match, prefix, suffix) => {
      const combined = (prefix as string).toLowerCase() + (suffix as string).toLowerCase();
      return KNOWN_WORDS.has(combined) ? (prefix as string) + (suffix as string) : match;
    })
    .replace(/\b(\w{3,})\s+(\w{2,})\b/g, (match, prefix, suffix) => {
      const combined = (prefix as string).toLowerCase() + (suffix as string).toLowerCase();
      return KNOWN_WORDS.has(combined) ? (prefix as string) + (suffix as string) : match;
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Photo dedup ──
function normalizeImageKey(url: string): string {
  let u = url.split("?")[0]?.replace(/\/$/, "").replace(/^https?:\/\//, "") ?? url;
  u = u.replace(/\/thmb\/[^/]+\/[^/]*\d+x\d+[^/]*\/(?:filters:[^/]*\/)?/i, "/thmb/");
  u = u.replace(/\/\d+x\d+\//g, "/");
  return u.toLowerCase();
}

function dedupePhotos(photos: { url: string; isPrimary?: boolean }[]): { url: string; isPrimary?: boolean }[] {
  const seenKeys = new Set<string>();
  const seenFilenames = new Set<string>();
  return photos.filter((p) => {
    if (!p.url) return false;
    const key = normalizeImageKey(p.url);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    const filename = key.split("/").pop() ?? "";
    if (filename.length > 8 && /\.(jpg|jpeg|png|webp|avif)$/i.test(filename)) {
      const baseFilename = filename.replace(/-?\d+x\d+/, "");
      if (seenFilenames.has(filename)) return false;
      seenFilenames.add(filename);
      if (baseFilename !== filename) {
        if (seenFilenames.has(baseFilename)) return false;
        seenFilenames.add(baseFilename);
      }
    }
    return true;
  });
}

// ── Main ──
const listRes = await fetch(`${base}/keys?prefix=recipe:`, { headers });
const listData = (await listRes.json()) as { result: { name: string }[] };

console.log(`Found ${listData.result.length} recipes${dryRun ? " (DRY RUN)" : ""}\n`);

let fixedCount = 0;
let ingredientFixes = 0;
let photoFixes = 0;

for (const { name: key } of listData.result) {
  const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, { headers });
  const text = await res.text();
  let recipe;
  try {
    recipe = JSON.parse(text);
  } catch {
    console.log(`  SKIP ${key} — parse error`);
    continue;
  }

  const id = key.replace("recipe:", "");
  let changed = false;
  const changes: string[] = [];

  // Fix ingredients
  if (Array.isArray(recipe.ingredients)) {
    for (const ing of recipe.ingredients) {
      if (typeof ing.name === "string") {
        const cleaned = cleanIngredientText(ing.name);
        if (cleaned !== ing.name) {
          changes.push(`  ing: "${ing.name}" → "${cleaned}"`);
          ing.name = cleaned;
          changed = true;
          ingredientFixes++;
        }
      }
      if (typeof ing.unit === "string") {
        const cleaned = cleanIngredientText(ing.unit);
        if (cleaned !== ing.unit) {
          changes.push(`  unit: "${ing.unit}" → "${cleaned}"`);
          ing.unit = cleaned;
          changed = true;
          ingredientFixes++;
        }
      }
    }
  }

  // Fix duplicate photos
  if (Array.isArray(recipe.photos) && recipe.photos.length > 1) {
    const deduped = dedupePhotos(recipe.photos);
    // Also filter out photos that match thumbnailUrl (redundant)
    if (recipe.thumbnailUrl) {
      const thumbKey = normalizeImageKey(recipe.thumbnailUrl);
      const withoutThumbDupes = deduped;
      // Keep the first occurrence (which is likely the primary)
      // but remove subsequent duplicates of the thumbnail
      let foundThumb = false;
      for (let i = 0; i < withoutThumbDupes.length; i++) {
        const pKey = normalizeImageKey(withoutThumbDupes[i]!.url);
        if (pKey === thumbKey) {
          if (foundThumb) {
            withoutThumbDupes.splice(i, 1);
            i--;
          }
          foundThumb = true;
        }
      }
    }
    const deduped2 = dedupePhotos(recipe.photos);
    if (deduped2.length < recipe.photos.length) {
      changes.push(`  photos: ${recipe.photos.length} → ${deduped2.length} (removed ${recipe.photos.length - deduped2.length} duplicates)`);
      recipe.photos = deduped2;
      changed = true;
      photoFixes++;
    }
  }

  if (changed) {
    fixedCount++;
    console.log(`FIX ${id} | ${recipe.title}`);
    for (const c of changes) console.log(c);

    if (!dryRun) {
      const putRes = await fetch(`${base}/values/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(recipe),
      });
      if (!putRes.ok) {
        console.log(`  ERROR writing: ${putRes.status} ${putRes.statusText}`);
      } else {
        console.log(`  ✓ saved`);
      }
    }
    console.log();
  }
}

console.log(`\nDone. Fixed ${fixedCount} recipes (${ingredientFixes} ingredient fixes, ${photoFixes} photo fixes)${dryRun ? " [DRY RUN — no changes saved]" : ""}`);
