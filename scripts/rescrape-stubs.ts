#!/usr/bin/env bun
/**
 * Re-scrape stub recipes that have a source URL but are missing ingredients/steps.
 *
 * For each matching recipe:
 *  1. Calls POST /api/import/url to re-scrape
 *  2. Merges scraped data into existing recipe (preserving tags, notes, favorite)
 *  3. PUTs the updated recipe back
 *
 * Usage:
 *   bun scripts/rescrape-stubs.ts [--api URL] [--password PASSWORD] [--dry-run]
 */

const API_BASE = getArg("--api") ?? "http://localhost:5173";
const PASSWORD = getArg("--password") ?? "test123";
const DRY_RUN = process.argv.includes("--dry-run");

interface Recipe {
  id: string;
  title: string;
  description?: string;
  ingredients: { name: string; amount?: string; unit?: string }[];
  steps: { text: string }[];
  photos: { url: string; isPrimary: boolean }[];
  thumbnailUrl?: string;
  source?: { type: string; url?: string; domain?: string };
  tags: string[];
  notes?: string;
  favorite: boolean;
  cuisine?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
}

interface IndexEntry {
  id: string;
  title: string;
}

interface ScrapeResult {
  title?: string;
  description?: string;
  ingredients?: { name: string; amount?: string; unit?: string }[];
  steps?: { text: string }[];
  thumbnailUrl?: string;
  photos?: { url: string; isPrimary: boolean }[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  error?: string;
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function authenticate(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function fetchIndex(token: string): Promise<IndexEntry[]> {
  const res = await fetch(`${API_BASE}/api/recipes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch index: ${res.status}`);
  return (await res.json()) as IndexEntry[];
}

async function fetchRecipe(token: string, id: string): Promise<Recipe> {
  const res = await fetch(`${API_BASE}/api/recipes/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch recipe ${id}: ${res.status}`);
  return (await res.json()) as Recipe;
}

async function scrapeUrl(
  token: string,
  url: string
): Promise<ScrapeResult> {
  const res = await fetch(`${API_BASE}/api/import/url`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, downloadImage: true }),
  });
  return (await res.json()) as ScrapeResult;
}

async function updateRecipe(
  token: string,
  id: string,
  updates: Partial<Recipe>
): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/recipes/${id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });
  return res.ok;
}

async function main() {
  console.log(`Re-scraping stubs at ${API_BASE}`);
  if (DRY_RUN) console.log("(DRY RUN — no changes will be made)\n");
  else console.log();

  const token = await authenticate();
  console.log("Authenticated.\n");

  const index = await fetchIndex(token);
  console.log(`Total recipes: ${index.length}\n`);

  // Find stubs: have URL source, missing ingredients or steps
  const stubs: Recipe[] = [];
  for (const entry of index) {
    const recipe = await fetchRecipe(token, entry.id);
    const hasUrl = !!recipe.source?.url;
    const missingData =
      (recipe.ingredients?.length ?? 0) === 0 ||
      (recipe.steps?.length ?? 0) === 0;
    if (hasUrl && missingData) {
      stubs.push(recipe);
    }
  }

  console.log(`Found ${stubs.length} stub recipes with URLs to re-scrape.\n`);

  if (stubs.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipe of stubs) {
    const url = recipe.source!.url!;
    console.log(`── ${recipe.title} ──`);
    console.log(`   URL: ${url}`);

    if (DRY_RUN) {
      console.log("   [DRY RUN] Would re-scrape and update\n");
      skipped++;
      continue;
    }

    const scraped = await scrapeUrl(token, url);

    if (scraped.error) {
      console.log(`   FAILED: ${scraped.error}\n`);
      failed++;
      continue;
    }

    // Merge: only fill in missing data, preserve existing tags/notes/favorite
    const updates: Partial<Recipe> = {};

    if (
      (recipe.ingredients?.length ?? 0) === 0 &&
      scraped.ingredients &&
      scraped.ingredients.length > 0
    ) {
      updates.ingredients = scraped.ingredients;
      console.log(`   + ${scraped.ingredients.length} ingredients`);
    }

    if (
      (recipe.steps?.length ?? 0) === 0 &&
      scraped.steps &&
      scraped.steps.length > 0
    ) {
      updates.steps = scraped.steps;
      console.log(`   + ${scraped.steps.length} steps`);
    }

    if (!recipe.thumbnailUrl && scraped.thumbnailUrl) {
      updates.thumbnailUrl = scraped.thumbnailUrl;
      updates.photos = scraped.photos;
      console.log(`   + image`);
    }

    if (!recipe.description && scraped.description) {
      updates.description = scraped.description;
    }

    if (!recipe.prepTime && scraped.prepTime) {
      updates.prepTime = scraped.prepTime;
    }
    if (!recipe.cookTime && scraped.cookTime) {
      updates.cookTime = scraped.cookTime;
    }
    if (!recipe.servings && scraped.servings) {
      updates.servings = scraped.servings;
    }

    if (Object.keys(updates).length === 0) {
      console.log("   No new data found from scrape.\n");
      skipped++;
      continue;
    }

    const ok = await updateRecipe(token, recipe.id, updates);
    if (ok) {
      console.log("   Updated successfully.\n");
      success++;
    } else {
      console.log("   FAILED to save update.\n");
      failed++;
    }
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  RE-SCRAPE RESULTS");
  console.log("═══════════════════════════════════════════");
  console.log(`  Total stubs:  ${stubs.length}`);
  console.log(`  Updated:      ${success}`);
  console.log(`  Failed:       ${failed}`);
  console.log(`  Skipped:      ${skipped}`);
  console.log("═══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Re-scrape failed:", err);
  process.exit(1);
});
