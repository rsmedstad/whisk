#!/usr/bin/env bun
/**
 * Local scrape script — fetches recipe pages from YOUR machine
 * (bypasses Cloudflare-to-Cloudflare blocking), parses them using
 * the same logic as the import endpoint, and pushes results to the API.
 *
 * Usage:
 *   bun scripts/local-scrape.ts [--api URL] [--password PASSWORD] [--dry-run]
 *
 * This fetches all stub recipes that have URLs, scrapes them locally,
 * and updates the API with the results.
 */

const API_BASE = getArg("--api") ?? "https://whisk-15t.pages.dev";
const PASSWORD = getArg("--password") ?? "test123";
const DRY_RUN = process.argv.includes("--dry-run");

interface Recipe {
  id: string;
  title: string;
  ingredients: { name: string; amount?: string; unit?: string }[];
  steps: { text: string }[];
  photos: { url: string; isPrimary: boolean }[];
  thumbnailUrl?: string;
  source?: { type: string; url?: string; domain?: string };
  tags: string[];
  notes?: string;
  description?: string;
  favorite: boolean;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
}

interface IndexEntry {
  id: string;
  title: string;
}

interface RecipeData {
  name?: string;
  description?: string;
  image?: unknown;
  additionalImages?: string[];
  recipeIngredient?: string[];
  recipeInstructions?: unknown[];
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  recipeYield?: string | string[];
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

async function uploadImage(
  token: string,
  imageUrl: string
): Promise<string | null> {
  try {
    const imgRes = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      },
    });
    if (!imgRes.ok) return null;

    const blob = await imgRes.blob();
    const form = new FormData();
    const ext = imageUrl.includes(".png")
      ? "png"
      : imageUrl.includes(".webp")
        ? "webp"
        : "jpg";
    const hash = Math.random().toString(36).slice(2, 14);
    form.append("file", blob, `import-${hash}.${ext}`);

    const uploadRes = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!uploadRes.ok) return null;
    const data = (await uploadRes.json()) as { url: string };
    return data.url;
  } catch {
    return null;
  }
}

// ── Scraping logic (mirrors functions/api/import/url.ts) ────

function stripHtml(str: string): string {
  return str
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&#\d+;/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonLd(html: string): RecipeData | null {
  const jsonLdMatch = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  );
  if (!jsonLdMatch) return null;

  for (const match of jsonLdMatch) {
    try {
      const json = match.replace(/<script[^>]*>|<\/script>/gi, "");
      const parsed = JSON.parse(json);
      const found = findRecipeInLd(parsed);
      if (found) return found as RecipeData;
    } catch {
      continue;
    }
  }
  return null;
}

function findRecipeInLd(data: unknown): unknown | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInLd(item);
      if (found) return found;
    }
    return null;
  }
  const obj = data as Record<string, unknown>;
  const type = obj["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) {
    return obj;
  }
  if (Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"] as unknown[]) {
      const found = findRecipeInLd(item);
      if (found) return found;
    }
  }
  return null;
}

function extractItemprop(html: string, prop: string): string | null {
  const contentMatch = html.match(
    new RegExp(`itemprop="${prop}"[^>]*content="([^"]*)"`, "i")
  );
  if (contentMatch?.[1]) return contentMatch[1];
  const tagMatch = html.match(
    new RegExp(`itemprop="${prop}"[^>]*>([^<]+)`, "i")
  );
  return tagMatch?.[1]?.trim() ?? null;
}

function extractItempropAttr(html: string, prop: string, attr: string): string | null {
  const match = html.match(
    new RegExp(`itemprop="${prop}"[^>]*${attr}="([^"]*)"`, "i")
  );
  return match?.[1] ?? null;
}

function extractAllItemprop(html: string, prop: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(
    `itemprop="${prop}"[^>]*>([\\s\\S]*?)(?=<\\/(?:li|span|div|p))`,
    "gi"
  );
  let m;
  while ((m = regex.exec(html)) !== null) {
    const text = stripHtml(m[1] ?? "").trim();
    if (text) results.push(text);
  }
  return results;
}

function extractFirstTag(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}[^>]*>([^<]+)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function extractFirstImgSrc(html: string): string | null {
  const match = html.match(/<img[^>]*src="([^"]+)"/i);
  return match?.[1] ?? null;
}

function extractTextBlock(html: string, sectionPattern: string): string | null {
  const regex = new RegExp(
    `(?:class|id)="[^"]*(?:${sectionPattern})[^"]*"[^>]*>([\\s\\S]*?)(?=<\\/(?:div|section|ul|ol)>\\s*<(?:div|section|h[23]))`,
    "i"
  );
  const match = html.match(regex);
  if (!match?.[1]) return null;
  return stripHtml(match[1]);
}

const COOKING_KEYWORDS =
  /\b(preheat|bake|cook|stir|mix|combine|whisk|fold|simmer|boil|roast|saut[eé]|chop|dice|slice|drain|reduce|season|serve|cool|chill|refrigerat|marinate|knead|roll|spread|pour|heat|melt|fry|grill|broil|steam|blanch|braise|glaze|brush|toss|layer|arrange|set aside|let\s+(?:stand|rest|cool|sit)|bring\s+to|add\s+the|remove\s+from|place\s+(?:in|on)|transfer|prepare|beat\s+(?:the|until)|cover\s+(?:and|with))\b/i;

function extractCookingParagraphs(html: string): string[] {
  const pTagRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const paragraphs: string[] = [];
  let m;
  while ((m = pTagRegex.exec(html)) !== null) {
    const text = stripHtml(m[1] ?? "").trim();
    if (text.length > 20 && COOKING_KEYWORDS.test(text)) {
      paragraphs.push(text);
    }
  }
  return paragraphs.length >= 2 ? paragraphs : [];
}

function extractMicrodata(html: string): RecipeData | null {
  const recipeBlockMatch = html.match(
    /itemscope[^>]*itemtype="https?:\/\/schema\.org\/Recipe"[\s\S]*?(?=<div class="sharedaddy|<footer|<\/article>|<div id="comments|<section id="comments|<nav\s|<div class="post-navigation)/i
  );
  let jetpackMatch: RegExpMatchArray | null = null;
  if (!recipeBlockMatch) {
    jetpackMatch = html.match(
      /class="[^"]*(?:hrecipe|h-recipe|jetpack-recipe)[^"]*"[^>]*(?:itemscope[^>]*)?>([\s\S]*?)(?=<div class="sharedaddy|<footer|<\/article>|<div id="comments|<section id="comments|<nav\s|<div class="post-navigation)/i
    );
    if (!jetpackMatch) {
      const jetpackStart = html.search(
        /class="[^"]*(?:hrecipe|h-recipe|jetpack-recipe)[^"]*"/i
      );
      if (jetpackStart !== -1) {
        const slice = html.slice(jetpackStart, jetpackStart + 50000);
        jetpackMatch = [slice] as unknown as RegExpMatchArray;
      }
    }
  }

  const block = recipeBlockMatch?.[0] ?? jetpackMatch?.[0];
  if (!block) return null;

  const name = extractItemprop(block, "name") ?? extractFirstTag(block, "h2");
  if (!name) return null;

  const ingredients = extractAllItemprop(block, "recipeIngredient")
    .concat(extractAllItemprop(block, "ingredients"));
  if (ingredients.length === 0) {
    const ingredientBlock = extractTextBlock(block, "ingredient");
    if (ingredientBlock) {
      const lines = ingredientBlock.split("\n").map((l) => l.trim()).filter((l) => l.length > 2 && l.length < 200);
      ingredients.push(...lines);
    }
  }

  const instructions: unknown[] = [];
  const stepTexts = extractAllItemprop(block, "recipeInstructions")
    .concat(extractAllItemprop(block, "step"));
  if (stepTexts.length > 0) {
    instructions.push(...stepTexts);
  } else {
    const instructionBlock = extractTextBlock(block, "instruction|direction|step");
    if (instructionBlock) {
      const lines = instructionBlock.split("\n").map((l) => l.trim()).filter((l) => l.length > 10);
      instructions.push(...lines);
    }
  }
  if (instructions.length === 0) {
    const cookingParagraphs = extractCookingParagraphs(block);
    if (cookingParagraphs.length > 0) instructions.push(...cookingParagraphs);
  }

  const imageUrl =
    extractItempropAttr(block, "image", "src") ??
    extractItempropAttr(block, "image", "content") ??
    extractFirstImgSrc(block);
  const prepTime = extractItempropAttr(block, "prepTime", "content") ?? extractItempropAttr(block, "prepTime", "datetime");
  const cookTime = extractItempropAttr(block, "cookTime", "content") ?? extractItempropAttr(block, "cookTime", "datetime");
  const totalTime = extractItempropAttr(block, "totalTime", "content") ?? extractItempropAttr(block, "totalTime", "datetime");
  const recipeYield = extractItemprop(block, "recipeYield") ?? extractItemprop(block, "yield");
  const description = extractItemprop(block, "description");

  return {
    name: stripHtml(name),
    description: description ? stripHtml(description) : undefined,
    image: imageUrl,
    recipeIngredient: ingredients.map(stripHtml),
    recipeInstructions: instructions,
    prepTime: prepTime ?? undefined,
    cookTime: cookTime ?? undefined,
    totalTime: totalTime ?? undefined,
    recipeYield: recipeYield ? [recipeYield] : undefined,
  };
}

function extractBlogRecipe(html: string): RecipeData | null {
  const contentMatch = html.match(
    /class="(?:entry-content|post-content|article-content)"[^>]*>([\s\S]*?)(?=<\/div>\s*<(?:footer|div class="entry-footer|div class="post-footer|section class="comments"))/i
  );
  if (!contentMatch?.[1]) return null;
  const content = contentMatch[1];

  const titleMatch = content.match(
    /<(?:b|strong)>\s*([^<]{10,100}(?:cake|bread|soup|salad|chicken|beef|salmon|pasta|rice|stew|pie|tart|cookies?|muffins?|sauce|roast|curry|tacos?|chili|stir[- ]?fry|risotto|casserole|dip|dressing|marinade|glaze|pudding|crumble|cobbler|scones?|biscuits?|pancakes?|waffles?|smoothie|bowl|wrap|sandwich|burger|pizza|quiche|frittata|omelet|granola|bars?|brownies?|blondies?))\s*<\/(?:b|strong)>/i
  );
  if (!titleMatch?.[1]) return null;

  const recipeName = stripHtml(titleMatch[1]);
  const recipeStart = content.indexOf(titleMatch[0]);
  const recipeBlock = content.slice(recipeStart);

  const ingredientLines: string[] = [];
  const ingredientRegex = /<(?:p|li)[^>]*>([\s\S]*?)<\/(?:p|li)>/gi;
  const INGREDIENT_PATTERN =
    /^[\d½⅓⅔¼¾⅛⅜⅝⅞]+[\s/\d½⅓⅔¼¾⅛⅜⅝⅞]*\s*(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|liters?|sticks?|cloves?|pinche?s?|dashes?|whole|large|medium|small|packed)/i;

  let im;
  while ((im = ingredientRegex.exec(recipeBlock)) !== null) {
    // Split on <br> to handle ingredients listed within a single <p>
    const lines = (im[1] ?? "").split(/<br\s*\/?>/gi);
    for (const line of lines) {
      const text = stripHtml(line).trim();
      if (text.length > 3 && text.length < 200 && INGREDIENT_PATTERN.test(text)) {
        ingredientLines.push(text);
      }
    }
  }

  const instructions: string[] = [];
  const lastIngredientIdx = ingredientLines.length > 0
    ? recipeBlock.lastIndexOf(ingredientLines[ingredientLines.length - 1]!)
    : 0;
  const instructionBlock = recipeBlock.slice(lastIngredientIdx);
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  while ((im = pRegex.exec(instructionBlock)) !== null) {
    const text = stripHtml(im[1] ?? "").trim();
    if (text.length > 30 && COOKING_KEYWORDS.test(text)) {
      instructions.push(text);
    }
  }

  if (ingredientLines.length < 2 && instructions.length < 2) return null;

  const images: string[] = [];
  const imgRegex = /<img[^>]*src="([^"]+)"[^>]*>/gi;
  while ((im = imgRegex.exec(content)) !== null) {
    const src = im[1];
    if (src && !src.includes("emoji") && !src.includes("icon") && !src.includes("avatar")) {
      images.push(src);
    }
  }

  const ogDesc = html.match(/property="og:description"\s+content="([^"]*)"/i);

  return {
    name: recipeName,
    description: ogDesc?.[1] ? stripHtml(ogDesc[1]) : undefined,
    image: images[0],
    additionalImages: images.slice(1),
    recipeIngredient: ingredientLines,
    recipeInstructions: instructions,
  };
}

function extractImageUrl(img: unknown): string | undefined {
  if (typeof img === "string") return img;
  if (Array.isArray(img)) {
    const first = img[0];
    if (typeof first === "string") return first;
    if (typeof first === "object" && first !== null) {
      return (first as Record<string, unknown>).url as string | undefined;
    }
    return undefined;
  }
  if (typeof img === "object" && img !== null) {
    return (img as Record<string, unknown>).url as string | undefined;
  }
  return undefined;
}

function parseIngredients(raw: string[]): { name: string; amount?: string; unit?: string }[] {
  return raw.map((str: string) => {
    const match = str.match(
      /^([\d\s/½⅓⅔¼¾⅛⅜⅝⅞]+)\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|liters?|cloves?|cans?|packages?|bunche?s?|pieces?|slices?|sticks?|heads?|stalks?|sprigs?|pinche?s?|dashes?)?\s*(.+)/i
    );
    if (match) {
      return { amount: match[1]?.trim(), unit: match[2]?.trim(), name: match[3]?.trim() ?? str };
    }
    return { name: str.trim() };
  });
}

function parseSteps(raw: unknown[]): { text: string }[] {
  return raw.map((step: unknown) => {
    if (typeof step === "string") return { text: stripHtml(step) };
    if (typeof step === "object" && step !== null) {
      const s = step as Record<string, unknown>;
      return { text: stripHtml((s.text as string) ?? (s.name as string) ?? String(step)) };
    }
    return { text: String(step) };
  });
}

function parseDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return undefined;
  const hours = parseInt(match[1] ?? "0");
  const minutes = parseInt(match[2] ?? "0");
  return hours * 60 + minutes || undefined;
}

// ── Local scrape entry point ────────────────────────────────

async function scrapeLocally(url: string): Promise<{
  title: string;
  description: string;
  ingredients: { name: string; amount?: string; unit?: string }[];
  steps: { text: string }[];
  imageUrls: string[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
} | null> {
  console.log(`   Fetching locally...`);
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    console.log(`   HTTP ${res.status}`);
    return null;
  }
  const html = await res.text();
  console.log(`   Got ${(html.length / 1024).toFixed(0)}KB HTML`);

  if (html.length < 500) {
    console.log(`   Response too small (${html.length} bytes)`);
    return null;
  }

  let data = extractJsonLd(html);
  if (!data) data = extractMicrodata(html);
  if (!data) data = extractBlogRecipe(html);
  if (!data) {
    console.log("   No recipe data found in HTML");
    return null;
  }

  // Collect all images
  const imageUrls: string[] = [];
  const seen = new Set<string>();
  const addImg = (u: string | undefined) => {
    if (!u || seen.has(u)) return;
    if (u.includes("emoji") || u.includes("icon") || u.includes("avatar")) return;
    seen.add(u);
    imageUrls.push(u);
  };

  addImg(extractImageUrl(data.image));
  if (Array.isArray(data.image)) {
    for (const img of data.image) {
      if (typeof img === "string") addImg(img);
      else if (typeof img === "object" && img !== null) addImg((img as Record<string, unknown>).url as string);
    }
  }
  if (data.additionalImages) for (const u of data.additionalImages) addImg(u);
  const ogImage = html.match(/property="og:image"\s+content="([^"]*)"/i);
  if (ogImage?.[1]) addImg(ogImage[1]);

  return {
    title: data.name ?? "",
    description: data.description ?? "",
    ingredients: parseIngredients(data.recipeIngredient ?? []),
    steps: parseSteps(data.recipeInstructions ?? []),
    imageUrls,
    prepTime: parseDuration(data.prepTime) ?? parseDuration(data.totalTime),
    cookTime: parseDuration(data.cookTime),
    servings: parseInt(
      (Array.isArray(data.recipeYield) ? data.recipeYield[0] : data.recipeYield) ?? "0"
    ) || undefined,
  };
}

async function main() {
  console.log(`Local scrape → ${API_BASE}`);
  if (DRY_RUN) console.log("(DRY RUN)\n");
  else console.log();

  const token = await authenticate();
  console.log("Authenticated.\n");

  const index = await fetchIndex(token);

  // Find stubs with URLs
  const stubs: Recipe[] = [];
  for (const entry of index) {
    const recipe = await fetchRecipe(token, entry.id);
    const hasUrl = !!recipe.source?.url;
    const missingData =
      (recipe.ingredients?.length ?? 0) === 0 ||
      (recipe.steps?.length ?? 0) === 0;
    if (hasUrl && missingData) stubs.push(recipe);
  }

  console.log(`Found ${stubs.length} stubs with URLs.\n`);

  let success = 0;
  let failed = 0;

  for (const recipe of stubs) {
    const url = recipe.source!.url!;
    console.log(`── ${recipe.title} ──`);
    console.log(`   URL: ${url}`);

    const scraped = await scrapeLocally(url);
    if (!scraped) {
      console.log("   FAILED\n");
      failed++;
      continue;
    }

    console.log(`   Found: ${scraped.ingredients.length} ingredients, ${scraped.steps.length} steps, ${scraped.imageUrls.length} images`);

    if (DRY_RUN) {
      console.log("   [DRY RUN] Would update\n");
      continue;
    }

    // Upload images
    const photos: { url: string; isPrimary: boolean }[] = [];
    let thumbnailUrl: string | undefined;
    for (let i = 0; i < Math.min(scraped.imageUrls.length, 10); i++) {
      const uploaded = await uploadImage(token, scraped.imageUrls[i]!);
      if (uploaded) {
        const isPrimary = photos.length === 0;
        photos.push({ url: uploaded, isPrimary });
        if (isPrimary) thumbnailUrl = uploaded;
        console.log(`   Uploaded image ${i + 1}`);
      }
    }

    const updates: Partial<Recipe> = {};
    if ((recipe.ingredients?.length ?? 0) === 0 && scraped.ingredients.length > 0) {
      updates.ingredients = scraped.ingredients;
    }
    if ((recipe.steps?.length ?? 0) === 0 && scraped.steps.length > 0) {
      updates.steps = scraped.steps;
    }
    if (!recipe.thumbnailUrl && thumbnailUrl) {
      updates.thumbnailUrl = thumbnailUrl;
    }
    if (photos.length > 0) {
      updates.photos = photos;
    }
    if (!recipe.description && scraped.description) {
      updates.description = scraped.description;
    }
    if (!recipe.prepTime && scraped.prepTime) updates.prepTime = scraped.prepTime;
    if (!recipe.cookTime && scraped.cookTime) updates.cookTime = scraped.cookTime;
    if (!recipe.servings && scraped.servings) updates.servings = scraped.servings;

    if (Object.keys(updates).length === 0) {
      console.log("   No new data.\n");
      continue;
    }

    const ok = await updateRecipe(token, recipe.id, updates);
    if (ok) {
      console.log("   Updated successfully.\n");
      success++;
    } else {
      console.log("   FAILED to save.\n");
      failed++;
    }
  }

  console.log("\n═════════════════════════════════════");
  console.log("  LOCAL SCRAPE RESULTS");
  console.log("═════════════════════════════════════");
  console.log(`  Stubs found:  ${stubs.length}`);
  console.log(`  Updated:      ${success}`);
  console.log(`  Failed:       ${failed}`);
  console.log("═════════════════════════════════════");
}

main().catch((err) => {
  console.error("Local scrape failed:", err);
  process.exit(1);
});
