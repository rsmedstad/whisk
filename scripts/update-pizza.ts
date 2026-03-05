// Add photo to Homemade Pizza recipe
const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";
const R2_BUCKET = "whisk-photos";

const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token found"); process.exit(1); }
const token = tokenMatch[1];

const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const r2Base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects`;
const headers = { Authorization: `Bearer ${token}` };

const RECIPE_ID = "r_bbdbc093";

// Try multiple pizza image sources
const imageSources = [
  "https://cdn.pixabay.com/photo/2017/12/09/08/18/pizza-3007395_1280.jpg",
  "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800",
  "https://images.pexels.com/photos/315755/pexels-photo-315755.jpeg?auto=compress&w=800",
];

let thumbnailUrl: string | undefined;
for (const imageUrl of imageSources) {
  try {
    console.log(`Trying: ${imageUrl.slice(0, 60)}...`);
    const imgRes = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(10000),
    });
    if (!imgRes.ok) { console.log(`  HTTP ${imgRes.status}`); continue; }

    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) { console.log(`  Not an image: ${contentType}`); continue; }

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const filename = `import-${RECIPE_ID.replace("r_", "")}.${ext}`;
    const body = await imgRes.arrayBuffer();

    if (body.byteLength < 1000) { console.log(`  Too small: ${body.byteLength} bytes`); continue; }

    const uploadRes = await fetch(`${r2Base}/${filename}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": contentType },
      body,
    });
    if (uploadRes.ok) {
      thumbnailUrl = `/photos/${filename}`;
      console.log(`  Uploaded: ${thumbnailUrl} (${(body.byteLength / 1024).toFixed(0)} KB)`);
      break;
    }
    console.log(`  Upload failed: ${uploadRes.status}`);
  } catch (e) { console.log(`  Failed: ${(e as Error).message}`); }
}

if (!thumbnailUrl) {
  console.log("All image sources failed. Recipe will remain without a photo.");
  process.exit(0);
}

// Update the recipe with the photo
const existingRes = await fetch(`${kvBase}/values/${encodeURIComponent(`recipe:${RECIPE_ID}`)}`, { headers });
const existing = await existingRes.json() as Record<string, unknown>;

const merged = {
  ...existing,
  thumbnailUrl,
  updatedAt: new Date().toISOString(),
};

const putRes = await fetch(`${kvBase}/values/${encodeURIComponent(`recipe:${RECIPE_ID}`)}`, {
  method: "PUT",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify(merged),
});

console.log(putRes.ok ? "Done!" : `FAILED: ${putRes.status}`);
