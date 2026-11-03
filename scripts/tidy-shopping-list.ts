// Rewrite a book's saved shopping list into buyable form: recipe measures become
// store items ("1/2 cup onion" -> 1 onion, "6 garlic cloves" -> 1 head garlic) and
// aisles are recomputed for changed items. Same pass as the app's Organize button.
// --drop-staples also removes recipe-added salt, oil, spices and other staples
// (what Add Essentials skips). Dry run by default; pass --apply to write.
//
// Usage:
//   CF_ACCOUNT_ID=your-id bun scripts/tidy-shopping-list.ts --config wrangler-demo.toml --drop-staples --apply

import { nanoid } from "nanoid";
import { getKVClient } from "./lib/cloudflare";
import { isStapleIngredient, tidyRecipeItems } from "../src/lib/grocery";
import { categorizeIngredient } from "../src/lib/categories";
import type { ShoppingList } from "../src/types";

const apply = process.argv.includes("--apply");
const dropStaples = process.argv.includes("--drop-staples");
const configIdx = process.argv.indexOf("--config");
const configFile = configIdx >= 0 ? process.argv[configIdx + 1] : undefined;
const KEY = "shopping:current";

const { baseUrl, headers } = await getKVClient(configFile);
console.log(`Namespace from ${configFile ?? "wrangler.toml"}${apply ? "" : " (dry run)"}\n`);

const res = await fetch(`${baseUrl}/values/${encodeURIComponent(KEY)}`, { headers });
if (res.status === 404) {
  console.log("No shopping list saved.");
  process.exit(0);
}
const list = (await res.json()) as ShoppingList;
const show = (i: { amount?: string; unit?: string; name: string }) => [i.amount, i.unit, i.name].filter(Boolean).join(" ");

const before = new Map(list.items.map((i) => [i.id, i]));
const kept = dropStaples ? list.items.filter((i) => i.addedBy !== "recipe" || !isStapleIngredient(i)) : list.items;
const tidied = tidyRecipeItems(kept, () => nanoid(10));
const items = tidied.items;
const changed = tidied.changed || kept.length !== list.items.length;
const next = items.map((i) =>
  i.addedBy === "recipe" && before.get(i.id)?.name !== i.name
    ? { ...i, category: categorizeIngredient(i.name), subcategory: undefined }
    : i
);

for (const old of list.items) {
  const now = next.find((n) => n.id === old.id);
  console.log(`${show(old).padEnd(60).slice(0, 60)} -> ${now ? `${show(now)} [${now.category}]` : "(merged or dropped)"}`);
}
console.log(`\n${list.items.length} items -> ${next.length}${changed ? "" : " (no changes)"}`);

if (apply && changed) {
  const put = await fetch(`${baseUrl}/values/${encodeURIComponent(KEY)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ...list, items: next, updatedAt: new Date().toISOString() }),
  });
  console.log(put.ok ? "Saved." : `FAILED ${put.status}`);
  if (!put.ok) process.exit(1);
} else if (!apply && changed) {
  console.log("Dry run. Re-run with --apply to write.");
}
