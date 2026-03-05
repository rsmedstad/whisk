const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";
const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token"); process.exit(1); }
const token = tokenMatch[1];
const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const headers = { Authorization: `Bearer ${token}` };

// Find salmon recipes
const listRes = await fetch(`${kvBase}/keys?prefix=recipe:`, { headers });
const keys = ((await listRes.json()) as { result: { name: string }[] }).result;

for (const { name: key } of keys) {
  if (key === "recipe_index") continue;
  const res = await fetch(`${kvBase}/values/${encodeURIComponent(key)}`, { headers });
  const d = await res.json() as Record<string, unknown>;
  const title = (d.title as string) ?? "";
  if (title.toLowerCase().includes("salmon") || title.toLowerCase().includes("citrus")) {
    console.log(`\n=== ${key} ===`);
    console.log(`Title: ${title}`);
    console.log(`Ingredients: ${(d.ingredients as unknown[])?.length ?? 0}`);
    console.log(`Steps: ${(d.steps as unknown[])?.length ?? 0}`);
    console.log(`Thumb: ${d.thumbnailUrl}`);
    console.log(`Photos: ${JSON.stringify(d.photos)}`);
  }
}
