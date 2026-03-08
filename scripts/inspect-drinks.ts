// Inspect photo data for drink recipes to diagnose duplicate images
// Usage: bun run scripts/inspect-drinks.ts

const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";

const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token found"); process.exit(1); }
const token = tokenMatch[1];
const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const headers = { Authorization: `Bearer ${token}` };

// Get recipe index
const indexRes = await fetch(`${base}/values/${encodeURIComponent("recipes:index")}`, { headers });
const indexText = await indexRes.text();
console.log("Index response first 200 chars:", indexText.slice(0, 200));
const index = JSON.parse(indexText) as { id: string; title: string; tags: string[]; thumbnailUrl?: string }[];

const drinks = index.filter((r) => r.tags.includes("drinks"));
console.log(`Found ${drinks.length} drink recipes\n`);

for (const entry of drinks) {
  const res = await fetch(`${base}/values/${encodeURIComponent(`recipe:${entry.id}`)}`, { headers });
  const recipe = (await res.json()) as {
    title: string;
    thumbnailUrl?: string;
    photos?: { url: string; isPrimary: boolean; caption?: string }[];
    source?: { type: string; url?: string };
  };

  console.log(`=== ${recipe.title} ===`);
  console.log(`  source: ${recipe.source?.type ?? "unknown"} ${recipe.source?.url ?? ""}`);
  console.log(`  thumbnailUrl: ${recipe.thumbnailUrl ?? "(none)"}`);
  console.log(`  photos (${recipe.photos?.length ?? 0}):`);
  if (recipe.photos) {
    for (const p of recipe.photos) {
      console.log(`    ${p.isPrimary ? "[PRIMARY]" : "         "} ${p.url}`);
    }
  }
  console.log();
}
