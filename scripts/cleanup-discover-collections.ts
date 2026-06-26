// One-time cleanup for the Discover feed:
//   1. Point the BBC Good Food source at its recipes RSS feed (individual
//      recipes) instead of scraping the collection-heavy homepage.
//   2. Purge collection/roundup/editorial "hub" pages that were archived as if
//      they were individual recipes (they have no ingredients or steps).
//
// Backs up discover_config + discover_archive to the scratchpad before writing,
// so the change is reversible. Idempotent — safe to run more than once.
//
// Usage:
//   CF_ACCOUNT_ID=<id> bun scripts/cleanup-discover-collections.ts
import { getKVClient } from "./lib/cloudflare";

// Mirror of the server-side filters in functions/api/discover/feed.ts
function isNonRecipeUrl(url: string): boolean {
  const lc = (url ?? "").toLowerCase();
  if (/\/(?:collections?|roundups?|galler(?:y|ies)|premium)\//.test(lc)) return true;
  if (/\/(?:reviews?|health|news-?trends?|news|how-?to|guides?|inspiration|advice|shopping|wellness|opinion|video)\//.test(lc)) return true;
  return false;
}
function isCollectionTitle(title: string): boolean {
  const t = (title ?? "").trim();
  if (t.split(/\s+/).length < 2) return false;
  return /\b(?:recipes|ideas|dishes|bakes|traybakes|dinners|lunches|breakfasts|desserts|mains|sides)$/i.test(t);
}

const BBC_FEED = "https://www.bbcgoodfood.com/recipes/feed";
const BACKUP_DIR = "c:/tmp";

const { baseUrl, headers } = await getKVClient();

async function getKey(key: string): Promise<any | null> {
  const res = await fetch(`${baseUrl}/values/${key}`, { headers });
  if (!res.ok) return null;
  return res.json();
}
async function putKey(key: string, value: unknown): Promise<boolean> {
  const res = await fetch(`${baseUrl}/values/${key}`, {
    method: "PUT", headers, body: JSON.stringify(value),
  });
  return res.ok;
}

// ── Config: fix BBC feedUrl ──
const config = await getKey("discover_config");
if (config?.sources) {
  await Bun.write(`${BACKUP_DIR}/discover_config.backup.json`, JSON.stringify(config, null, 2));
  const bbc = config.sources.find((s: any) => s.id === "bbcgoodfood");
  if (bbc && bbc.feedUrl !== BBC_FEED) {
    console.log(`BBC feedUrl: ${bbc.feedUrl ?? "(none)"} -> ${BBC_FEED}`);
    bbc.feedUrl = BBC_FEED;
    console.log("config write:", (await putKey("discover_config", config)) ? "ok" : "FAILED");
  } else {
    console.log(bbc ? "BBC feedUrl already correct." : "No bbcgoodfood source in config — skipping.");
  }
} else {
  console.log("No discover_config found — skipping config update.");
}

// ── Archive: purge collection/roundup items ──
const archive = await getKey("discover_archive");
if (archive?.items) {
  await Bun.write(`${BACKUP_DIR}/discover_archive.backup.json`, JSON.stringify(archive, null, 2));
  const before = archive.items.length;
  const removed = archive.items.filter((i: any) => isNonRecipeUrl(i.url) || isCollectionTitle(i.title));
  archive.items = archive.items.filter((i: any) => !(isNonRecipeUrl(i.url) || isCollectionTitle(i.title)));
  console.log(`\nArchive: ${before} -> ${archive.items.length} items (removed ${removed.length})`);
  for (const i of removed) console.log(`  - ${i.source} | ${i.title}`);
  if (removed.length > 0) {
    console.log("\narchive write:", (await putKey("discover_archive", archive)) ? "ok" : "FAILED");
  } else {
    console.log("Nothing to purge.");
  }
} else {
  console.log("No discover_archive found — skipping purge.");
}

console.log(`\nBackups saved to ${BACKUP_DIR}/discover_{config,archive}.backup.json`);
