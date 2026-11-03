// Re-parse saved recipes' ingredients with the current parser, fixing data saved
// by older versions: "6 g Arlic cloves" -> 6 garlic cloves, "1" + "or 2 sprigs
// parsley" -> 1-2 sprigs parsley, "2" + "-1/4 teaspoons basil" -> 2 ¼ teaspoons basil.
// Dry run by default; pass --apply to write.
//
// Usage:
//   CF_ACCOUNT_ID=your-id bun scripts/reparse-ingredients.ts                               # personal, dry run
//   CF_ACCOUNT_ID=your-id bun scripts/reparse-ingredients.ts --config wrangler-demo.toml --apply

import { getKVClient } from "./lib/cloudflare";
import { parseIngredientLine } from "../src/lib/ingredient-parse";

const apply = process.argv.includes("--apply");
const configIdx = process.argv.indexOf("--config");
const configFile = configIdx >= 0 ? process.argv[configIdx + 1] : undefined;

interface Ingredient {
  name: string;
  amount?: string;
  unit?: string;
  [key: string]: unknown;
}

interface Recipe {
  id: string;
  title: string;
  ingredients?: Ingredient[];
  [key: string]: unknown;
}

const show = (i: { amount?: string; unit?: string; name: string }) =>
  [i.amount, i.unit, i.name].filter(Boolean).join(" | ");

const { baseUrl, headers } = await getKVClient(configFile);
console.log(`Namespace from ${configFile ?? "wrangler.toml"}${apply ? "" : " (dry run)"}\n`);

const keys: string[] = [];
let cursor: string | undefined;
do {
  const res = await fetch(`${baseUrl}/keys?prefix=recipe:&limit=1000${cursor ? `&cursor=${cursor}` : ""}`, { headers });
  const data = (await res.json()) as {
    result: { name: string }[] | null;
    result_info?: { cursor?: string };
    errors?: { code: number; message: string }[];
  };
  if (!data.result) {
    // e.g. 10000 Authentication error: the token lacks Workers KV Storage permission
    console.error(`KV list failed (${res.status}): ${(data.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ")}`);
    process.exit(1);
  }
  keys.push(...data.result.map((k) => k.name).filter((k) => k.startsWith("recipe:")));
  cursor = data.result_info?.cursor || undefined;
} while (cursor);
console.log(`Found ${keys.length} recipes\n`);

let recipesChanged = 0;
let linesChanged = 0;

for (const key of keys) {
  const res = await fetch(`${baseUrl}/values/${encodeURIComponent(key)}`, { headers });
  let recipe: Recipe;
  try {
    recipe = (await res.json()) as Recipe;
  } catch {
    console.log(`  SKIP ${key}: not JSON`);
    continue;
  }
  if (!Array.isArray(recipe.ingredients)) continue;

  const changes: string[] = [];
  recipe.ingredients = recipe.ingredients.map((ing) => {
    if (typeof ing?.name !== "string") return ing;
    const line = [ing.amount, ing.unit, ing.name].filter((s) => typeof s === "string" && s.trim()).join(" ");
    const parsed = parseIngredientLine(line);
    if (!parsed) return ing;
    const same =
      parsed.name === ing.name && (parsed.amount ?? "") === (ing.amount ?? "") && (parsed.unit ?? "") === (ing.unit ?? "");
    if (same) return ing;
    changes.push(`  ${show(ing)}  ->  ${show(parsed)}`);
    const next: Ingredient = { ...ing, name: parsed.name };
    if (parsed.amount) next.amount = parsed.amount;
    else delete next.amount;
    if (parsed.unit) next.unit = parsed.unit;
    else delete next.unit;
    return next;
  });

  if (changes.length === 0) continue;
  recipesChanged++;
  linesChanged += changes.length;
  console.log(`${recipe.title} (${key.slice("recipe:".length)}):`);
  for (const c of changes) console.log(c);

  if (apply) {
    const put = await fetch(`${baseUrl}/values/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(recipe),
    });
    console.log(put.ok ? "  saved" : `  FAILED ${put.status}`);
  }
}

console.log(`\n${recipesChanged} recipes, ${linesChanged} ingredient lines ${apply ? "updated" : "would change"}.`);
if (!apply && recipesChanged > 0) console.log("Dry run. Re-run with --apply to write.");
