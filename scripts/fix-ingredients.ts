// Fix "teaspoon s" / "tablespoon s" artifacts in stored recipe ingredients
// Run: npx wrangler kv key list --binding WHISK_KV | bun run scripts/fix-ingredients.ts
//
// Or manually: bun run scripts/fix-ingredients.ts
// Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;

if (!ACCOUNT_ID || !API_TOKEN || !KV_NAMESPACE_ID) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and KV_NAMESPACE_ID");
  process.exit(1);
}

const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}`;
const headers = { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" };

// Pattern: "teaspoon s" -> "teaspoons", etc.
const UNIT_PLURAL_FIX = /\b(teaspoon|tablespoon|cup|ounce|pound|clove|pinch|dash|slice|piece|stick|bunch|can|package|head|stalk|sprig)\s+s\b/gi;

async function listRecipeKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const url = `${BASE}/keys?prefix=recipe:&limit=1000${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await fetch(url, { headers });
    const data = (await res.json()) as { result: { name: string }[]; result_info?: { cursor?: string } };
    for (const k of data.result) {
      if (k.name !== "recipe_index") keys.push(k.name);
    }
    cursor = data.result_info?.cursor;
  } while (cursor);
  return keys;
}

async function getRecipe(key: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${BASE}/values/${encodeURIComponent(key)}`, { headers });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

async function putRecipe(key: string, recipe: Record<string, unknown>): Promise<void> {
  await fetch(`${BASE}/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(recipe),
  });
}

function fixText(str: string): string {
  return str.replace(UNIT_PLURAL_FIX, "$1s");
}

interface Ingredient {
  name: string;
  amount?: string;
  unit?: string;
  group?: string;
}

async function main() {
  const keys = await listRecipeKeys();
  console.log(`Found ${keys.length} recipes`);

  let fixed = 0;
  for (const key of keys) {
    const recipe = await getRecipe(key);
    if (!recipe) continue;

    let changed = false;
    const ingredients = recipe.ingredients as Ingredient[] | undefined;
    if (Array.isArray(ingredients)) {
      for (const ing of ingredients) {
        const fixedName = fixText(ing.name);
        const fixedUnit = ing.unit ? fixText(ing.unit) : ing.unit;
        if (fixedName !== ing.name) { ing.name = fixedName; changed = true; }
        if (fixedUnit !== ing.unit) { ing.unit = fixedUnit; changed = true; }
      }
    }

    // Also fix steps
    const steps = recipe.steps as { text: string }[] | undefined;
    if (Array.isArray(steps)) {
      for (const step of steps) {
        const fixedText = fixText(step.text);
        if (fixedText !== step.text) { step.text = fixedText; changed = true; }
      }
    }

    // Fix title, description, notes
    for (const field of ["title", "description", "notes"] as const) {
      const val = recipe[field];
      if (typeof val === "string") {
        const fixedVal = fixText(val);
        if (fixedVal !== val) { recipe[field] = fixedVal; changed = true; }
      }
    }

    if (changed) {
      await putRecipe(key, recipe);
      console.log(`  Fixed: ${recipe.title}`);
      fixed++;
    }
  }

  console.log(`\nDone. Fixed ${fixed} recipe(s).`);
}

main().catch(console.error);
