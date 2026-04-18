// Migrate recipes whose steps are bare strings into {text: string} objects.
// Usage: CF_ACCOUNT_ID=<id> bun scripts/fix-string-steps.ts

import { getKVClient } from "./lib/cloudflare";

const { baseUrl, headers } = await getKVClient();

const listRes = await fetch(`${baseUrl}/keys?prefix=recipe:`, { headers });
const listData = (await listRes.json()) as { result: { name: string }[] };

let fixed = 0;
let scanned = 0;

for (const { name: key } of listData.result) {
  scanned++;
  const res = await fetch(`${baseUrl}/values/${encodeURIComponent(key)}`, { headers });
  const text = await res.text();
  let recipe: any;
  try {
    recipe = JSON.parse(text);
  } catch {
    console.log(`skip: ${key} (parse error)`);
    continue;
  }

  let changed = false;

  if (Array.isArray(recipe.steps)) {
    const newSteps = recipe.steps
      .map((s: unknown) => {
        if (typeof s === "string") {
          changed = true;
          return { text: s };
        }
        if (s && typeof s === "object" && typeof (s as any).text === "string") return s;
        changed = true;
        return null;
      })
      .filter((s: unknown) => s !== null);
    recipe.steps = newSteps;
  }

  if (Array.isArray(recipe.ingredients)) {
    const newIng = recipe.ingredients
      .map((i: unknown) => {
        if (typeof i === "string") {
          changed = true;
          return { name: i };
        }
        if (i && typeof i === "object" && typeof (i as any).name === "string") return i;
        changed = true;
        return null;
      })
      .filter((i: unknown) => i !== null);
    recipe.ingredients = newIng;
  }

  if (!changed) continue;

  recipe.updatedAt = new Date().toISOString();

  const putRes = await fetch(`${baseUrl}/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(recipe),
  });
  if (!putRes.ok) {
    console.log(`FAIL ${key}: ${putRes.status} ${await putRes.text()}`);
    continue;
  }
  fixed++;
  console.log(`fixed: ${key} | ${recipe.title ?? "?"}`);
}

console.log(`\nScanned ${scanned}, fixed ${fixed}`);
console.log("Run rebuild-index.ts next to refresh the recipe_index.");
