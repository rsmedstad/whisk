#!/usr/bin/env bun
/**
 * Bulk import recipes from URLs into production KV/R2.
 * Supports JSON-LD, microdata/hrecipe, and blog recipe extraction.
 * Usage: bun scripts/import-urls.ts
 */

const KV_NAMESPACE = "9961b213d1114876af09f83f3884aeb9";
const R2_BUCKET = "whisk-photos";

// Browser Rendering credentials (from .dev.vars)
const devVars = await Bun.file(".dev.vars").text().catch(() => "");
const CF_ACCOUNT_ID = devVars.match(/CF_ACCOUNT_ID=(.+)/)?.[1]?.trim();
const CF_BR_TOKEN = devVars.match(/CF_BR_TOKEN=(.+)/)?.[1]?.trim();

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

interface RecipeImport {
  url: string;
  overrideTitle?: string;
  tags?: string[];
}

const RECIPES_TO_IMPORT: RecipeImport[] = [
  // Round 2: alternative sources for liquor.com (403) + paloma
  { url: "https://www.acouplecooks.com/manhattan-cocktail/", tags: ["drinks"] },
  { url: "https://www.thekitchn.com/paper-plane-cocktail-recipe-23549303", tags: ["drinks"] },
  { url: "https://www.thekitchn.com/aperol-spritz-recipe-23664007", tags: ["drinks"] },
  { url: "https://www.acouplecooks.com/sazerac-cocktail/", tags: ["drinks"] },
  { url: "https://www.thekitchn.com/sidecar-cocktail-recipe-23675943", tags: ["drinks"] },
  { url: "https://www.acouplecooks.com/moscow-mule-recipe/", tags: ["drinks"] },
  { url: "https://www.acouplecooks.com/corpse-reviver/", tags: ["drinks"] },
  { url: "https://www.thekitchn.com/mojito-recipe-23667328", tags: ["drinks"] },
  { url: "https://www.thekitchn.com/gimlet-recipe-23680090", tags: ["drinks"] },
  { url: "https://www.thekitchn.com/mint-julep-recipe-23521957", tags: ["drinks"] },
  { url: "https://www.thekitchn.com/paloma-recipe-23665218", tags: ["drinks"] },
];

// ── Shared helpers ──────────────────────────────────────

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

// ── Strategy 1: JSON-LD ──────────────────────────────────

function findRecipeInLd(data: unknown): Record<string, unknown> | null {
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

// ── Strategy 2: Microdata / hrecipe ──────────────────────

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
      const lines = ingredientBlock
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 2 && l.length < 200);
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
      const lines = instructionBlock
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 10);
      instructions.push(...lines);
    }
  }

  if (instructions.length === 0) {
    const cookingParagraphs = extractCookingParagraphs(block);
    if (cookingParagraphs.length > 0) {
      instructions.push(...cookingParagraphs);
    }
  }

  const imageUrl =
    extractItempropAttr(block, "image", "src") ??
    extractItempropAttr(block, "image", "content") ??
    extractFirstImgSrc(block);

  const prepTime =
    extractItempropAttr(block, "prepTime", "content") ??
    extractItempropAttr(block, "prepTime", "datetime");
  const cookTime =
    extractItempropAttr(block, "cookTime", "content") ??
    extractItempropAttr(block, "cookTime", "datetime");
  const totalTime =
    extractItempropAttr(block, "totalTime", "content") ??
    extractItempropAttr(block, "totalTime", "datetime");

  const recipeYield =
    extractItemprop(block, "recipeYield") ??
    extractItemprop(block, "yield");

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

// ── Strategy 3: Blog recipe ──────────────────────────────

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

  const ogDesc = html.match(
    /property="og:description"\s+content="([^"]*)"/i
  );

  return {
    name: recipeName,
    description: ogDesc?.[1] ? stripHtml(ogDesc[1]) : undefined,
    image: images[0],
    additionalImages: images.slice(1),
    recipeIngredient: ingredientLines,
    recipeInstructions: instructions,
  };
}

// ── Strategy 4: Fallback og:image + title ─────────────────

function extractMinimal(html: string, url: string): RecipeData | null {
  const ogTitle = html.match(/property="og:title"\s+content="([^"]*)"/i)?.[1];
  const ogDesc = html.match(/property="og:description"\s+content="([^"]*)"/i)?.[1];
  const ogImage = html.match(/property="og:image"\s+content="([^"]*)"/i)?.[1];
  const title = ogTitle ?? html.match(/<title[^>]*>([^<]+)/i)?.[1];

  if (!title) return null;

  return {
    name: stripHtml(title),
    description: ogDesc ? stripHtml(ogDesc) : undefined,
    image: ogImage,
    recipeIngredient: [],
    recipeInstructions: [],
  };
}

// ── Image + recipe helpers ──────────────────────────────────

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

function extractAllImageUrls(data: RecipeData, html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const addUrl = (url: string | undefined) => {
    if (!url || seen.has(url)) return;
    if (url.includes("emoji") || url.includes("icon") || url.includes("avatar")) return;
    if (url.includes("1x1") || url.includes("pixel")) return;
    seen.add(url);
    urls.push(url);
  };

  addUrl(extractImageUrl(data.image));

  if (Array.isArray(data.image)) {
    for (const img of data.image) {
      if (typeof img === "string") addUrl(img);
      else if (typeof img === "object" && img !== null) {
        addUrl((img as Record<string, unknown>).url as string | undefined);
      }
    }
  }

  if (data.additionalImages) {
    for (const url of data.additionalImages) addUrl(url);
  }

  const ogImage = html.match(/property="og:image"\s+content="([^"]*)"/i);
  if (ogImage?.[1]) addUrl(ogImage[1]);

  return urls;
}

function parseDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return undefined;
  const hours = parseInt(match[1] ?? "0");
  const minutes = parseInt(match[2] ?? "0");
  return hours * 60 + minutes || undefined;
}

function parseIngredients(
  raw: string[]
): { name: string; amount?: string; unit?: string }[] {
  return raw.map((str) => {
    const match = str.match(
      /^([\d\s/½⅓⅔¼¾⅛⅜⅝⅞.]+)\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|liters?|cloves?|cans?|packages?|bunche?s?|pieces?|slices?|sticks?|heads?|stalks?|sprigs?|pinche?s?|dashes?)?\s*(.+)/i
    );
    if (match) {
      return {
        amount: match[1]?.trim(),
        unit: match[2]?.trim(),
        name: match[3]?.trim() ?? str,
      };
    }
    return { name: str.trim() };
  });
}

function parseSteps(raw: unknown[]): { text: string }[] {
  const steps: { text: string }[] = [];
  for (const step of raw) {
    let text: string;
    if (typeof step === "string") {
      text = stripHtml(step);
    } else if (typeof step === "object" && step !== null) {
      const s = step as Record<string, unknown>;
      text = stripHtml(
        (s.text as string) ?? (s.name as string) ?? String(step)
      );
    } else {
      text = String(step);
    }
    // Split long single-step texts into logical sub-steps
    if (text.length > 300) {
      const split = splitLongStep(text);
      steps.push(...split.map((t) => ({ text: t })));
    } else if (text.trim()) {
      steps.push({ text: text.trim() });
    }
  }
  return steps;
}

function splitLongStep(text: string): string[] {
  // Split on bold section headings like "Make the batter:", "Prepare the sauce:"
  const sectionSplit = text.split(
    /(?=(?:Prepare|Make|Bake|Cook|Finish|Assemble|Serve|Meanwhile|For the|To make|Start|Mix|Whisk|Cool|Chill|Frost|Glaze|Do ahead)\s[^.]{3,40}:)/i
  );
  if (sectionSplit.length > 1) {
    return sectionSplit.map((s) => s.trim()).filter((s) => s.length > 10);
  }
  const numberedSplit = text.split(/(?=Step\s+\d+[:.]\s)/i);
  if (numberedSplit.length > 1) {
    return numberedSplit.map((s) => s.trim()).filter((s) => s.length > 10);
  }
  return [text.trim()];
}

function extractVideoUrl(html: string): string | undefined {
  const ytIframe = html.match(
    /src="(https?:\/\/(?:www\.)?youtube\.com\/embed\/([\w-]+)[^"]*)"/
  );
  if (ytIframe?.[2]) return `https://www.youtube.com/watch?v=${ytIframe[2]}`;
  const ytLink = html.match(
    /href="(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]+)[^"]*)"/
  );
  if (ytLink?.[1]) return ytLink[1];
  const ytShort = html.match(
    /href="(https?:\/\/youtu\.be\/([\w-]+)[^"]*)"/
  );
  if (ytShort?.[1]) return ytShort[1];
  return undefined;
}

// ── Main import logic ──────────────────────────────────────────

async function scrapeRecipe(url: string, html: string): Promise<RecipeData> {
  // Try all strategies in order
  let data = extractJsonLd(html);
  if (data) {
    console.log("  Strategy: JSON-LD");
    return data;
  }

  data = extractMicrodata(html);
  if (data) {
    console.log("  Strategy: Microdata/hrecipe");
    return data;
  }

  data = extractBlogRecipe(html);
  if (data) {
    console.log("  Strategy: Blog recipe");
    return data;
  }

  data = extractMinimal(html, url);
  if (data) {
    console.log("  Strategy: Minimal (og:image + title only)");
    return data;
  }

  throw new Error("No recipe data found with any strategy");
}

async function downloadImage(imageUrl: string): Promise<string | null> {
  try {
    console.log(`  Downloading image: ${imageUrl.slice(0, 80)}...`);
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      },
    });
    if (!res.ok) {
      console.log(`  Image fetch failed: HTTP ${res.status}`);
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";

    const buf = await res.arrayBuffer();
    const hashHex = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(imageUrl))
      )
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);

    const key = `photos/import-${hashHex}.${ext}`;
    const tmpFile = `${key.replace(/\//g, "_")}`;

    // Write to temp file
    await Bun.write(tmpFile, new Uint8Array(buf));

    // Upload to R2 (--remote to use production R2)
    const proc = Bun.spawnSync([
      "npx",
      "wrangler",
      "r2",
      "object",
      "put",
      `${R2_BUCKET}/${key}`,
      "--file",
      tmpFile,
      "--content-type",
      contentType,
      "--remote",
    ]);

    // Clean up temp file
    try {
      const exists = await Bun.file(tmpFile).exists();
      if (exists) Bun.spawnSync(["rm", tmpFile]);
    } catch {}

    if (proc.exitCode !== 0) {
      console.log(`  R2 upload failed: ${proc.stderr.toString()}`);
      return null;
    }

    console.log(`  Uploaded to R2: /${key}`);
    return `/${key}`;
  } catch (e) {
    console.log(`  Image download failed: ${e}`);
    return null;
  }
}

// Write JSON to KV using temp file to avoid Windows command-line issues with special chars
async function kvPut(key: string, data: unknown): Promise<boolean> {
  const tmpFile = `_kv_tmp_${Date.now()}.json`;
  await Bun.write(tmpFile, JSON.stringify(data));
  const proc = Bun.spawnSync([
    "npx", "wrangler", "kv", "key", "put",
    "--namespace-id", KV_NAMESPACE,
    key,
    "--path", tmpFile,
    "--remote",
  ]);
  try { await Bun.file(tmpFile).exists() && Bun.spawnSync(["rm", tmpFile]); } catch {}
  if (proc.exitCode !== 0) {
    console.log(`  KV put failed for ${key}: ${proc.stderr.toString().slice(0, 100)}`);
    return false;
  }
  return true;
}

function generateId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `r_${hex}`;
}

async function main() {
  console.log("=== Whisk Recipe URL Importer ===\n");

  // Get existing recipe index
  const indexProc = Bun.spawnSync([
    "npx", "wrangler", "kv", "key", "get",
    "--namespace-id", KV_NAMESPACE,
    "recipes:index",
    "--remote",
  ]);
  let existingIndex: Array<Record<string, unknown>> = [];
  try {
    existingIndex = JSON.parse(indexProc.stdout.toString());
  } catch {
    existingIndex = [];
  }
  console.log(`Existing recipes in KV: ${existingIndex.length}\n`);

  const newRecipes: Array<Record<string, unknown>> = [];

  for (const { url, overrideTitle, tags: importTags } of RECIPES_TO_IMPORT) {
    console.log(`\nImporting: ${url}`);
    try {
      // Fetch the page
      console.log("  Fetching...");
      let html: string | null = null;
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      if (res.ok) {
        html = await res.text();
        console.log(`  Got ${html.length} bytes`);
      }

      // Fallback to Browser Rendering if direct fetch failed
      if ((!html || html.length < 500) && CF_ACCOUNT_ID && CF_BR_TOKEN) {
        console.log(`  Direct fetch failed (${res.status}), trying Browser Rendering...`);
        const brRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/content`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CF_BR_TOKEN}`,
            },
            body: JSON.stringify({
              url,
              gotoOptions: { waitUntil: "networkidle2", timeout: 25000 },
              rejectResourceTypes: ["font", "media"],
            }),
          }
        );
        if (brRes.ok) {
          const brBody = await brRes.text();
          const brHtml = brBody.startsWith("{") ? (JSON.parse(brBody) as { result?: string }).result ?? "" : brBody;
          if (brHtml.length > 500 && !brHtml.includes("<title>Just a moment...</title>")) {
            html = brHtml;
            console.log(`  Browser Rendering succeeded (${brHtml.length} chars)`);
          } else {
            console.log(`  Browser Rendering returned challenge page or empty`);
          }
        } else {
          console.log(`  Browser Rendering failed: ${brRes.status}`);
        }
      }

      if (!html || html.length < 500) throw new Error(`Failed to fetch (HTTP ${res.status}, no BR fallback)`);
      console.log(`  Got ${html.length} bytes`);

      const data = await scrapeRecipe(url, html);
      const title = overrideTitle ?? data.name ?? "Untitled";
      console.log(`  Title: ${title}`);
      console.log(`  Ingredients: ${(data.recipeIngredient ?? []).length}`);
      console.log(`  Steps: ${(data.recipeInstructions ?? []).length}`);

      // Get image URLs
      const imageUrls = extractAllImageUrls(data, html);
      console.log(`  Images found: ${imageUrls.length}`);

      // Extract video URL
      const videoUrl = extractVideoUrl(html);
      if (videoUrl) console.log(`  Video: ${videoUrl}`);

      // Download up to 5 images
      let thumbnailUrl: string | undefined;
      const photos: { url: string; isPrimary: boolean }[] = [];
      const toDownload = imageUrls.slice(0, 5);
      for (let i = 0; i < toDownload.length; i++) {
        const imgUrl = toDownload[i]!;
        const r2Path = await downloadImage(imgUrl);
        if (r2Path) {
          const isPrimary = photos.length === 0;
          photos.push({ url: r2Path, isPrimary });
          if (isPrimary) thumbnailUrl = r2Path;
        }
      }
      // If no images could be downloaded, use external URLs as fallback
      if (photos.length === 0 && imageUrls.length > 0) {
        thumbnailUrl = imageUrls[0];
        photos.push({ url: imageUrls[0]!, isPrimary: true });
      }

      const id = generateId();
      const now = new Date().toISOString();

      const fullRecipe = {
        id,
        title,
        description: data.description ? stripHtml(data.description) : "",
        ingredients: parseIngredients(data.recipeIngredient ?? []),
        steps: parseSteps(data.recipeInstructions ?? []),
        tags: importTags ?? [],
        cuisine: "",
        prepTime: parseDuration(data.prepTime) ?? parseDuration(data.totalTime),
        cookTime: parseDuration(data.cookTime),
        servings: data.recipeYield
          ? String(parseInt(
              (Array.isArray(data.recipeYield) ? data.recipeYield[0] : data.recipeYield) ?? "0"
            ) || "")
          : undefined,
        source: { type: "url", url, domain: new URL(url).hostname },
        videoUrl,
        thumbnailUrl,
        photos,
        favorite: false,
        notes: "",
        createdAt: now,
        updatedAt: now,
      };

      // Store full recipe in KV
      const ok = await kvPut(`recipe:${id}`, fullRecipe);
      if (!ok) continue;
      console.log(`  Stored recipe:${id} in KV`);

      newRecipes.push({
        id,
        title,
        tags: importTags ?? [],
        favorite: false,
        updatedAt: now,
        thumbnailUrl,
        prepTime: fullRecipe.prepTime,
        cookTime: fullRecipe.cookTime,
        servings: fullRecipe.servings,
        description: fullRecipe.description,
      });
    } catch (e) {
      console.log(`  FAILED: ${e}`);
    }
  }

  // Update the recipe index
  if (newRecipes.length > 0) {
    const updatedIndex = [...newRecipes, ...existingIndex];
    const ok = await kvPut("recipes:index", updatedIndex);
    if (ok) {
      console.log(`\nUpdated recipe index with ${newRecipes.length} new recipes`);
    } else {
      console.log(`\nIndex update failed`);
    }
  }

  console.log("\nDone!");
}

// ── Recrawl mode: update existing recipes ─────────────────────
// Usage: bun scripts/import-urls.ts --recrawl

async function recrawl() {
  console.log("=== Whisk Recipe Recrawler ===\n");

  // Get existing recipe index
  const indexProc = Bun.spawnSync([
    "npx", "wrangler", "kv", "key", "get",
    "--namespace-id", KV_NAMESPACE,
    "recipes:index",
    "--remote",
  ]);
  let index: Array<Record<string, unknown>> = [];
  try {
    index = JSON.parse(indexProc.stdout.toString());
  } catch {
    console.log("Failed to read recipe index");
    return;
  }
  console.log(`Found ${index.length} recipes in index\n`);

  let updatedCount = 0;
  const updatedIndex = [...index];

  for (const entry of index) {
    const id = entry.id as string;
    // Read full recipe
    const getProc = Bun.spawnSync([
      "npx", "wrangler", "kv", "key", "get",
      "--namespace-id", KV_NAMESPACE,
      `recipe:${id}`,
      "--remote",
    ]);
    let recipe: Record<string, unknown>;
    try {
      recipe = JSON.parse(getProc.stdout.toString());
    } catch {
      console.log(`  Skipping ${id}: failed to parse`);
      continue;
    }

    const title = recipe.title as string;
    const sourceUrl = (recipe.source as Record<string, unknown> | undefined)?.url as string | undefined
      ?? recipe.sourceUrl as string | undefined;
    const steps = recipe.steps as { text: string }[] | undefined;
    const photos = recipe.photos as { url: string; isPrimary: boolean }[] | undefined;
    const videoUrl = recipe.videoUrl as string | undefined;

    const issues: string[] = [];
    if (!steps || steps.length === 0) issues.push("no steps");
    else if (steps.length === 1 && steps[0]!.text.length > 300) issues.push("1 long step");
    if (!photos || photos.length === 0) issues.push("no photos");
    if (!videoUrl) issues.push("no video");

    if (issues.length === 0) {
      console.log(`  ${title}: OK (${steps?.length} steps, ${photos?.length} photos${videoUrl ? ", has video" : ""})`);
      continue;
    }

    console.log(`\n  ${title} [${id}]: ${issues.join(", ")}`);

    if (!sourceUrl) {
      // No source URL — try to fix steps only
      if (steps && steps.length === 1 && steps[0]!.text.length > 300) {
        const newSteps = parseSteps(steps.map((s) => s.text));
        if (newSteps.length > 1) {
          recipe.steps = newSteps;
          recipe.updatedAt = new Date().toISOString();
          console.log(`    Split into ${newSteps.length} steps (no recrawl — no source URL)`);

          const ok = await kvPut(`recipe:${id}`, recipe);
          if (ok) updatedCount++;
        }
      }
      continue;
    }

    // Recrawl from source URL
    console.log(`    Recrawling: ${sourceUrl}`);
    try {
      let html: string | null = null;
      const res = await fetch(sourceUrl, { headers: BROWSER_HEADERS });
      if (res.ok) {
        html = await res.text();
      }

      // Fallback to Browser Rendering if regular fetch failed
      if ((!html || html.length < 500) && CF_ACCOUNT_ID && CF_BR_TOKEN) {
        console.log(`    Regular fetch failed (${res.status}), trying Browser Rendering...`);
        try {
          const brRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/content`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${CF_BR_TOKEN}`,
              },
              body: JSON.stringify({
                url: sourceUrl,
                gotoOptions: { waitUntil: "networkidle2", timeout: 25000 },
                rejectResourceTypes: ["font", "media"],
              }),
            }
          );
          if (brRes.ok) {
            const brBody = await brRes.text();
            const brHtml = brBody.startsWith("{") ? (JSON.parse(brBody) as { result?: string }).result ?? "" : brBody;
            if (brHtml.length > 500 && !brHtml.includes("<title>Just a moment...</title>")) {
              html = brHtml;
              console.log(`    Browser Rendering succeeded (${brHtml.length} chars)`);
            } else {
              console.log(`    Browser Rendering returned challenge page or empty`);
            }
          }
        } catch (e) {
          console.log(`    Browser Rendering failed: ${e}`);
        }
      }

      if (!html || html.length < 500) {
        console.log(`    Failed to fetch: HTTP ${res.status}`);
        continue;
      }
      const data = await scrapeRecipe(sourceUrl, html);

      let changed = false;

      // Fix steps if needed
      if (steps && steps.length === 1 && steps[0]!.text.length > 300) {
        const freshSteps = parseSteps(data.recipeInstructions ?? []);
        if (freshSteps.length > 1) {
          recipe.steps = freshSteps;
          changed = true;
          console.log(`    Steps: 1 → ${freshSteps.length}`);
        } else {
          // Try splitting the existing single step
          const split = parseSteps(steps.map((s) => s.text));
          if (split.length > 1) {
            recipe.steps = split;
            changed = true;
            console.log(`    Steps (split): 1 → ${split.length}`);
          }
        }
      } else if (!steps || steps.length === 0) {
        const freshSteps = parseSteps(data.recipeInstructions ?? []);
        if (freshSteps.length > 0) {
          recipe.steps = freshSteps;
          changed = true;
          console.log(`    Steps: 0 → ${freshSteps.length}`);
        }
      }

      // Fix photos if needed
      if (!photos || photos.length === 0) {
        const imageUrls = extractAllImageUrls(data, html);
        if (imageUrls.length > 0) {
          const newPhotos: { url: string; isPrimary: boolean }[] = [];
          for (let i = 0; i < Math.min(imageUrls.length, 5); i++) {
            const r2Path = await downloadImage(imageUrls[i]!);
            if (r2Path) {
              newPhotos.push({ url: r2Path, isPrimary: newPhotos.length === 0 });
            }
          }
          if (newPhotos.length > 0) {
            recipe.photos = newPhotos;
            recipe.thumbnailUrl = newPhotos[0]!.url;
            changed = true;
            console.log(`    Photos: 0 → ${newPhotos.length}`);
            // Also update the index entry
            const idxEntry = updatedIndex.find((e) => e.id === id);
            if (idxEntry) idxEntry.thumbnailUrl = newPhotos[0]!.url;
          }
        }
      }

      // Fix video if needed
      if (!videoUrl) {
        const newVideo = extractVideoUrl(html);
        if (newVideo) {
          recipe.videoUrl = newVideo;
          changed = true;
          console.log(`    Video: ${newVideo}`);
        }
      }

      if (changed) {
        recipe.updatedAt = new Date().toISOString();
        const ok = await kvPut(`recipe:${id}`, recipe);
        if (ok) {
          updatedCount++;
          console.log(`    Updated in KV`);
        }
      }
    } catch (e) {
      console.log(`    Recrawl failed: ${e}`);
    }
  }

  // Update index if any thumbnails changed
  if (updatedCount > 0) {
    const ok = await kvPut("recipes:index", updatedIndex);
    if (ok) console.log(`\nUpdated recipe index`);
  }

  console.log(`\nRecrawl complete: ${updatedCount} recipes updated`);
}

// ── Entry point ──────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes("--recrawl")) {
  recrawl().catch(console.error);
} else {
  main().catch(console.error);
}
