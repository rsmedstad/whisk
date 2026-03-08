import type { CsvRow } from "../types";

/** Detect whether content uses tabs (Google Sheets paste) or commas. */
export function detectDelimiter(content: string): "," | "\t" {
  const firstLine = content.split("\n")[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs >= 2 ? "\t" : ",";
}

export function parseCsv(content: string): CsvRow[] {
  const delimiter = detectDelimiter(content);
  const lines = content.split("\n");
  const rows: CsvRow[] = [];

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    const fields = delimiter === "\t" ? line.split("\t") : parseCsvLine(line);
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

export function parseCsvLine(line: string): string[] {
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

const TAG_MAPPINGS: Record<string, string[]> = {
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
  quick: ["quick"],
  soup: ["dinner"],
  salad: ["lunch", "healthy"],
  pasta: ["italian", "dinner"],
};

export function categoryToTags(category: string): string[] {
  const lower = category.toLowerCase().trim();
  if (!lower) return [];
  return TAG_MAPPINGS[lower] ?? [lower];
}

export function isUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return /^https?:\/\//.test(str);
  }
}
