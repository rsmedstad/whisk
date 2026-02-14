#!/usr/bin/env bun
/**
 * Import recipes from Google Sheets CSV export.
 *
 * Expected columns:
 *   A: Category (maps to tags, e.g. "Italian", "Dinner")
 *   B: Dish Name (recipe title)
 *   C: Recipe/Link (URL or inline recipe text)
 *   D: Notes (personal notes)
 *   E: Ingredient Notes (additional ingredient info)
 *
 * Usage:
 *   bun scripts/import-csv.ts <path-to-csv> [--dry-run]
 *
 * This script outputs a JSON file that can be uploaded to Whisk KV,
 * or directly pushed via the API if the app is running.
 */

import { readFileSync, writeFileSync } from "fs";

interface CsvRow {
  category: string;
  dishName: string;
  recipeLink: string;
  notes: string;
  ingredientNotes: string;
}

interface ImportedRecipe {
  id: string;
  title: string;
  description?: string;
  ingredients: { name: string }[];
  steps: { text: string }[];
  favorite: boolean;
  photos: never[];
  tags: string[];
  cuisine?: string;
  notes?: string;
  source?: { type: string; url?: string; domain?: string };
  createdAt: string;
  updatedAt: string;
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.split("\n");
  const rows: CsvRow[] = [];

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    // Simple CSV parse (handles quoted fields)
    const fields = parseCsvLine(line);
    if (fields.length < 2) continue;

    rows.push({
      category: fields[0]?.trim() ?? "",
      dishName: fields[1]?.trim() ?? "",
      recipeLink: fields[2]?.trim() ?? "",
      notes: fields[3]?.trim() ?? "",
      ingredientNotes: fields[4]?.trim() ?? "",
    });
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function categoryToTags(category: string): string[] {
  const lower = category.toLowerCase().trim();
  if (!lower) return [];

  // Map common categories to preset tags
  const mappings: Record<string, string[]> = {
    breakfast: ["breakfast"],
    brunch: ["brunch"],
    lunch: ["lunch"],
    dinner: ["dinner"],
    dessert: ["dessert"],
    appetizer: ["appetizer"],
    snack: ["snack"],
    "side dish": ["side dish"],
    side: ["side dish"],
    italian: ["italian", "dinner"],
    mexican: ["mexican", "dinner"],
    asian: ["dinner"],
    chinese: ["chinese", "dinner"],
    thai: ["thai", "dinner"],
    indian: ["indian", "dinner"],
    japanese: ["japanese", "dinner"],
    american: ["american", "dinner"],
    french: ["french", "dinner"],
    mediterranean: ["mediterranean", "dinner"],
    grilling: ["grilling"],
    baking: ["baking"],
    "slow cooker": ["slow cook"],
    "instant pot": ["instant pot"],
    healthy: ["healthy"],
    vegetarian: ["vegetarian"],
    vegan: ["vegan"],
    "gluten-free": ["gluten-free"],
    quick: ["quick", "under 30 min"],
    soup: ["dinner"],
    salad: ["lunch", "healthy"],
    pasta: ["italian", "dinner"],
  };

  return mappings[lower] ?? [lower];
}

function isUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return /^https?:\/\//.test(str);
  }
}

function convertRow(row: CsvRow, index: number): ImportedRecipe {
  const id = `r_import_${index.toString().padStart(4, "0")}`;
  const now = new Date().toISOString();

  const tags = categoryToTags(row.category);

  // Build notes from available fields
  const notesParts: string[] = [];
  if (row.notes) notesParts.push(row.notes);
  if (row.ingredientNotes) notesParts.push(`Ingredients: ${row.ingredientNotes}`);

  // Determine source
  const hasUrl = isUrl(row.recipeLink);
  const source = hasUrl
    ? {
        type: "url",
        url: row.recipeLink,
        domain: (() => {
          try {
            return new URL(row.recipeLink).hostname;
          } catch {
            return undefined;
          }
        })(),
      }
    : { type: "manual" };

  // If recipeLink is text (not URL), treat as steps
  const steps = !hasUrl && row.recipeLink
    ? [{ text: row.recipeLink }]
    : [];

  return {
    id,
    title: row.dishName,
    description: undefined,
    ingredients: [],
    steps,
    favorite: false,
    photos: [],
    tags,
    cuisine: tags.find((t) =>
      ["italian", "mexican", "chinese", "thai", "indian", "japanese", "korean", "mediterranean", "american", "french"].includes(t)
    ),
    notes: notesParts.join("\n\n") || undefined,
    source,
    createdAt: now,
    updatedAt: now,
  };
}

// Main
const args = process.argv.slice(2);
const csvPath = args[0];
const dryRun = args.includes("--dry-run");

if (!csvPath) {
  console.log("Usage: bun scripts/import-csv.ts <path-to-csv> [--dry-run]");
  console.log("\nExpected columns: Category, Dish Name, Recipe/Link, Notes, Ingredient Notes");
  process.exit(1);
}

const content = readFileSync(csvPath, "utf-8");
const rows = parseCsv(content);
const recipes = rows.filter((r) => r.dishName).map(convertRow);

console.log(`Found ${rows.length} rows, ${recipes.length} valid recipes`);

if (dryRun) {
  console.log("\n--- Dry Run ---");
  for (const recipe of recipes.slice(0, 5)) {
    console.log(`  ${recipe.title} [${recipe.tags.join(", ")}]`);
    if (recipe.source?.url) console.log(`    Source: ${recipe.source.url}`);
    if (recipe.notes) console.log(`    Notes: ${recipe.notes.slice(0, 60)}...`);
  }
  if (recipes.length > 5) console.log(`  ... and ${recipes.length - 5} more`);
} else {
  // Build the index
  const index = recipes.map((r) => ({
    id: r.id,
    title: r.title,
    tags: r.tags,
    cuisine: r.cuisine,
    favorite: r.favorite,
    updatedAt: r.updatedAt,
  }));

  // Write individual recipes and index
  const output = {
    recipes,
    index,
    count: recipes.length,
  };

  const outPath = csvPath.replace(/\.csv$/i, "-imported.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${recipes.length} recipes to ${outPath}`);
  console.log(
    "\nTo upload to KV, use wrangler:\n  npx wrangler kv bulk put --namespace-id=<YOUR_KV_ID> recipes.json"
  );
  console.log(
    "\nOr start the dev server and POST each recipe to /api/recipes"
  );
}
