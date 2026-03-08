// One-time cleanup: re-run sanitizeImageUrl() / isPersonImage() on existing
// discover_archive items in KV. Clears bad images so the next import will
// re-fetch the correct one.
// Usage: bun run scripts/clean-discover-images.ts [--dry-run]

const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";

const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) {
  console.error("No OAuth token found. Run: npx wrangler whoami");
  process.exit(1);
}
const token = tokenMatch[1];
const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const headers = { Authorization: `Bearer ${token}` };

const dryRun = process.argv.includes("--dry-run");

// ── Image filters (mirrored from functions/api/discover/feed.ts) ──

function isPersonImage(url: string): boolean {
  const lc = url.toLowerCase();
  if (/(?:author|avatar|profile|headshot|byline|contributor|bio|staff|portrait|people|person|user)[\/-]/i.test(lc)) return true;
  if (/(?:\/state\/|\/states\/|\/city\/|\/cities\/|\/location\/|\/destination\/|\/travel\/|\/getty-?images)/i.test(lc)) return true;
  if (/(?:editorial|lifestyle|headshot|portrait|stock-?photo)/i.test(lc)) return true;
  if (lc.includes("gravatar.com") || lc.includes("secure.gravatar")) return true;
  const dimMatch = lc.match(/[/_-](\d+)x(\d+)[./_-]/);
  if (dimMatch) {
    const w = parseInt(dimMatch[1]!, 10);
    const h = parseInt(dimMatch[2]!, 10);
    if (w <= 150 && h <= 150) return true;
  }
  if (lc.includes("nyt.com") && /author|byline/i.test(lc)) return true;
  return false;
}

function sanitizeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith("http")) return undefined;
  if (isPersonImage(url)) return undefined;
  if (url.includes("1x1") || url.includes("pixel")) return undefined;
  return url;
}

// ── Read archive ──

console.log("Reading discover_archive from KV...");
const archiveRes = await fetch(`${kvBase}/values/${encodeURIComponent("discover_archive")}`, { headers });
if (!archiveRes.ok) {
  console.error(`Failed to read archive: ${archiveRes.status}`);
  process.exit(1);
}
const archive = (await archiveRes.json()) as { lastRefreshed: string; items: { title: string; url: string; imageUrl?: string; source: string; category: string; addedAt: string; tags?: string[]; totalTime?: number }[] };

console.log(`Archive has ${archive.items.length} items`);

// ── Clean images ──

let cleared = 0;
let alreadyEmpty = 0;
const clearedItems: { title: string; source: string; oldUrl: string }[] = [];

for (const item of archive.items) {
  if (!item.imageUrl) {
    alreadyEmpty++;
    continue;
  }
  const cleaned = sanitizeImageUrl(item.imageUrl);
  if (cleaned !== item.imageUrl) {
    clearedItems.push({ title: item.title, source: item.source, oldUrl: item.imageUrl });
    item.imageUrl = cleaned;
    cleared++;
  }
}

console.log(`\nResults:`);
console.log(`  Already no image: ${alreadyEmpty}`);
console.log(`  Cleared bad images: ${cleared}`);
console.log(`  Unchanged: ${archive.items.length - alreadyEmpty - cleared}`);

if (clearedItems.length > 0) {
  console.log(`\nCleared items:`);
  for (const item of clearedItems) {
    console.log(`  [${item.source}] "${item.title}"`);
    console.log(`    was: ${item.oldUrl}`);
  }
}

if (cleared === 0) {
  console.log("\nNo changes needed.");
  process.exit(0);
}

if (dryRun) {
  console.log("\n[DRY RUN] No changes written to KV.");
  process.exit(0);
}

// ── Write cleaned archive back ──

console.log("\nWriting cleaned archive to KV...");
const putRes = await fetch(`${kvBase}/values/${encodeURIComponent("discover_archive")}`, {
  method: "PUT",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify(archive),
});
const putData = (await putRes.json()) as { success: boolean; errors?: unknown[] };
if (putData.success) {
  console.log("Archive updated successfully!");
} else {
  console.error("KV write failed:", putData.errors);
  process.exit(1);
}
