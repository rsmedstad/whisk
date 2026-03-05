// Read wrangler OAuth token and list all recipes from KV via Cloudflare REST API
const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";

// Extract OAuth token from wrangler config
const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token found"); process.exit(1); }
const token = tokenMatch[1];

const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const headers = { Authorization: `Bearer ${token}` };

// List all recipe keys
const listRes = await fetch(`${base}/keys?prefix=recipe:`, { headers });
const listData = (await listRes.json()) as { result: { name: string }[] };

console.log(`Found ${listData.result.length} recipe keys\n`);

for (const { name: key } of listData.result) {
  const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, { headers });
  const text = await res.text();
  try {
    const d = JSON.parse(text);
    const id = key.replace("recipe:", "");
    console.log(`${id} | ${d.title ?? "?"} | src=${d.sourceUrl ?? ""} | thumb=${(d.thumbnailUrl ?? "").slice(0, 50)} | ing=${(d.ingredients ?? []).length} | steps=${(d.steps ?? []).length}`);
  } catch (e) {
    console.log(`${key} | PARSE ERROR: ${(e as Error).message?.slice(0, 60)}`);
  }
}
