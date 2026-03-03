#!/usr/bin/env bun
/**
 * Audit all recipes in the live Whisk instance.
 *
 * Reports:
 *  - Total recipe count
 *  - Recipes with 0 ingredients (stubs)
 *  - Recipes with 0 steps
 *  - Recipes with no image
 *  - Recipes with source URLs that could be re-scraped
 *
 * Usage:
 *   bun scripts/audit-recipes.ts [--api URL] [--password PASSWORD]
 */

const API_BASE = getArg("--api") ?? "https://whisk-15t.pages.dev";
const PASSWORD = getArg("--password") ?? "test123";

interface Recipe {
  id: string;
  title: string;
  ingredients: { name: string }[];
  steps: { text: string }[];
  photos: { url: string }[];
  thumbnailUrl?: string;
  source?: { type: string; url?: string; domain?: string };
  tags: string[];
  notes?: string;
}

interface IndexEntry {
  id: string;
  title: string;
  thumbnailUrl?: string;
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

async function main() {
  console.log(`Auditing recipes at ${API_BASE}\n`);

  const token = await authenticate();
  console.log("Authenticated.\n");

  const index = await fetchIndex(token);
  console.log(`Total recipes in index: ${index.length}\n`);

  // Fetch all full recipes (with rate limiting to be polite)
  const recipes: Recipe[] = [];
  for (const entry of index) {
    recipes.push(await fetchRecipe(token, entry.id));
  }

  // Analyze
  const noIngredients: Recipe[] = [];
  const noSteps: Recipe[] = [];
  const noImage: Recipe[] = [];
  const hasUrlCanRescrape: Recipe[] = [];
  const textOnlyStubs: Recipe[] = [];

  for (const r of recipes) {
    const ingredientCount = r.ingredients?.length ?? 0;
    const stepCount = r.steps?.length ?? 0;
    const hasImage = !!(r.thumbnailUrl || (r.photos && r.photos.length > 0));
    const sourceUrl = r.source?.url;

    if (ingredientCount === 0) noIngredients.push(r);
    if (stepCount === 0) noSteps.push(r);
    if (!hasImage) noImage.push(r);

    // Can re-scrape: has a URL source and missing ingredients or steps
    if (sourceUrl && (ingredientCount === 0 || stepCount === 0)) {
      hasUrlCanRescrape.push(r);
    }

    // Text-only stubs: no URL source and missing data
    if (!sourceUrl && (ingredientCount === 0 || stepCount === 0)) {
      textOnlyStubs.push(r);
    }
  }

  // Report
  console.log("═══════════════════════════════════════════");
  console.log("  RECIPE AUDIT REPORT");
  console.log("═══════════════════════════════════════════\n");

  console.log(`Total recipes:           ${recipes.length}`);
  console.log(`With 0 ingredients:      ${noIngredients.length}`);
  console.log(`With 0 steps:            ${noSteps.length}`);
  console.log(`With no image:           ${noImage.length}`);
  console.log(`Re-scrapable (has URL):  ${hasUrlCanRescrape.length}`);
  console.log(`Text-only stubs (no URL): ${textOnlyStubs.length}`);

  if (noIngredients.length > 0) {
    console.log("\n── Recipes with 0 ingredients ──────────────");
    for (const r of noIngredients) {
      const url = r.source?.url ?? "(no URL)";
      const steps = r.steps?.length ?? 0;
      console.log(`  ${r.title}`);
      console.log(`    ID: ${r.id} | Steps: ${steps} | Source: ${url}`);
    }
  }

  if (noSteps.length > 0) {
    console.log("\n── Recipes with 0 steps ────────────────────");
    for (const r of noSteps) {
      const url = r.source?.url ?? "(no URL)";
      const ingredients = r.ingredients?.length ?? 0;
      console.log(`  ${r.title}`);
      console.log(`    ID: ${r.id} | Ingredients: ${ingredients} | Source: ${url}`);
    }
  }

  if (noImage.length > 0) {
    console.log("\n── Recipes with no image ───────────────────");
    for (const r of noImage) {
      console.log(`  ${r.title} (${r.id})`);
    }
  }

  if (hasUrlCanRescrape.length > 0) {
    console.log("\n── Re-scrapable stubs (have URL, missing data) ──");
    for (const r of hasUrlCanRescrape) {
      const ing = r.ingredients?.length ?? 0;
      const steps = r.steps?.length ?? 0;
      console.log(`  ${r.title}`);
      console.log(`    ID: ${r.id} | Ingredients: ${ing} | Steps: ${steps}`);
      console.log(`    URL: ${r.source?.url}`);
    }
  }

  if (textOnlyStubs.length > 0) {
    console.log("\n── Text-only stubs (no URL, need manual entry) ──");
    for (const r of textOnlyStubs) {
      console.log(`  ${r.title} (${r.id})`);
    }
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  AUDIT COMPLETE");
  console.log("═══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
