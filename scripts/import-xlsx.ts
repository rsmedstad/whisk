#!/usr/bin/env bun
/**
 * Import recipes from the Google Sheets Excel export into a live Whisk instance.
 *
 * Usage:
 *   bun scripts/import-xlsx.ts <xlsx-path> --api-url <url> --password <password> [--dry-run]
 */

import XLSX from "xlsx";

const TAG_MAPPINGS: Record<string, string[]> = {
  appetizer: ["appetizer"],
  breakfast: ["breakfast"],
  "breakfast or dessert": ["breakfast", "dessert"],
  "dessert or breakfast": ["breakfast", "dessert"],
  "breakfast or dessert": ["breakfast", "dessert"],
  dessert: ["dessert"],
  dinner: ["dinner"],
  soup: ["soup", "dinner"],
  salad: ["salad"],
  marinade: ["marinade", "dinner"],
  sauce: ["sauce"],
};

function categoryToTags(category: string): string[] {
  const lower = category.toLowerCase().trim();
  if (!lower) return [];
  return TAG_MAPPINGS[lower] ?? [lower];
}

function isUrl(str: string): boolean {
  return /^https?:\/\//.test(str?.trim() ?? "");
}

interface ScrapedRecipe {
  title: string;
  description?: string;
  ingredients: { name: string; amount?: string; unit?: string }[];
  steps: { text: string }[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  thumbnailUrl?: string;
  photos?: { url: string; isPrimary: boolean }[];
}

async function main() {
  const args = process.argv.slice(2);
  const xlsxPath = args[0];
  const dryRun = args.includes("--dry-run");
  const apiUrlIdx = args.indexOf("--api-url");
  const passwordIdx = args.indexOf("--password");

  const apiUrl = apiUrlIdx >= 0 ? args[apiUrlIdx + 1] : undefined;
  const password = passwordIdx >= 0 ? args[passwordIdx + 1] : undefined;

  if (!xlsxPath) {
    console.log(
      "Usage: bun scripts/import-xlsx.ts <xlsx-path> --api-url <url> --password <password> [--dry-run]"
    );
    process.exit(1);
  }

  // Read Excel
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<{
    category?: string;
    dish?: string;
    link?: string;
    notes?: string;
    ingredientNotes?: string;
  }>(ws, {
    header: ["category", "dish", "link", "notes", "ingredientNotes"],
  });

  // Skip header, filter to rows with dish names
  const recipes = rows
    .slice(1)
    .filter((r) => r.dish && r.dish.trim());

  console.log(`Found ${recipes.length} recipes`);
  const urlRecipes = recipes.filter((r) => isUrl(r.link ?? ""));
  console.log(
    `  ${urlRecipes.length} with URLs, ${recipes.length - urlRecipes.length} text-only`
  );

  if (dryRun) {
    console.log("\n--- Dry Run ---");
    for (const r of recipes.slice(0, 10)) {
      const tags = categoryToTags(r.category ?? "");
      console.log(
        `  ${r.dish} [${tags.join(", ")}] ${isUrl(r.link ?? "") ? "URL" : "text"}`
      );
    }
    if (recipes.length > 10)
      console.log(`  ... and ${recipes.length - 10} more`);
    return;
  }

  if (!apiUrl || !password) {
    console.error("--api-url and --password are required (unless --dry-run)");
    process.exit(1);
  }

  // Authenticate
  console.log(`\nAuthenticating with ${apiUrl}...`);
  const authRes = await fetch(`${apiUrl}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!authRes.ok) {
    console.error("Auth failed:", await authRes.text());
    process.exit(1);
  }

  const { token } = (await authRes.json()) as { token: string };
  console.log("Authenticated.\n");

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i]!;
    const tags = categoryToTags(r.category ?? "");
    const notesParts: string[] = [];
    if (r.notes) notesParts.push(r.notes);
    if (r.ingredientNotes)
      notesParts.push(`Ingredients: ${r.ingredientNotes}`);

    process.stdout.write(
      `[${i + 1}/${recipes.length}] ${r.dish}... `
    );

    try {
      if (isUrl(r.link ?? "")) {
        // Scrape URL
        const scrapeRes = await fetch(`${apiUrl}/api/import/url`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            url: r.link,
            downloadImage: true,
          }),
        });

        if (!scrapeRes.ok) {
          const errText = await scrapeRes.text();
          console.log(`SCRAPE FAILED (${scrapeRes.status}), creating stub`);
          // Create stub instead
          await fetch(`${apiUrl}/api/recipes`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              title: r.dish,
              ingredients: [],
              steps: [],
              tags,
              notes: notesParts.join("\n\n") || undefined,
              source: {
                type: "url",
                url: r.link,
                domain: new URL(r.link!).hostname,
              },
              photos: [],
              favorite: false,
            }),
          });
          success++;
          continue;
        }

        const scraped = (await scrapeRes.json()) as ScrapedRecipe;

        // Normalize thumbnailUrl — some sites return objects
        const thumbUrl =
          typeof scraped.thumbnailUrl === "string"
            ? scraped.thumbnailUrl
            : undefined;

        // Create recipe
        const createRes = await fetch(`${apiUrl}/api/recipes`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: scraped.title || r.dish,
            description: scraped.description,
            ingredients: scraped.ingredients,
            steps: scraped.steps,
            prepTime: scraped.prepTime,
            cookTime: scraped.cookTime,
            servings: scraped.servings,
            thumbnailUrl: thumbUrl,
            photos: scraped.photos ?? [],
            tags,
            notes: notesParts.join("\n\n") || undefined,
            source: {
              type: "url",
              url: r.link,
              domain: new URL(r.link!).hostname,
            },
            favorite: false,
          }),
        });

        if (createRes.ok) {
          const thumb =
            typeof scraped.thumbnailUrl === "string"
              ? scraped.thumbnailUrl
              : "";
          const hasImg = thumb.startsWith("/photos/");
          console.log(`OK${hasImg ? " (+ image)" : ""}`);
          success++;
        } else {
          console.log(`CREATE FAILED: ${createRes.status}`);
          failed++;
        }
      } else {
        // Text-only recipe
        const createRes = await fetch(`${apiUrl}/api/recipes`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: r.dish,
            ingredients: [],
            steps: r.link ? [{ text: r.link }] : [],
            tags,
            notes: notesParts.join("\n\n") || undefined,
            source: { type: "manual" },
            photos: [],
            favorite: false,
          }),
        });

        if (createRes.ok) {
          console.log("OK (stub)");
          success++;
        } else {
          console.log(`FAILED: ${createRes.status}`);
          failed++;
        }
      }
    } catch (err) {
      console.log(
        `ERROR: ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }

  console.log(
    `\nDone! ${success} imported, ${failed} failed, ${skipped} skipped`
  );
}

main().catch(console.error);
