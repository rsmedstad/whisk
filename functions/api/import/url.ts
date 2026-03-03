interface Env {
  WHISK_KV: KVNamespace;
  WHISK_R2: R2Bucket;
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

// POST /api/import/url - Scrape recipe from URL
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { url, downloadImage } = (await request.json()) as {
      url: string;
      downloadImage?: boolean;
    };

    if (!url) {
      return new Response(JSON.stringify({ error: "URL required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

    const html = await res.text();

    // Detect suspiciously small responses (likely blocked by target site)
    if (html.length < 500) {
      return new Response(
        JSON.stringify({
          error:
            "Received a very small response — site may be blocking automated requests",
          htmlLength: html.length,
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    // Strategy 1: JSON-LD (most reliable when present)
    let recipeData = extractJsonLd(html);

    // Strategy 2: Microdata / Jetpack hrecipe (common on WordPress)
    if (!recipeData) {
      recipeData = extractMicrodata(html);
    }

    // Strategy 3: Plain text blog recipe (e.g. smittenkitchen)
    if (!recipeData) {
      recipeData = extractBlogRecipe(html);
    }

    if (!recipeData) {
      return new Response(
        JSON.stringify({ error: "No structured recipe data found" }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    // Collect all image URLs: primary + additional from the page
    const allImageUrls = extractAllImageUrls(recipeData, html);
    let thumbnailUrl = allImageUrls[0];

    // Download images and store in R2 if requested
    let photos: { url: string; isPrimary: boolean }[] = [];
    if (downloadImage && allImageUrls.length > 0) {
      // Download up to 10 images
      const toDownload = allImageUrls.slice(0, 10);
      for (let i = 0; i < toDownload.length; i++) {
        const imgUrl = toDownload[i]!;
        try {
          const imgRes = await fetch(imgUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
            },
          });
          if (imgRes.ok && imgRes.body) {
            const contentType =
              imgRes.headers.get("content-type") ?? "image/jpeg";
            const ext = contentType.includes("png")
              ? "png"
              : contentType.includes("webp")
                ? "webp"
                : "jpg";
            const hashBuf = await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(imgUrl)
            );
            const hashHex = [...new Uint8Array(hashBuf)]
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
              .slice(0, 12);
            const key = `photos/import-${hashHex}.${ext}`;

            await env.WHISK_R2.put(key, imgRes.body, {
              httpMetadata: { contentType },
            });

            const isPrimary = i === 0;
            photos.push({ url: `/${key}`, isPrimary });
            if (isPrimary) thumbnailUrl = `/${key}`;
          }
        } catch {
          // Skip this image, continue with others
        }
      }
    } else if (!downloadImage && allImageUrls.length > 0) {
      // Keep external URLs
      photos = allImageUrls.slice(0, 10).map((imgUrl, i) => ({
        url: imgUrl,
        isPrimary: i === 0,
      }));
    }

    const recipe = {
      title: recipeData.name ?? "",
      description: recipeData.description ?? "",
      ingredients: parseIngredients(recipeData.recipeIngredient ?? []),
      steps: parseSteps(recipeData.recipeInstructions ?? []),
      prepTime:
        parseDuration(recipeData.prepTime) ??
        parseDuration(recipeData.totalTime),
      cookTime: parseDuration(recipeData.cookTime),
      servings:
        parseInt(
          (Array.isArray(recipeData.recipeYield)
            ? recipeData.recipeYield[0]
            : recipeData.recipeYield) ?? "0"
        ) || undefined,
      thumbnailUrl,
      photos,
    };

    return new Response(JSON.stringify(recipe), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to import recipe";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// ── Strategy 1: JSON-LD ─────────────────────────────────────

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
  if (
    type === "Recipe" ||
    (Array.isArray(type) && type.includes("Recipe"))
  ) {
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

// ── Strategy 2: Microdata / hrecipe ─────────────────────────

function extractMicrodata(html: string): RecipeData | null {
  // Find the Recipe microdata block (itemscope itemtype="schema.org/Recipe")
  // Use multiple end anchors for different WordPress themes
  const recipeBlockMatch = html.match(
    /itemscope[^>]*itemtype="https?:\/\/schema\.org\/Recipe"[\s\S]*?(?=<div class="sharedaddy|<footer|<\/article>|<div id="comments|<section id="comments|<nav\s|<div class="post-navigation)/i
  );

  // Also try Jetpack hrecipe class — extract a generous slice (up to end of article)
  let jetpackMatch: RegExpMatchArray | null = null;
  if (!recipeBlockMatch) {
    // First try: find the jetpack-recipe block with multiple end anchors
    jetpackMatch = html.match(
      /class="[^"]*(?:hrecipe|h-recipe|jetpack-recipe)[^"]*"[^>]*(?:itemscope[^>]*)?>([\s\S]*?)(?=<div class="sharedaddy|<footer|<\/article>|<div id="comments|<section id="comments|<nav\s|<div class="post-navigation)/i
    );
    // Fallback: if no end anchor matches, grab up to 50KB after the recipe class
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

  // Extract ingredients from itemprop or list items within ingredient sections
  const ingredients = extractAllItemprop(block, "recipeIngredient")
    .concat(extractAllItemprop(block, "ingredients"));

  // If no itemprop ingredients, try extracting from the block's text
  // by finding lines that look like ingredient amounts
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

  // Extract instructions
  const instructions: unknown[] = [];
  const stepTexts = extractAllItemprop(block, "recipeInstructions")
    .concat(extractAllItemprop(block, "step"));

  if (stepTexts.length > 0) {
    instructions.push(...stepTexts);
  } else {
    // Try extracting from instruction/direction sections
    const instructionBlock = extractTextBlock(block, "instruction|direction|step");
    if (instructionBlock) {
      const lines = instructionBlock
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 10);
      instructions.push(...lines);
    }
  }

  // Heuristic fallback: if no instructions found, look for consecutive <p> tags
  // with cooking-related text (common in Smitten Kitchen / Jetpack recipes)
  if (instructions.length === 0) {
    const cookingParagraphs = extractCookingParagraphs(block);
    if (cookingParagraphs.length > 0) {
      instructions.push(...cookingParagraphs);
    }
  }

  // Extract image
  const imageUrl =
    extractItempropAttr(block, "image", "src") ??
    extractItempropAttr(block, "image", "content") ??
    extractFirstImgSrc(block);

  // Extract times
  const prepTime =
    extractItempropAttr(block, "prepTime", "content") ??
    extractItempropAttr(block, "prepTime", "datetime");
  const cookTime =
    extractItempropAttr(block, "cookTime", "content") ??
    extractItempropAttr(block, "cookTime", "datetime");
  const totalTime =
    extractItempropAttr(block, "totalTime", "content") ??
    extractItempropAttr(block, "totalTime", "datetime");

  // Extract yield/servings
  const recipeYield =
    extractItemprop(block, "recipeYield") ??
    extractItemprop(block, "yield");

  // Extract description
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

function extractItemprop(html: string, prop: string): string | null {
  // Match itemprop in tag attributes, get inner text or content attr
  const contentMatch = html.match(
    new RegExp(`itemprop="${prop}"[^>]*content="([^"]*)"`, "i")
  );
  if (contentMatch?.[1]) return contentMatch[1];

  const tagMatch = html.match(
    new RegExp(`itemprop="${prop}"[^>]*>([^<]+)`, "i")
  );
  return tagMatch?.[1]?.trim() ?? null;
}

function extractItempropAttr(
  html: string,
  prop: string,
  attr: string
): string | null {
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
  // Find a section that matches the pattern and extract its text content
  const regex = new RegExp(
    `(?:class|id)="[^"]*(?:${sectionPattern})[^"]*"[^>]*>([\\s\\S]*?)(?=<\\/(?:div|section|ul|ol)>\\s*<(?:div|section|h[23]))`,
    "i"
  );
  const match = html.match(regex);
  if (!match?.[1]) return null;
  return stripHtml(match[1]);
}

// ── Strategy 3: Plain text blog recipe ──────────────────────
// For blogs like smittenkitchen that have recipe text in entry-content
// without JSON-LD or microdata, but with a recognizable pattern:
// bold recipe title → description → ingredient-like lines → instruction paragraphs

function extractBlogRecipe(html: string): RecipeData | null {
  // Find the entry-content or post-content block
  const contentMatch = html.match(
    /class="(?:entry-content|post-content|article-content)"[^>]*>([\s\S]*?)(?=<\/div>\s*<(?:footer|div class="entry-footer|div class="post-footer|section class="comments"))/i
  );
  if (!contentMatch?.[1]) return null;
  const content = contentMatch[1];

  // Look for a bold recipe title (common pattern: <b>Recipe Name</b> or <strong>Recipe Name</strong>)
  const titleMatch = content.match(
    /<(?:b|strong)>\s*([^<]{10,100}(?:cake|bread|soup|salad|chicken|beef|salmon|pasta|rice|stew|pie|tart|cookies?|muffins?|sauce|roast|curry|tacos?|chili|stir[- ]?fry|risotto|casserole|dip|dressing|marinade|glaze|pudding|crumble|cobbler|scones?|biscuits?|pancakes?|waffles?|smoothie|bowl|wrap|sandwich|burger|pizza|quiche|frittata|omelet|granola|bars?|brownies?|blondies?))\s*<\/(?:b|strong)>/i
  );
  if (!titleMatch?.[1]) return null;

  const recipeName = stripHtml(titleMatch[1]);
  const recipeStart = content.indexOf(titleMatch[0]);
  const recipeBlock = content.slice(recipeStart);

  // Extract ingredients: lines that start with amounts/quantities
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

  // Extract instructions: paragraphs that contain cooking verbs, after the ingredients
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

  // Need at least some ingredients or instructions to consider this valid
  if (ingredientLines.length < 2 && instructions.length < 2) return null;

  // Extract images from the content area
  const images: string[] = [];
  const imgRegex = /<img[^>]*src="([^"]+)"[^>]*>/gi;
  while ((im = imgRegex.exec(content)) !== null) {
    const src = im[1];
    if (src && !src.includes("emoji") && !src.includes("icon") && !src.includes("avatar")) {
      images.push(src);
    }
  }

  // Get og:description or first paragraph as description
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

// ── Multi-image extraction ──────────────────────────────────

function extractAllImageUrls(data: RecipeData, html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const addUrl = (url: string | undefined) => {
    if (!url || seen.has(url)) return;
    // Skip tiny icons, emojis, tracking pixels
    if (url.includes("emoji") || url.includes("icon") || url.includes("avatar")) return;
    if (url.includes("1x1") || url.includes("pixel")) return;
    seen.add(url);
    urls.push(url);
  };

  // 1. Primary image from structured data
  addUrl(extractImageUrl(data.image));

  // 2. Additional images from JSON-LD (image can be array)
  if (Array.isArray(data.image)) {
    for (const img of data.image) {
      if (typeof img === "string") addUrl(img);
      else if (typeof img === "object" && img !== null) {
        addUrl((img as Record<string, unknown>).url as string | undefined);
      }
    }
  }

  // 3. Additional images from Strategy 3
  if (data.additionalImages) {
    for (const url of data.additionalImages) addUrl(url);
  }

  // 4. og:image
  const ogImage = html.match(/property="og:image"\s+content="([^"]*)"/i);
  if (ogImage?.[1]) addUrl(ogImage[1]);

  // 5. Images from entry-content that look like recipe photos (large content images)
  const contentMatch = html.match(
    /class="(?:entry-content|post-content|article-content|recipe-content)"[^>]*>([\s\S]*?)(?=<\/div>\s*<(?:footer|div class="entry-footer|section class="comments"))/i
  );
  if (contentMatch?.[1]) {
    const imgRegex = /<img[^>]*src="([^"]+)"[^>]*>/gi;
    let m;
    while ((m = imgRegex.exec(contentMatch[1])) !== null) {
      addUrl(m[1]);
    }
  }

  return urls;
}

// ── Cooking paragraph heuristic ─────────────────────────────

const COOKING_KEYWORDS =
  /\b(preheat|bake|cook|stir|mix|combine|whisk|fold|simmer|boil|roast|saut[eé]|chop|dice|slice|drain|reduce|season|serve|cool|chill|refrigerat|marinate|knead|roll|spread|pour|heat|melt|fry|grill|broil|steam|blanch|braise|glaze|brush|toss|layer|arrange|set aside|let\s+(?:stand|rest|cool|sit)|bring\s+to|add\s+the|remove\s+from|place\s+(?:in|on)|transfer|prepare|beat\s+(?:the|until)|cover\s+(?:and|with))\b/i;

function extractCookingParagraphs(html: string): string[] {
  // Extract text from <p> tags (including those with nested <strong>/<b>/<em>)
  const pTagRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const paragraphs: string[] = [];
  let m;

  while ((m = pTagRegex.exec(html)) !== null) {
    const text = stripHtml(m[1] ?? "").trim();
    if (text.length > 20 && COOKING_KEYWORDS.test(text)) {
      paragraphs.push(text);
    }
  }

  // Only return if we found at least 2 cooking paragraphs (avoid false positives)
  return paragraphs.length >= 2 ? paragraphs : [];
}

// ── Shared helpers ──────────────────────────────────────────

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

function parseIngredients(
  raw: string[]
): { name: string; amount?: string; unit?: string }[] {
  return raw.map((str: string) => {
    const match = str.match(
      /^([\d\s/½⅓⅔¼¾⅛⅜⅝⅞]+)\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|liters?|cloves?|cans?|packages?|bunche?s?|pieces?|slices?|sticks?|heads?|stalks?|sprigs?|pinche?s?|dashes?)?\s*(.+)/i
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
  return raw.map((step: unknown) => {
    if (typeof step === "string") return { text: stripHtml(step) };
    if (typeof step === "object" && step !== null) {
      const s = step as Record<string, unknown>;
      return {
        text: stripHtml(
          (s.text as string) ?? (s.name as string) ?? String(step)
        ),
      };
    }
    return { text: String(step) };
  });
}

function parseDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  // Parse ISO 8601 duration: PT30M, PT1H30M, PT45M
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return undefined;
  const hours = parseInt(match[1] ?? "0");
  const minutes = parseInt(match[2] ?? "0");
  return hours * 60 + minutes || undefined;
}
