// Fix drink recipes with broken photo arrays (undefined URLs from Instagram imports)
// Sets photos array to use thumbnailUrl as the single photo when photos have no URLs.
// Usage: bun run scripts/fix-drink-photos.ts [--dry-run]

const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";

const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token found"); process.exit(1); }
const token = tokenMatch[1];
const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const headers = { Authorization: `Bearer ${token}` };

const dryRun = process.argv.includes("--dry-run");

// Get recipe index
const indexRes = await fetch(`${base}/values/${encodeURIComponent("recipes:index")}`, { headers });
const index = JSON.parse(await indexRes.text()) as { id: string; title: string; tags: string[] }[];

const drinks = index.filter((r) => r.tags.includes("drinks"));
console.log(`Found ${drinks.length} drink recipes\n`);

let fixed = 0;

for (const entry of drinks) {
  const res = await fetch(`${base}/values/${encodeURIComponent(`recipe:${entry.id}`)}`, { headers });
  const recipe = JSON.parse(await res.text()) as Record<string, unknown> & {
    title: string;
    thumbnailUrl?: string;
    photos?: { url: string; isPrimary: boolean }[];
  };

  // Check if photos array has entries with missing URLs
  const hasValidPhotos = recipe.photos?.some((p) => p.url);
  const hasBrokenPhotos = recipe.photos?.some((p) => !p.url);

  if (hasBrokenPhotos && recipe.thumbnailUrl) {
    console.log(`FIX: "${recipe.title}" — replacing broken photos with thumbnailUrl`);

    if (hasValidPhotos) {
      // Keep valid photos, remove broken ones
      recipe.photos = recipe.photos!.filter((p) => p.url);
    } else {
      // All photos broken — use thumbnailUrl
      recipe.photos = [{ url: recipe.thumbnailUrl, isPrimary: true }];
    }

    if (!dryRun) {
      const putRes = await fetch(`${base}/values/${encodeURIComponent(`recipe:${entry.id}`)}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(recipe),
      });
      const putData = (await putRes.json()) as { success: boolean };
      if (putData.success) {
        console.log(`  Updated successfully`);
      } else {
        console.error(`  FAILED to update`);
      }
    }
    fixed++;
  }
}

console.log(`\n${fixed} recipes ${dryRun ? "would be" : ""} fixed`);
