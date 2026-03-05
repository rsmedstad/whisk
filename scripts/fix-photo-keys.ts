// Fix R2 photo keys: copy from "import-{id}.ext" to "photos/import-{id}.ext"
const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const R2_BUCKET = "whisk-photos";

const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token found"); process.exit(1); }
const token = tokenMatch[1];

const r2Base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects`;
const headers = { Authorization: `Bearer ${token}` };

// List all import-* objects at root level
const listRes = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects?prefix=import-&limit=50`,
  { headers }
);
const listData = await listRes.json() as { result: { key: string }[] };

for (const obj of listData.result) {
  const oldKey = obj.key;
  const newKey = `photos/${oldKey}`;

  console.log(`Copying ${oldKey} -> ${newKey}`);

  // Download the object
  const getRes = await fetch(`${r2Base}/${encodeURIComponent(oldKey)}`, { headers });
  if (!getRes.ok) { console.log(`  Download failed: ${getRes.status}`); continue; }

  const contentType = getRes.headers.get("content-type") ?? "image/jpeg";
  const body = await getRes.arrayBuffer();

  // Upload with photos/ prefix
  const putRes = await fetch(`${r2Base}/${encodeURIComponent(newKey)}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": contentType },
    body,
  });

  console.log(`  ${putRes.ok ? "Done" : `FAILED: ${putRes.status}`} (${(body.byteLength / 1024).toFixed(0)} KB)`);
}

console.log("\nAll photos copied with photos/ prefix.");
