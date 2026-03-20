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
  recipeCategory?: string | string[];
  recipeCuisine?: string | string[];
  keywords?: string | string[];
}

/** Normalize a user-provided URL: trim, add https://, validate protocol. Returns null if invalid. */
function normalizeUrl(raw: string): string | null {
  let u = raw.trim();
  if (!u) return null;
  // Reject dangerous protocols
  if (/^(javascript|data|file|ftp|blob|vbscript):/i.test(u)) return null;
  // Add https:// if no protocol
  if (!/^https?:\/\//i.test(u)) {
    u = `https://${u}`;
  }
  // Validate as a proper URL
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    // Reject localhost/private IPs to prevent SSRF
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" ||
        host.startsWith("192.168.") || host.startsWith("10.") ||
        host.startsWith("172.") || host === "[::1]") return null;
    return u;
  } catch {
    return null;
  }
}

/** Hash a URL to a short hex string for use as a KV cache key */
async function hashUrl(url: string): Promise<string> {
  const normalized = url.replace(/\/$/, "").replace(/^http:/, "https:");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// POST /api/import/url - Scrape recipe from URL
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { url: rawUrl, downloadImage } = (await request.json()) as {
      url: string;
      downloadImage?: boolean;
    };

    if (!rawUrl) {
      return new Response(JSON.stringify({ error: "URL required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Normalize & validate URL ──
    const url = normalizeUrl(rawUrl);
    if (!url) {
      return new Response(JSON.stringify({ error: "Invalid URL. Please provide an http or https URL." }), {
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

    // ── NYT Cooking intercept (REST API — richer data than HTML scraping) ──
    const nytRecipeId = extractNytRecipeId(url);
    if (nytRecipeId) {
      const nytResult = await tryNytCookingApi(nytRecipeId, downloadImage ?? false, env);
      if (nytResult) {
        // Cache indefinitely — curated discover content has no reason to expire
        const cacheKey = `discover_cache:${await hashUrl(url)}`;
        env.WHISK_KV.put(cacheKey, JSON.stringify(nytResult)).catch(() => {});
        return new Response(JSON.stringify(nytResult), {
          headers: { "Content-Type": "application/json" },
        });
      }
      // If NYT API failed, fall through to normal HTML-based extraction
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
          const apifyIngredients = parseIngredients(apifyData.recipeIngredient ?? []);
          const recipe = {
            title: apifyData.name ?? "",
            description: apifyData.description ?? "",
            ingredients: apifyIngredients,
            steps: parseSteps(apifyData.recipeInstructions ?? []),
            prepTime: parseDuration(apifyData.prepTime) ?? parseDuration(apifyData.totalTime),
            cookTime: parseDuration(apifyData.cookTime),
            servings: parseServings(apifyData.recipeYield),
            thumbnailUrl: extractImageUrl(apifyData.image),
            photos: [] as { url: string; isPrimary: boolean }[],
            tags: generateTags(apifyData, apifyIngredients),
            lastCrawledAt: new Date().toISOString(),
          };
          return new Response(JSON.stringify(recipe), {
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      const hasBR = !!(env.CF_ACCOUNT_ID && env.CF_BR_TOKEN);
      const hasApify = !!env.APIFY_API_TOKEN;
      let error = regularFetchFailed
        ? "This site blocks automated access."
        : "Received a very small response — site may be blocking automated requests.";
      if (!hasBR && !hasApify) {
        error += " Enable Browser Rendering (CF_ACCOUNT_ID + CF_BR_TOKEN) or Apify (APIFY_API_TOKEN) in your environment for better site support.";
      } else if (!hasBR) {
        error += " Enable Browser Rendering (CF_ACCOUNT_ID + CF_BR_TOKEN) for better blocked-site support.";
      }
      return new Response(
        JSON.stringify({ error, browserRendering: hasBR }),
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

    const parsedIngredients = parseIngredients(recipeData.recipeIngredient ?? []);
    const tags = generateTags(recipeData, parsedIngredients);

    const recipe = {
      title: recipeData.name ?? "",
      description: recipeData.description ?? "",
      ingredients: parsedIngredients,
      steps: parseSteps(recipeData.recipeInstructions ?? []),
      prepTime:
        parseDuration(recipeData.prepTime) ??
        parseDuration(recipeData.totalTime),
      cookTime: parseDuration(recipeData.cookTime),
      servings: parseServings(recipeData.recipeYield),
      thumbnailUrl,
      photos,
      videoUrl,
      tags,
      lastCrawledAt: new Date().toISOString(),
    };

    // Cache indefinitely — curated discover content has no reason to expire
    const cacheKey = `discover_cache:${await hashUrl(url)}`;
    env.WHISK_KV.put(cacheKey, JSON.stringify(recipe)).catch(() => {/* best-effort */});

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

// ── Auto-tag generation ─────────────────────────────────────

/** Generate tags from recipe metadata using keyword matching against preset tags */
function generateTags(data: RecipeData, ingredients: { name: string }[]): string[] {
  const tags = new Set<string>();
  const title = (data.name ?? "").toLowerCase();
  const desc = (data.description ?? "").toLowerCase();
  const text = `${title} ${desc}`;
  const ingredientText = ingredients.map((i) => i.name.toLowerCase()).join(" ");

  // Use recipeCategory from JSON-LD
  const categories = Array.isArray(data.recipeCategory)
    ? data.recipeCategory
    : data.recipeCategory ? [data.recipeCategory] : [];
  for (const cat of categories) {
    const lc = cat.toLowerCase().trim();
    if (MEAL_TAGS[lc]) tags.add(MEAL_TAGS[lc]!);
  }

  // Use recipeCuisine from JSON-LD
  const cuisines = Array.isArray(data.recipeCuisine)
    ? data.recipeCuisine
    : data.recipeCuisine ? [data.recipeCuisine] : [];
  for (const c of cuisines) {
    const lc = c.toLowerCase().trim();
    if (CUISINE_TAGS.has(lc)) tags.add(lc);
  }

  // Use keywords from JSON-LD
  const keywords = Array.isArray(data.keywords)
    ? data.keywords
    : typeof data.keywords === "string"
      ? data.keywords.split(",").map((k) => k.trim())
      : [];
  for (const kw of keywords) {
    const lc = kw.toLowerCase().trim();
    if (CUISINE_TAGS.has(lc)) tags.add(lc);
    if (MEAL_TAGS[lc]) tags.add(MEAL_TAGS[lc]!);
    if (DIET_TAGS.has(lc)) tags.add(lc);
  }

  // Meal type from title/description
  const MEAL_PATTERNS: [string, RegExp][] = [
    ["breakfast", /\b(?:breakfast|brunch|pancake|waffle|omelette?|frittata|granola|oatmeal)\b/],
    ["dessert", /\b(?:dessert|cake|cookies?|brownies?|pie|tart|ice cream|pudding|mousse|cheesecake|fudge|candy|souffl[eé])\b/],
    ["appetizer", /\b(?:appetizer|dip|hummus|bruschetta|crostini|spring rolls?|dumplings?|sliders?)\b/],
    ["salad", /\b(?:salad|slaw|coleslaw)\b/],
    ["side dish", /\b(?:side dish|mashed potatoes?|roasted (?:vegetables|potatoes)|rice pilaf|couscous)\b/],
    ["drinks", /\b(?:cocktail|smoothie|lemonade|margarita|sangria|spritz|mojito)\b/],
    ["snack", /\b(?:snack|popcorn|trail mix|energy balls?)\b/],
  ];
  for (const [tag, pattern] of MEAL_PATTERNS) {
    if (pattern.test(text)) tags.add(tag);
  }

  // Cuisine from title
  const CUISINE_PATTERNS: [string, RegExp][] = [
    ["italian", /\b(?:italian|pasta|risotto|lasagna|parm(?:esan|igian)|prosciutto|bruschetta|gnocchi|marinara|bolognese)\b/],
    ["mexican", /\b(?:mexican|taco|burrito|enchilada|quesadilla|salsa|guacamole|pozole|churros?|mole)\b/],
    ["chinese", /\b(?:chinese|stir[- ]?fry|wok|kung pao|lo mein|fried rice|dim sum|szechuan|sichuan)\b/],
    ["thai", /\b(?:thai|pad thai|curry paste|lemongrass|galangal|tom (?:yum|kha))\b/],
    ["indian", /\b(?:indian|curry|tikka|masala|naan|biryani|dal|samosa|tandoori|paneer)\b/],
    ["japanese", /\b(?:japanese|sushi|ramen|teriyaki|miso|tempura|udon|soba|gyoza)\b/],
    ["korean", /\b(?:korean|kimchi|bibimbap|bulgogi|gochujang|japchae)\b/],
    ["mediterranean", /\b(?:mediterranean|hummus|falafel|tahini|pita|tzatziki|shawarma)\b/],
    ["french", /\b(?:french|cr[eê]pe|croissant|souffl[eé]|gratin|ratatouille|bouillabaisse|quiche|brioche)\b/],
  ];
  for (const [tag, pattern] of CUISINE_PATTERNS) {
    if (pattern.test(text)) tags.add(tag);
  }

  // Method from title
  if (/\b(?:instant pot|pressure cook)/i.test(text)) tags.add("instant pot");
  if (/\b(?:slow cook|crock[- ]?pot)/i.test(text)) tags.add("slow cook");
  if (/\b(?:air fr[yi])/i.test(text)) tags.add("air fryer");
  if (/\bgrill/i.test(text)) tags.add("grilling");
  if (/\b(?:one[- ]pot|one[- ]pan|sheet pan)/i.test(text)) tags.add("one-pot");
  if (/\bno[- ](?:cook|bake)/i.test(text)) tags.add("no-cook");
  if (/\bstir[- ]?fry/i.test(text)) tags.add("stir-fry");
  if (/\b(?:bak(?:e|ed|ing)|oven)\b/i.test(text) && !tags.has("dessert")) tags.add("baking");

  // Diet from ingredients
  const hasMeat = /\b(?:chicken|beef|pork|lamb|bacon|sausage|turkey|steak|ham|veal|duck|prosciutto)\b/i.test(ingredientText);
  const hasDairy = /\b(?:butter|cheese|cream|milk|yogurt|sour cream)\b/i.test(ingredientText);
  if (!hasMeat && !hasDairy) tags.add("vegan");
  else if (!hasMeat) tags.add("vegetarian");

  // Season based on current date
  const month = new Date().getMonth(); // 0-indexed
  if (month >= 2 && month <= 4) tags.add("spring");
  else if (month >= 5 && month <= 7) tags.add("summer");
  else if (month >= 8 && month <= 10) tags.add("fall");
  else tags.add("winter");

  // Disambiguate: recipes with protein/main-dish keywords in the title
  // shouldn't be tagged as "snack" (e.g. "fish and chips", "chicken wings")
  if (tags.has("snack") && !tags.has("dinner")) {
    const MAIN_DISH_TITLE = /\b(?:fish|chicken|beef|pork|lamb|steak|shrimp|salmon|turkey|duck|sausage|burger|meatball|pulled|roast|brisket|ribs|chop|fillet|wings?\s+and|and\s+chips|fish\s+(?:&|and)\s+chips)\b/i;
    if (MAIN_DISH_TITLE.test(title)) {
      tags.delete("snack");
      tags.add("dinner");
    }
  }

  return [...tags];
}

const MEAL_TAGS: Record<string, string> = {
  "main course": "dinner", "main dish": "dinner", "dinner": "dinner", "lunch": "dinner",
  "breakfast": "breakfast", "brunch": "brunch",
  "dessert": "dessert", "desserts": "dessert",
  "appetizer": "appetizer", "appetizers": "appetizer", "starter": "appetizer",
  "side dish": "side dish", "side": "side dish",
  "salad": "salad", "salads": "salad",
  "snack": "snack", "snacks": "snack",
  "drink": "drinks", "drinks": "drinks", "beverage": "drinks", "cocktail": "drinks",
  "soup": "dinner", "soups": "dinner",
  "baking": "baking", "bread": "baking",
};

const CUISINE_TAGS = new Set([
  "italian", "mexican", "chinese", "thai", "indian", "japanese",
  "korean", "mediterranean", "american", "french",
]);

const DIET_TAGS = new Set([
  "vegetarian", "vegan", "gluten-free", "dairy-free", "keto", "low-carb", "healthy",
]);

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
  const seenFilenames = new Set<string>();

  // Normalize CDN URLs to canonical keys for dedup — strips fingerprints, dimensions, filters
  const normalizeImageKey = (u: string): string => {
    let n = u.split("?")[0]?.replace(/\/$/, "").replace(/^https?:\/\//, "") ?? u;
    // Strip Dotdash /thmb/FINGERPRINT/DIMENSIONs/filters:.../ path segments
    n = n.replace(/\/thmb\/[^/]+\/[^/]*\d+x\d+[^/]*\/(?:filters:[^/]*\/)?/i, "/thmb/");
    // Strip generic CDN size/crop segments like /750x422/, /4x3/, /1500x0/
    n = n.replace(/\/\d+x\d+\//g, "/");
    // NYT images: strip size/crop suffixes like -articleLarge, -mediumThreeByTwo252, -master675
    n = n.replace(/-(?:article\w+|medium\w+|master\d+|thumb\w+|square\w+|blog\w+|popup|jumbo|super[Jj]umbo|wide\w+|video\w+)\.(jpg|jpeg|png|webp)/i, ".$1");
    return n.toLowerCase();
  };

  const addUrl = (url: string | undefined) => {
    if (!url || seen.has(url)) return;
    // Skip tiny icons, emojis, tracking pixels
    if (url.includes("emoji") || url.includes("icon") || url.includes("avatar")) return;
    if (url.includes("1x1") || url.includes("pixel")) return;
    // Dedup by normalized CDN key
    const key = normalizeImageKey(url);
    if (seenFilenames.has(key)) return;
    seenFilenames.add(key);
    // Also dedup by filename alone for cross-domain matches
    const filename = key.split("/").pop() ?? "";
    if (filename.length > 8 && /\.(jpg|jpeg|png|webp|avif)$/i.test(filename)) {
      // Strip dimension suffixes from filename for better matching
      // e.g. "lamb-biryani-750x422.jpg" → "lamb-biryani.jpg"
      const baseFilename = filename.replace(/-?\d+x\d+/, "");
      if (seenFilenames.has(filename)) return;
      seenFilenames.add(filename);
      if (baseFilename !== filename) {
        if (seenFilenames.has(baseFilename)) return;
        seenFilenames.add(baseFilename);
      }
    }
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
    str
      // Block-level and line-breaking tags → space (must come first)
      .replace(/<\/?(p|br|div|li|ul|ol|tr|td|th|h[1-6]|blockquote|section|article|header|footer|dt|dd)\b[^>]*\/?>/gi, " ")
      // Inline tags → zero-width space (allows adjacent text to merge)
      .replace(/<\/?\w[^>]*>/g, "\u200B")
  )
    // Collapse zero-width spaces between word characters (fixes "l\u200Barge" → "large")
    // Apply repeatedly to handle multiple consecutive zero-width spaces
    .replace(/(\w)(?:\u200B)+(\w)/g, "$1$2")
    // Replace remaining zero-width spaces with actual spaces
    .replace(/\u200B/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Known ingredient/cooking words for re-joining split text artifacts */
const KNOWN_WORDS = new Set([
  // Sizes & descriptors
  "large", "medium", "small", "extra", "thin", "thick", "whole", "half",
  "light", "heavy", "packed", "level", "heaped", "heaping", "about",
  // Cooking prep words
  "chopped", "minced", "diced", "sliced", "peeled", "grated", "shredded",
  "crushed", "frozen", "softened", "melted", "toasted", "divided", "optional",
  "quartered", "halved", "trimmed", "rinsed", "drained", "deveined",
  "julienned", "blanched", "sifted", "warmed", "chilled", "cubed", "pitted",
  "seeded", "cored", "roasted", "steamed", "braised", "grilled", "broiled",
  "smoked", "pickled", "fermented", "marinated", "soaked", "sauteed",
  "caramelized", "charred", "poached", "fried", "baked", "dried", "ground",
  "crumbled", "mashed", "pureed", "shaved", "spiralized", "torn", "snipped",
  // Adverbs
  "roughly", "finely", "coarsely", "thinly", "lightly", "freshly", "loosely",
  "firmly", "well", "very", "just",
  // Meat/protein descriptors
  "boneless", "skinless", "skinned", "bone", "deboned",
  // States
  "unsalted", "salted", "fresh", "dried", "raw", "cooked", "uncooked",
  // Colors
  "black", "white", "red", "green", "yellow", "orange", "brown", "golden",
  "purple", "dark", "bright",
  // Common ingredients
  "sugar", "butter", "cream", "flour", "water", "olive", "virgin", "vegetable",
  "canola", "coconut", "sesame", "vanilla", "extract", "baking", "powder",
  "soda", "salt", "pepper", "chicken", "turkey", "beef", "pork", "lamb",
  "onion", "onions", "garlic", "ginger", "lemon", "lime", "juice", "zest",
  "whipping", "sour", "plain", "greek", "yogurt", "milk", "egg", "eggs",
  "yolk", "yolks", "purpose", "bread", "cake", "wheat", "oat", "corn",
  "starch", "sauce", "paste", "tomato", "canned", "wine", "broth", "stock",
  "honey", "maple", "syrup", "vinegar", "mustard", "mayo", "mayonnaise",
  "ketchup", "soy", "fish", "oyster", "worcestershire", "sriracha",
  // Spices & herbs
  "cinnamon", "cumin", "paprika", "turmeric", "coriander", "cardamom",
  "nutmeg", "cloves", "allspice", "anise", "fennel", "fenugreek",
  "saffron", "oregano", "basil", "thyme", "rosemary", "parsley", "cilantro",
  "dill", "mint", "sage", "tarragon", "chives", "chili", "cayenne",
  "garam", "masala", "curry", "peppercorns", "bay",
  // Produce
  "potato", "potatoes", "carrot", "carrots", "celery", "spinach", "kale",
  "lettuce", "cabbage", "broccoli", "cauliflower", "zucchini", "squash",
  "eggplant", "mushroom", "mushrooms", "bell", "jalapeno", "serrano",
  "habanero", "poblano", "avocado", "cucumber", "peas", "beans", "lentils",
  "chickpeas", "rice", "noodles", "pasta",
  // Dairy & nuts
  "cheese", "parmesan", "mozzarella", "cheddar", "ricotta", "gouda",
  "provolone", "gruyere", "brie", "feta", "paneer", "ghee",
  "almond", "almonds", "walnut", "walnuts", "pecan", "pecans",
  "cashew", "cashews", "pistachio", "pistachios", "peanut", "peanuts",
  // Units/measures that might get split
  "tablespoon", "tablespoons", "teaspoon", "teaspoons", "ounce", "ounces",
  "pound", "pounds", "cup", "cups", "clove", "cloves", "pinch", "dash",
  "slice", "slices", "piece", "pieces", "stick", "bunch", "head", "stalk",
  "sprig", "can", "package",
]);

function cleanIngredientText(str: string): string {
  return str
    // Fix "teaspoon s" / "tablespoon s" / "cup s" artifacts from HTML stripping
    .replace(/\b(teaspoon|tablespoon|cup|ounce|pound|clove|pinch|dash|slice|piece|stick|bunch|can|package|head|stalk|sprig)\s+s\b/gi, "$1s")
    // Fix multi-letter spacing artifacts from HTML tag stripping
    // e.g. "l arge" → "large", "m edium" → "medium", "g reen" → "green"
    // Apply repeatedly to handle chains like "g r een" → "gr een" → "green"
    .replace(/\b(\w{1,3})\s+(\w{2,})\b/g, (match, prefix, rest) => {
      const combined = (prefix as string).toLowerCase() + (rest as string).toLowerCase();
      return KNOWN_WORDS.has(combined) ? (prefix as string) + (rest as string) : match;
    })
    // Second pass for longer prefix splits like "card amom" or "core d"
    .replace(/\b(\w{2,5})\s+(\w{1,3})\b/g, (match, prefix, suffix) => {
      const combined = (prefix as string).toLowerCase() + (suffix as string).toLowerCase();
      return KNOWN_WORDS.has(combined) ? (prefix as string) + (suffix as string) : match;
    })
    // Third pass for mid-word splits like "carda mom", "cilan tro"
    .replace(/\b(\w{3,})\s+(\w{2,})\b/g, (match, prefix, suffix) => {
      const combined = (prefix as string).toLowerCase() + (suffix as string).toLowerCase();
      return KNOWN_WORDS.has(combined) ? (prefix as string) + (suffix as string) : match;
    })
    // Collapse multiple spaces
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Convert decimal fractions to readable unicode fractions */
function normalizeAmount(amount: string): string {
  // Already a unicode fraction or contains one — return as-is
  if (/[½⅓⅔¼¾⅛⅜⅝⅞]/.test(amount)) return amount;

  // Handle slash fractions like "1/3", "1/2", "3 1/4"
  const slashMatch = amount.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (slashMatch) {
    const whole = parseInt(slashMatch[1]!, 10);
    const num = parseInt(slashMatch[2]!, 10);
    const den = parseInt(slashMatch[3]!, 10);
    if (den > 0) {
      const symbol = fractionToUnicode(num / den);
      if (symbol) return whole > 0 ? `${whole} ${symbol}` : symbol;
    }
    return amount; // Can't convert, return as-is
  }
  const simpleSlash = amount.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (simpleSlash) {
    const num = parseInt(simpleSlash[1]!, 10);
    const den = parseInt(simpleSlash[2]!, 10);
    if (den > 0) {
      const symbol = fractionToUnicode(num / den);
      if (symbol) return symbol;
    }
    return amount;
  }

  // Handle decimals like "0.33333334326744" or "0.25" or "1.5"
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;

  const whole = Math.floor(num);
  const decimal = num - whole;

  // Clean integer
  if (Math.abs(decimal) < 0.01) return String(whole);

  // Try to convert decimal part to unicode fraction
  const symbol = fractionToUnicode(decimal);
  if (symbol) return whole > 0 ? `${whole} ${symbol}` : symbol;

  // No close fraction match — round to 2 decimal places
  return num % 1 === 0 ? String(num) : num.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Map a decimal value (0-1) to a unicode fraction symbol, or null if no close match */
function fractionToUnicode(value: number): string | null {
  const fractions: [number, string][] = [
    [0.125, "⅛"], [0.25, "¼"], [1/3, "⅓"], [0.375, "⅜"],
    [0.5, "½"], [0.625, "⅝"], [2/3, "⅔"], [0.75, "¾"], [0.875, "⅞"],
  ];
  for (const [frac, symbol] of fractions) {
    if (Math.abs(value - frac) < 0.03) return symbol;
  }
  return null;
}

function parseIngredients(
  raw: string[]
): { name: string; amount?: string; unit?: string }[] {
  return raw.map((str: string) => {
    // Strip HTML first — JSON-LD ingredients may contain anchor tags or inline markup
    const cleaned = cleanIngredientText(stripHtml(str));
    const match = cleaned.match(
      /^([\d\s./½⅓⅔¼¾⅛⅜⅝⅞]+)\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|liters?|cloves?|cans?|packages?|bunche?s?|pieces?|slices?|sticks?|heads?|stalks?|sprigs?|pinche?s?|dashes?)?\s*(.+)/i
    );
    if (match) {
      return {
        amount: normalizeAmount(match[1]?.trim() ?? ""),
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

// ── NYT Cooking REST API fallback ───────────────────────────

/** Extract numeric recipe ID from an NYT Cooking URL, e.g. /recipes/1015819-chocolate-chip-cookies → 1015819 */
function extractNytRecipeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("nytimes.com")) return null;
    const match = u.pathname.match(/\/recipes\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

interface NytIngredient {
  display_quantity?: string;
  display_text?: string;
}

interface NytStep {
  description?: string;
}

interface NytRecipeResponse {
  id?: number;
  name?: string;
  byline?: string;
  yield?: string;
  cooking_time?: { display?: string; minutes?: string };
  topnote?: { content?: string };
  parts?: { part_label?: string; ingredients?: NytIngredient[] }[];
  directions?: { direction_label?: string; steps?: NytStep[] }[];
  nutritional_information?: Record<string, unknown>;
  tags?: { name?: string; facet?: string }[];
  image?: { crops?: { name?: string; url?: string; width?: number; height?: number }[] };
  avg_rating?: number;
  num_ratings?: number;
  has_video?: boolean;
  video?: { renditions?: { type?: string; url?: string }[] };
}

async function tryNytCookingApi(
  recipeId: string,
  downloadImage: boolean,
  env: Env
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `https://cooking.nytimes.com/api/v5/recipes/${recipeId}`,
      {
        headers: { "x-cooking-api": "cooking-frontend" },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return null;

    const raw = (await res.json()) as NytRecipeResponse;
    if (!raw.name) return null;

    // Parse ingredients from NYT's grouped parts format
    const rawIngredients: string[] = [];
    for (const part of raw.parts ?? []) {
      for (const ing of part.ingredients ?? []) {
        const text = ing.display_text ?? "";
        const qty = ing.display_quantity ?? "";
        rawIngredients.push(qty ? `${qty} ${text}` : text);
      }
    }

    // Parse steps from NYT's grouped directions format
    const rawSteps: string[] = [];
    for (const dir of raw.directions ?? []) {
      for (const step of dir.steps ?? []) {
        if (step.description) rawSteps.push(step.description);
      }
    }

    // Extract description from topnote (strip HTML)
    const description = raw.topnote?.content
      ? stripHtml(raw.topnote.content)
      : "";

    // Extract best image from crops — all crops are the same photo at different sizes,
    // so just pick the highest-quality one (articleLarge preferred, then largest by width)
    const allImageUrls: string[] = [];
    const crops = raw.image?.crops ?? [];
    const articleLarge = crops.find((c) => c.name === "articleLarge");
    if (articleLarge?.url) {
      allImageUrls.push(articleLarge.url);
    } else {
      // Fall back to the largest crop by width
      const sorted = [...crops].filter((c) => c.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
      if (sorted[0]?.url) allImageUrls.push(sorted[0].url);
    }

    let thumbnailUrl = allImageUrls[0];
    let photos: { url: string; isPrimary: boolean }[] = [];

    if (downloadImage && allImageUrls.length > 0) {
      const toDownload = allImageUrls.slice(0, 5);
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
            const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
            const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(imgUrl));
            const hashHex = [...new Uint8Array(hashBuf)]
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("")
              .slice(0, 12);
            const key = `photos/import-${hashHex}.${ext}`;
            await env.WHISK_R2.put(key, imgRes.body, { httpMetadata: { contentType } });
            const isPrimary = i === 0;
            photos.push({ url: `/${key}`, isPrimary });
            if (isPrimary) thumbnailUrl = `/${key}`;
          }
        } catch {
          // Skip failed image download
        }
      }
    } else {
      photos = allImageUrls.slice(0, 5).map((u, i) => ({ url: u, isPrimary: i === 0 }));
    }

    // Map NYT tags to our tag system
    const nytTags = raw.tags ?? [];
    const parsedIngredients = parseIngredients(rawIngredients);
    const nytRecipeData: RecipeData = {
      name: raw.name,
      description,
      recipeIngredient: rawIngredients,
      recipeInstructions: rawSteps,
      recipeYield: raw.yield,
      recipeCategory: nytTags.filter((t) => t.facet === "meal_types").map((t) => t.name ?? ""),
      recipeCuisine: nytTags.filter((t) => t.facet === "cuisines").map((t) => t.name ?? ""),
      keywords: nytTags.map((t) => t.name ?? ""),
    };
    const tags = generateTags(nytRecipeData, parsedIngredients);

    // Parse cooking time
    const cookTimeMinutes = raw.cooking_time?.minutes
      ? Math.round(parseFloat(raw.cooking_time.minutes))
      : undefined;

    return {
      title: raw.name,
      description,
      ingredients: parsedIngredients,
      steps: rawSteps.map((text) => ({ text })),
      prepTime: undefined, // NYT API doesn't separate prep/cook
      cookTime: cookTimeMinutes || undefined,
      servings: parseServings(raw.yield),
      thumbnailUrl,
      photos,
      tags,
      lastCrawledAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
