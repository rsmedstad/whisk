// List all recipes from KV via Cloudflare REST API
// Usage: CF_ACCOUNT_ID=your-id bun scripts/list-recipes.ts

import { getKVClient } from "./lib/cloudflare";

const { baseUrl, headers } = await getKVClient();

const listRes = await fetch(`${baseUrl}/keys?prefix=recipe:`, { headers });
const listData = (await listRes.json()) as { result: { name: string }[] };

console.log(`Found ${listData.result.length} recipe keys\n`);

for (const { name: key } of listData.result) {
  const res = await fetch(`${baseUrl}/values/${encodeURIComponent(key)}`, { headers });
  const text = await res.text();
  try {
    const d = JSON.parse(text);
    const id = key.replace("recipe:", "");
    console.log(`${id} | ${d.title ?? "?"} | src=${d.sourceUrl ?? ""} | thumb=${(d.thumbnailUrl ?? "").slice(0, 50)} | ing=${(d.ingredients ?? []).length} | steps=${(d.steps ?? []).length}`);
  } catch (e) {
    console.log(`${key} | PARSE ERROR: ${(e as Error).message?.slice(0, 60)}`);
  }
}
