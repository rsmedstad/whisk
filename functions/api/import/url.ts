import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
  WHISK_R2: R2Bucket;
  CF_ACCOUNT_ID?: string;
  CF_BR_TOKEN?: string;
  APIFY_API_TOKEN?: string;
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

    // ── Instagram intercept (via Apify) ─────────────────────
    if (isInstagramUrl(url)) {
      const result = await handleInstagramImport(url, downloadImage ?? false, env);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Known-blocked domains → skip straight to Browser Rendering ──
    const BLOCKED_DOMAINS = [
      "foodnetwork.com",   // Akamai WAF
      "food52.com",        // Vercel Security Checkpoint
      "thekitchn.com",     // PerimeterX
    ];
    const urlHost = new URL(url).hostname.replace(/^www\./, "");
    const isKnownBlocked = BLOCKED_DOMAINS.some(
      (d) => urlHost === d || urlHost.endsWith(`.${d}`)
    );

    // Try regular fetch first (unless known-blocked)
    let html: string | null = null;
    let regularFetchFailed = false;

    if (!isKnownBlocked) {
      const pageAbort = AbortSignal.timeout(15000);
      const res = await fetch(url, {
        signal: pageAbort,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
      });

      regularFetchFailed = !res.ok;
      // Read body even on non-200 — many recipe sites (Dotdash Meredith)
      // return full HTML with JSON-LD even on 403 responses
      const body = await res.text();
      if (body.length > 200) {
        html = body;
      }
    } else {
      regularFetchFailed = true; // Skip to Browser Rendering
    }

    // If regular fetch failed, returned a small/challenge page, or is known-blocked → try Browser Rendering
    const isChallengePage = html !== null && (
      html.includes("<title>Just a moment...</title>") ||
      html.includes("_cf_chl_opt") ||
      html.includes("challenge-platform")
    );
    const needsBrowser = regularFetchFailed || (html !== null && html.length < 500) || isChallengePage;
    if (needsBrowser && env.CF_ACCOUNT_ID && env.CF_BR_TOKEN) {
      try {
        const brRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/content`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env.CF_BR_TOKEN}`,
            },
            body: JSON.stringify({
              url,
              gotoOptions: { waitUntil: "networkidle2", timeout: 25000 },
              // Allow all resource types — some WAFs check that images/scripts load
              rejectResourceTypes: ["font", "media"],
              setExtraHTTPHeaders: {
                "Accept-Language": "en-US,en;q=0.9",
              },
            }),
          }
        );
        if (brRes.ok) {
          const brBody = await brRes.text();
          // Check if BR returned actual content (not a challenge page)
          const brHtml = brBody.startsWith("{") ? (JSON.parse(brBody) as { result?: string }).result ?? "" : brBody;
          if (brHtml.length > 500 && !brHtml.includes("<title>Just a moment...</title>")) {
            html = brHtml;
          }
        }
      } catch {
        // Browser Rendering failed, continue with whatever we have
      }
    }

    if (!html || html.length < 500) {
      // Try Apify recipe scraper as last resort before giving up entirely
      if (env.APIFY_API_TOKEN) {
        const apifyData = await tryApifyRecipeScraper(url, env.APIFY_API_TOKEN);
        if (apifyData) {
          const recipe = {
            title: apifyData.name ?? "",
            description: apifyData.description ?? "",
            ingredients: parseIngredients(apifyData.recipeIngredient ?? []),
            steps: parseSteps(apifyData.recipeInstructions ?? []),
            prepTime: parseDuration(apifyData.prepTime) ?? parseDuration(apifyData.totalTime),
            cookTime: parseDuration(apifyData.cookTime),
            servings: parseServings(apifyData.recipeYield),
            thumbnailUrl: extractImageUrl(apifyData.image),
            photos: [] as { url: string; isPrimary: boolean }[],
            lastCrawledAt: new Date().toISOString(),
          };
          return new Response(JSON.stringify(recipe), {
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      return new Response(
        JSON.stringify({
          error: regularFetchFailed
            ? "This site blocks automated access. Try copying the recipe text from the page and pasting it manually."
            : "Received a very small response — site may be blocking automated requests",
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

    // Strategy 4: Apify universal recipe scraper (last resort)
    if (!recipeData && env.APIFY_API_TOKEN) {
      recipeData = await tryApifyRecipeScraper(url, env.APIFY_API_TOKEN);
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
          const imgAbort = AbortSignal.timeout(10000);
          const imgRes = await fetch(imgUrl, {
            signal: imgAbort,
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

    // Extract video URL from the page
    const videoUrl = extractVideoUrl(html);

    const recipe = {
      title: recipeData.name ?? "",
      description: recipeData.description ?? "",
      ingredients: parseIngredients(recipeData.recipeIngredient ?? []),
      steps: parseSteps(recipeData.recipeInstructions ?? []),
      prepTime:
        parseDuration(recipeData.prepTime) ??
        parseDuration(recipeData.totalTime),
      cookTime: parseDuration(recipeData.cookTime),
      servings: parseServings(recipeData.recipeYield),
      thumbnailUrl,
      photos,
      videoUrl,
      lastCrawledAt: new Date().toISOString(),
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

function decodeHtmlEntities(str: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    nbsp: " ", ndash: "\u2013", mdash: "\u2014",
    lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
    bull: "\u2022", hellip: "\u2026", deg: "\u00B0",
    frac12: "\u00BD", frac13: "\u2153", frac14: "\u00BC", frac34: "\u00BE",
  };
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function stripHtml(str: string): string {
  return decodeHtmlEntities(
    str.replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIngredientText(str: string): string {
  return str
    // Fix "teaspoon s" / "tablespoon s" / "cup s" artifacts from HTML stripping
    .replace(/\b(teaspoon|tablespoon|cup|ounce|pound|clove|pinch|dash|slice|piece|stick|bunch|can|package|head|stalk|sprig)\s+s\b/gi, "$1s")
    // Collapse multiple spaces
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseIngredients(
  raw: string[]
): { name: string; amount?: string; unit?: string }[] {
  return raw.map((str: string) => {
    const cleaned = cleanIngredientText(str);
    const match = cleaned.match(
      /^([\d\s/½⅓⅔¼¾⅛⅜⅝⅞]+)\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|liters?|cloves?|cans?|packages?|bunche?s?|pieces?|slices?|sticks?|heads?|stalks?|sprigs?|pinche?s?|dashes?)?\s*(.+)/i
    );
    if (match) {
      return {
        amount: match[1]?.trim(),
        unit: match[2]?.trim(),
        name: match[3]?.trim() ?? cleaned,
      };
    }
    return { name: cleaned };
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
  // Split on bold section headings like "Make the batter:", "Prepare the sauce:", "Finish the cake:"
  const sectionSplit = text.split(
    /(?=(?:Prepare|Make|Bake|Cook|Finish|Assemble|Serve|Meanwhile|For the|To make|Start|Mix|Whisk|Cool|Chill|Frost|Glaze|Do ahead)\s[^.]{3,40}:)/i
  );
  if (sectionSplit.length > 1) {
    return sectionSplit.map((s) => s.trim()).filter((s) => s.length > 10);
  }
  // Split on "Step N" or "N." patterns
  const numberedSplit = text.split(/(?=Step\s+\d+[:.]\s)/i);
  if (numberedSplit.length > 1) {
    return numberedSplit.map((s) => s.trim()).filter((s) => s.length > 10);
  }
  return [text.trim()];
}

// ── Video URL extraction ───────────────────────────────────

function extractVideoUrl(html: string): string | undefined {
  // YouTube iframe embed
  const ytIframe = html.match(
    /src="(https?:\/\/(?:www\.)?youtube\.com\/embed\/([\w-]+)[^"]*)"/
  );
  if (ytIframe?.[2]) return `https://www.youtube.com/watch?v=${ytIframe[2]}`;

  // YouTube watch link
  const ytLink = html.match(
    /href="(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]+)[^"]*)"/
  );
  if (ytLink?.[1]) return ytLink[1];

  // youtu.be short link
  const ytShort = html.match(
    /href="(https?:\/\/youtu\.be\/([\w-]+)[^"]*)"/
  );
  if (ytShort?.[1]) return ytShort[1];

  return undefined;
}

function parseServings(yield_: string | string[] | undefined): number | undefined {
  if (!yield_) return undefined;
  // Array: ["4", "4 hamburgers"] — pick the first numeric-only entry, or first entry
  const values = Array.isArray(yield_) ? yield_ : [yield_];
  for (const v of values) {
    const n = parseInt(v);
    if (n > 0) return n;
  }
  return undefined;
}

function parseDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined;

  // ISO 8601 duration: PT30M, PT1H30M, PT45M, P0DT0H30M
  const isoMatch = iso.match(/PT?(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (isoMatch && (isoMatch[1] || isoMatch[2] || isoMatch[3])) {
    const days = parseInt(isoMatch[1] ?? "0");
    const hours = parseInt(isoMatch[2] ?? "0");
    const minutes = parseInt(isoMatch[3] ?? "0");
    return days * 1440 + hours * 60 + minutes || undefined;
  }

  // Free text: "30 minutes", "1 hour 30 minutes", "2 hours plus cooling"
  let total = 0;
  const hourMatch = iso.match(/(\d+)\s*hours?/i);
  const minMatch = iso.match(/(\d+)\s*min(?:ute)?s?/i);
  if (hourMatch?.[1]) total += parseInt(hourMatch[1]) * 60;
  if (minMatch?.[1]) total += parseInt(minMatch[1]);
  return total || undefined;
}

// ── Instagram via Apify ────────────────────────────────────

function isInstagramUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "www.instagram.com" ||
      u.hostname === "instagram.com" ||
      u.hostname === "instagr.am"
    );
  } catch {
    return false;
  }
}

interface ApifyPostResult {
  caption?: string;
  ownerUsername?: string;
  type?: string; // "Image", "Video", "Sidecar" (carousel)
  displayUrl?: string;
  images?: string[];
  childPosts?: { displayUrl?: string; type?: string }[];
  videoUrl?: string;
  likesCount?: number;
  commentsCount?: number;
  timestamp?: string;
  error?: string;
}

async function handleInstagramImport(
  url: string,
  downloadImage: boolean,
  env: Env
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.APIFY_API_TOKEN) {
    return {
      status: 422,
      body: {
        error: "Instagram import requires an Apify API token. Add APIFY_API_TOKEN in your Cloudflare environment variables.",
      },
    };
  }

  // Call Apify Instagram Scraper synchronously (run + get results in one call)
  // Uses searchType "hashtag" which supports directUrls for single post lookups
  let posts: ApifyPostResult[];
  try {
    const apifyRes = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${env.APIFY_API_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: [url],
          resultsType: "posts",
          resultsLimit: 1,
          searchType: "hashtag",
        }),
        signal: AbortSignal.timeout(60000), // Apify runs can take a moment
      }
    );

    if (!apifyRes.ok) {
      const errText = await apifyRes.text().catch(() => "");
      return {
        status: 422,
        body: {
          error: `Instagram scraper failed (${apifyRes.status}). The post may be private or unavailable.${errText ? ` Details: ${errText.slice(0, 200)}` : ""}`,
        },
      };
    }

    posts = (await apifyRes.json()) as ApifyPostResult[];
  } catch (err) {
    return {
      status: 422,
      body: {
        error: `Instagram scraper timed out or failed. ${err instanceof Error ? err.message : ""}`.trim(),
      },
    };
  }

  const post = posts[0];
  if (!post || post.error) {
    return {
      status: 422,
      body: { error: post?.error === "restricted_page"
        ? "Instagram post is restricted or private. Try copying the recipe text and pasting it manually."
        : "Could not retrieve post data. It may be private or deleted." },
    };
  }

  const caption = post.caption ?? "";
  const author = post.ownerUsername ?? "";

  // ── Try link-in-bio services to find actual recipe URL ──────
  if (author && caption) {
    const recipeUrl = await findRecipeUrlFromLinkInBio(author, caption);
    if (recipeUrl) {
      // Fetch the recipe URL and parse it using the same extraction logic
      try {
        const pageRes = await fetch(recipeUrl, {
          signal: AbortSignal.timeout(15000),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });
        if (pageRes.ok) {
          const pageHtml = await pageRes.text();
          const recipeData = extractJsonLd(pageHtml) ?? extractMicrodata(pageHtml);
          if (recipeData) {
            const allImageUrls = extractAllImageUrls(recipeData, pageHtml);
            const recipe = {
              title: recipeData.name ?? "",
              description: recipeData.description ?? "",
              ingredients: parseIngredients(recipeData.recipeIngredient ?? []),
              steps: parseSteps(recipeData.recipeInstructions ?? []),
              prepTime: parseDuration(recipeData.prepTime) ?? parseDuration(recipeData.totalTime),
              cookTime: parseDuration(recipeData.cookTime),
              servings: parseServings(recipeData.recipeYield),
              thumbnailUrl: allImageUrls[0],
              photos: allImageUrls.slice(0, 10).map((u, i) => ({ url: u, isPrimary: i === 0 })),
              videoUrl: extractVideoUrl(pageHtml),
              source: { type: "url", url, resolvedUrl: recipeUrl, domain: "instagram.com", attribution: `@${author}` },
              lastCrawledAt: new Date().toISOString(),
            };
            return { status: 200, body: recipe };
          }
        }
      } catch {
        // Link-in-bio URL fetch failed, fall through to caption parsing
      }
    }
  }

  // Collect images: carousel childPosts, images array, displayUrl fallback
  // For reels/videos, displayUrl is a portrait video frame — object-cover crops it on display
  const imageUrls: string[] = [];
  if (post.childPosts && post.childPosts.length > 0) {
    for (const child of post.childPosts) {
      if (child.displayUrl) imageUrls.push(child.displayUrl);
    }
  }
  if (post.images && post.images.length > 0) {
    for (const img of post.images) {
      if (!imageUrls.includes(img)) imageUrls.push(img);
    }
  }
  if (imageUrls.length === 0 && post.displayUrl) {
    imageUrls.push(post.displayUrl);
  }

  if (!caption && imageUrls.length === 0) {
    return {
      status: 422,
      body: { error: "Instagram post has no caption or image to extract a recipe from." },
    };
  }

  // Download images to R2 if requested
  let thumbnailUrl = imageUrls[0];
  const photos: { url: string; isPrimary: boolean }[] = [];

  if (downloadImage && imageUrls.length > 0) {
    const toDownload = imageUrls.slice(0, 10);
    for (let i = 0; i < toDownload.length; i++) {
      const imgUrl = toDownload[i]!;
      try {
        const imgRes = await fetch(imgUrl, {
          signal: AbortSignal.timeout(10000),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          },
        });
        if (imgRes.ok && imgRes.body) {
          const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
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
          const key = `photos/instagram-${hashHex}.${ext}`;

          await env.WHISK_R2.put(key, imgRes.body, {
            httpMetadata: { contentType },
          });

          const isPrimary = i === 0;
          photos.push({ url: `/${key}`, isPrimary });
          if (isPrimary) thumbnailUrl = `/${key}`;
        }
      } catch {
        // Keep external URL as fallback
        if (i === 0 && imageUrls[0]) {
          photos.push({ url: imageUrls[0], isPrimary: true });
        }
      }
    }
  } else {
    for (let i = 0; i < imageUrls.length && i < 10; i++) {
      photos.push({ url: imageUrls[i]!, isPrimary: i === 0 });
    }
  }

  // Use AI to parse the caption into a structured recipe
  const aiRecipe = await parseInstagramCaption(caption, env);

  if (aiRecipe) {
    return {
      status: 200,
      body: {
        ...aiRecipe,
        thumbnailUrl,
        photos,
        source: { type: "url", url, domain: "instagram.com", attribution: author ? `@${author}` : undefined },
        lastCrawledAt: new Date().toISOString(),
      },
    };
  }

  // Fallback: return caption as a single-step recipe
  return {
    status: 200,
    body: {
      title: caption.slice(0, 80).replace(/\n.*/s, "").trim() || `Recipe from @${author}`,
      description: caption,
      ingredients: [],
      steps: [{ text: caption }],
      thumbnailUrl,
      photos,
      source: { type: "url", url, domain: "instagram.com", attribution: author ? `@${author}` : undefined },
      lastCrawledAt: new Date().toISOString(),
    },
  };
}

async function parseInstagramCaption(
  caption: string,
  env: Env
): Promise<Record<string, unknown> | null> {
  if (!caption || caption.trim().length < 20) return null;

  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);
  if (!fnConfig) return null;

  const systemPrompt = `You are a recipe extraction assistant. The user will provide an Instagram post caption that contains a recipe. Extract a structured recipe from it.

Return ONLY a JSON object with these fields:
- "title": string — the recipe name
- "description": string — a brief description (1-2 sentences)
- "ingredients": array of {"name": string, "amount"?: string, "unit"?: string}
- "steps": array of {"text": string}
- "prepTime": number (minutes, optional)
- "cookTime": number (minutes, optional)
- "servings": number (optional)

Rules:
- If the caption doesn't contain a recognizable recipe (no ingredients or cooking steps), return {"error": "not_a_recipe"}
- Strip hashtags, emojis, and social media fluff from the extracted data
- Keep step text clear and actionable
- Combine related notes into the description

Return ONLY the JSON object, no markdown or explanation.`;

  try {
    const result = await callTextAI(fnConfig, env, [
      { role: "system", content: systemPrompt },
      { role: "user", content: caption.slice(0, 8000) },
    ], {
      maxTokens: 2048,
      temperature: 0.1,
      jsonMode: true,
    });

    const parsed = JSON.parse(result) as Record<string, unknown>;
    if (parsed.error === "not_a_recipe") return null;
    if (!parsed.title) return null;

    return {
      title: parsed.title,
      description: parsed.description ?? "",
      ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      prepTime: typeof parsed.prepTime === "number" ? parsed.prepTime : undefined,
      cookTime: typeof parsed.cookTime === "number" ? parsed.cookTime : undefined,
      servings: typeof parsed.servings === "number" ? parsed.servings : undefined,
    };
  } catch {
    return null;
  }
}

// ── Link-in-Bio → Recipe URL resolution ────────────────────

interface LikeShopItem {
  comment?: string;
  title?: string;
  product_url?: string;
  image_url?: string;
}

// Known food accounts and their link-in-bio services
const LIKESHOP_ACCOUNTS: Record<string, string> = {
  nytcooking: "nytcooking",
  bonappetitmag: "bonappetitmag",
};

async function findRecipeUrlFromLinkInBio(
  username: string,
  caption: string
): Promise<string | null> {
  const lowerUser = username.toLowerCase();

  // Try LikeShop.me (Dash Hudson)
  const likeshopSlug = LIKESHOP_ACCOUNTS[lowerUser];
  if (likeshopSlug) {
    const url = await matchLikeShopRecipe(likeshopSlug, caption);
    if (url) return url;
  }

  // Try Linktr.ee for any account (lightweight check)
  const linktreeUrl = await matchLinktreeRecipe(lowerUser, caption);
  if (linktreeUrl) return linktreeUrl;

  return null;
}

async function matchLikeShopRecipe(
  slug: string,
  caption: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.likeshop.me/api/accounts/${slug}/galleries/likeshop`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as { data?: { items?: LikeShopItem[] } };
    const items = data.data?.items;
    if (!items || items.length === 0) return null;

    // Fuzzy match: compare first ~60 chars of caption against each item's comment
    const captionStart = caption
      .replace(/[^\w\s]/g, "")
      .slice(0, 60)
      .toLowerCase()
      .trim();

    for (const item of items) {
      if (!item.product_url || !item.comment) continue;
      const itemComment = item.comment
        .replace(/[^\w\s]/g, "")
        .slice(0, 60)
        .toLowerCase()
        .trim();
      // Check if the caption start matches the item comment start
      if (
        captionStart.startsWith(itemComment.slice(0, 30)) ||
        itemComment.startsWith(captionStart.slice(0, 30))
      ) {
        return item.product_url;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function matchLinktreeRecipe(
  username: string,
  caption: string
): Promise<string | null> {
  try {
    const res = await fetch(`https://linktr.ee/${username}`, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!res.ok) return null;

    const html = await res.text();
    // Extract __NEXT_DATA__ JSON blob
    const nextDataMatch = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!nextDataMatch?.[1]) return null;

    const nextData = JSON.parse(nextDataMatch[1]) as {
      props?: {
        pageProps?: {
          account?: {
            links?: { url?: string; title?: string }[];
          };
        };
      };
    };

    const links = nextData.props?.pageProps?.account?.links;
    if (!links || links.length === 0) return null;

    // Extract a recipe name hint from the caption (first line, stripped of emoji/hashtags)
    const captionFirstLine = caption
      .split("\n")[0]
      ?.replace(/[#@]\S+/g, "")
      .replace(/[^\w\s]/g, "")
      .trim()
      .toLowerCase() ?? "";

    if (!captionFirstLine) return null;

    // Look for links whose title fuzzy-matches the caption
    for (const link of links) {
      if (!link.url || !link.title) continue;
      const linkTitle = link.title.toLowerCase();
      // Check if link title contains key words from caption
      const captionWords = captionFirstLine.split(/\s+/).filter((w) => w.length > 3);
      const matchCount = captionWords.filter((w) => linkTitle.includes(w)).length;
      if (matchCount >= 2 || (captionWords.length <= 3 && matchCount >= 1)) {
        // Verify it looks like a recipe URL (not a shop link, etc.)
        if (link.url.match(/recipe|cooking|food|kitchen|bon|nyt|epicurious|allrecipes|serious/i) ||
            !link.url.match(/shop|store|merch|subscribe|newsletter/i)) {
          return link.url;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Apify Universal Recipe Scraper (final fallback) ─────────

interface ApifyRecipeResult {
  name?: string;
  description?: string;
  image?: unknown;
  ingredients?: string[];
  instructions?: string[];
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  yield?: string;
  url?: string;
}

async function tryApifyRecipeScraper(
  url: string,
  apiToken: string
): Promise<RecipeData | null> {
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/vulnv~recipe-scraper/run-sync-get-dataset-items?token=${apiToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startUrls: [{ url }],
          maxItems: 1,
        }),
        signal: AbortSignal.timeout(45000),
      }
    );

    if (!res.ok) return null;

    const results = (await res.json()) as ApifyRecipeResult[];
    const recipe = results[0];
    if (!recipe?.name) return null;

    return {
      name: recipe.name,
      description: recipe.description,
      image: recipe.image,
      recipeIngredient: recipe.ingredients,
      recipeInstructions: recipe.instructions,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      totalTime: recipe.totalTime,
      recipeYield: recipe.yield,
    };
  } catch {
    return null;
  }
}
