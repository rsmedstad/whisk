const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";
const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const token = config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if (!token) { console.error("No OAuth token found"); process.exit(1); }
const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const headers = { Authorization: `Bearer ${token}` };

const res = await fetch(`${kvBase}/values/${encodeURIComponent("recipe:r_4825501d")}`, { headers });
const recipe = (await res.json()) as Record<string, unknown>;
console.log("Before notes:", recipe.notes);
delete recipe.notes;
recipe.updatedAt = new Date().toISOString();

const putRes = await fetch(`${kvBase}/values/${encodeURIComponent("recipe:r_4825501d")}`, {
  method: "PUT",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify(recipe),
});
console.log(putRes.ok ? "✓ Notes removed" : "✗ Failed");
