import type { Env, DiscoverCategory, DiscoverSource } from "../../../src/types";

const KV_KEY = "discover_feed";
const ARCHIVE_KEY = "discover_archive";
const MIN_REFRESH_MS = 2 * 24 * 60 * 60 * 1000; // 2 days between refreshes

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Fetch HTML via Cloudflare Browser Rendering (headless browser) */
async function fetchWithBrowserRendering(
  url: string,
  env: Env
): Promise<string | null> {
  if (!env.CF_ACCOUNT_ID || !env.CF_BR_TOKEN) return null;
  try {
    const res = await fetch(
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
          rejectResourceTypes: ["font", "media"],
          setExtraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
        }),
      }
    );
    if (!res.ok) return null;
    const body = await res.text();
    const html = body.startsWith("{")
      ? ((JSON.parse(body) as { result?: string }).result ?? "")
      : body;
    if (html.length > 500 && !html.includes("<title>Just a moment...</title>")) {
      return html;
    }
    return null;
  } catch {
    return null;
  }
}

/** Check if fetched HTML is a bot challenge / blocked page */
function isBlockedPage(html: string): boolean {
  return (
    html.length < 500 ||
    html.includes("<title>Just a moment...</title>") ||
    html.includes("_cf_chl_opt") ||
    html.includes("challenge-platform") ||
    html.includes("Checking your browser") ||
    html.includes("Vercel Security Checkpoint") ||
    html.includes("Access Denied")
  );
}

/**
 * Fetch a page — try direct fetch first, then Browser Rendering.
 * Reads body even on non-200 responses since many recipe sites
 * (Dotdash Meredith: AllRecipes, Serious Eats) return full HTML
 * with JSON-LD structured data even on 403 responses.
 */
async function fetchPage(url: string, env: Env): Promise<string | null> {
  let directHtml: string | null = null;

  // Try direct fetch first (fast, free)
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: BROWSER_HEADERS,
    });
    // Read body even on non-200 — may contain recipe data
    const html = await res.text();
    if (res.ok && !isBlockedPage(html)) return html;
    // Keep the HTML for fallback (may have JSON-LD even in challenge pages)
    if (html.length > 500) directHtml = html;
  } catch {
    // Direct fetch failed
  }

  // Try Browser Rendering (handles bot protection)
  const brHtml = await fetchWithBrowserRendering(url, env);
  if (brHtml) return brHtml;

  // Fall back to direct fetch HTML — even blocked pages may have
  // JSON-LD or enough link structure for recipe extraction
  return directHtml;
}

/** Normalize a URL for dedup: strip trailing slash and protocol variation */
function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "").replace(/^http:/, "https:");
}

interface FeedItem {
  title: string;
  url: string;
  imageUrl?: string;
  description?: string;
}

/** A feed item enriched with source, category, and archive timestamp */
interface ArchiveItem extends FeedItem {
  source: DiscoverSource;
  category: DiscoverCategory;
  addedAt: string;
}

interface Archive {
  lastRefreshed: string;
  items: ArchiveItem[];
}

/** Legacy scraper format (grouped by source) */
interface Feed {
  lastRefreshed: string;
  sources: {
    nyt: FeedItem[];
    allrecipes: FeedItem[];
    seriouseats: FeedItem[];
  };
}

/** Category-grouped output for the UI */
interface CategoryFeed {
  lastRefreshed: string;
  categories: Partial<Record<DiscoverCategory, ArchiveItem[]>>;
}

// ── Category classifier ─────────────────────────────────
// Maps recipe titles to meal categories using keyword matching.
// These align with the existing tag system's "meal" group.

const CATEGORY_KEYWORDS: [DiscoverCategory, RegExp][] = [
  ["breakfast", /\b(?:breakfast|pancake|waffle|french toast|omelette|omelet|scrambl|frittata|eggs?\b(?!plant)|brunch|granola|oatmeal|muffin|cereal|bagel)\b/i],
  ["soups", /\b(?:soup|stew|chowder|bisque|broth|gumbo|chili|ramen|pho|pozole|minestrone|gazpacho|consomm[eé])\b/i],
  ["salad", /\b(?:salad|slaw|coleslaw|ceviche|poke bowl|grain bowl)\b/i],
  ["dessert", /\b(?:dessert|cake|cookie|brownie|pie|tart|ice cream|gelato|pudding|mousse|crumble|cobbler|cupcake|cheesecake|tiramisu|macaron|fudge|candy|truffle|sorbet|panna cotta|souffl[eé]|pastry|danish|eclair|profiterole|cr[eê]me br[uû]l[eé]e)\b/i],
  ["baking", /\b(?:bread|roll|biscuit|scone|focaccia|pretzel|croissant|challah|sourdough|brioche|ciabatta|flatbread|naan|pita|cinnamon roll|doughnut|donut)\b/i],
  ["drinks", /\b(?:cocktail|drink|smoothie|lemonade|margarita|sangria|spritz|mojito|punch|tea\b|coffee\b|latte|chai|matcha|hot chocolate|eggnog|cider)\b/i],
  ["appetizer", /\b(?:appetizer|dip|hummus|bruschetta|crostini|spring roll|dumpling|wonton|empanada|quesadilla|nacho|slider|bite|crab cake|deviled egg|charcuterie)\b/i],
  ["snack", /\b(?:snack|popcorn|trail mix|chip|cracker|energy ball|protein bar)\b/i],
  ["side dish", /\b(?:side dish|mashed potato|roasted vegetable|rice pilaf|couscous|baked beans|corn bread|cornbread|mac and cheese|macaroni|stuffing|au gratin|roasted potato|french fries|fries|potato salad)\b/i],
  // "dinner" is the default/catch-all for main dishes
];

function classifyRecipe(title: string, description?: string): DiscoverCategory {
  const text = `${title} ${description ?? ""}`;
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return "dinner"; // Default: main dish / entrée
}

// ── GET: return category-grouped feed from archive ──────

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const archive = await env.WHISK_KV.get<Archive>(ARCHIVE_KEY, "json");
  if (!archive || archive.items.length === 0) {
    // Try legacy format for backward compat
    const legacy = await env.WHISK_KV.get<Feed>(KV_KEY, "json");
    if (legacy) return Response.json(migrateLegacyFeed(legacy));
    return Response.json({ lastRefreshed: null, categories: {} });
  }
  return Response.json(archiveToCategoryFeed(archive));
};

// ── POST: refresh feed by scraping, merge into archive ──
// Pass ?force=true to bypass 2-day rate limit (still respects 1-hour minimum)

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const archive = await env.WHISK_KV.get<Archive>(ARCHIVE_KEY, "json");
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";
  const MIN_FORCE_MS = 60 * 60 * 1000; // 1 hour minimum even on force

  // Rate limit: 2 days auto, 1 hour on manual force
  if (archive?.lastRefreshed && archive.items.length > 10) {
    const elapsed = Date.now() - new Date(archive.lastRefreshed).getTime();
    const limit = force ? MIN_FORCE_MS : MIN_REFRESH_MS;
    if (elapsed < limit) {
      return Response.json(archiveToCategoryFeed(archive));
    }
  }

  // Scrape all three in parallel — each handles its own errors
  const [nyt, allrecipes, seriouseats] = await Promise.all([
    scrapeNYTCooking(env),
    scrapeAllRecipes(env),
    scrapeSeriousEats(env),
  ]);

  // Merge new items into archive (dedup by URL)
  const now = new Date().toISOString();
  const existingUrls = new Set(archive?.items.map((i) => normalizeUrl(i.url)) ?? []);
  const newItems: ArchiveItem[] = [];

  const addItems = (items: FeedItem[], source: DiscoverSource) => {
    for (const item of items) {
      const key = normalizeUrl(item.url);
      if (!existingUrls.has(key)) {
        existingUrls.add(key);
        newItems.push({
          ...item,
          source,
          category: classifyRecipe(item.title, item.description),
          addedAt: now,
        });
      }
    }
  };

  addItems(nyt, "nyt");
  addItems(allrecipes, "allrecipes");
  addItems(seriouseats, "seriouseats");

  const updatedArchive: Archive = {
    lastRefreshed: now,
    items: [...(archive?.items ?? []), ...newItems],
  };

  // Also save legacy format for backward compat
  const legacyFeed: Feed = {
    lastRefreshed: now,
    sources: {
      nyt: nyt.length > 0 ? nyt : (archive?.items.filter((i) => i.source === "nyt") ?? []).slice(0, 30),
      allrecipes: allrecipes.length > 0 ? allrecipes : (archive?.items.filter((i) => i.source === "allrecipes") ?? []).slice(0, 30),
      seriouseats: seriouseats.length > 0 ? seriouseats : (archive?.items.filter((i) => i.source === "seriouseats") ?? []).slice(0, 30),
    },
  };

  await Promise.all([
    env.WHISK_KV.put(ARCHIVE_KEY, JSON.stringify(updatedArchive)),
    env.WHISK_KV.put(KV_KEY, JSON.stringify(legacyFeed)),
  ]);

  return Response.json(archiveToCategoryFeed(updatedArchive));
};

/** Convert archive to category-grouped feed for the UI */
function archiveToCategoryFeed(archive: Archive): CategoryFeed {
  const categories: Partial<Record<DiscoverCategory, ArchiveItem[]>> = {};
  for (const item of archive.items) {
    const cat = item.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat]!.push(item);
  }
  return { lastRefreshed: archive.lastRefreshed, categories };
}

/** Migrate legacy source-grouped feed to category feed (one-time) */
function migrateLegacyFeed(feed: Feed): CategoryFeed {
  const now = feed.lastRefreshed;
  const categories: Partial<Record<DiscoverCategory, ArchiveItem[]>> = {};
  const addItems = (items: FeedItem[], source: DiscoverSource) => {
    for (const item of items) {
      const cat = classifyRecipe(item.title, item.description);
      if (!categories[cat]) categories[cat] = [];
      categories[cat]!.push({ ...item, source, category: cat, addedAt: now });
    }
  };
  addItems(feed.sources.nyt, "nyt");
  addItems(feed.sources.allrecipes, "allrecipes");
  addItems(feed.sources.seriouseats, "seriouseats");
  return { lastRefreshed: now, categories };
}

// ── NYT Cooking ─────────────────────────────────────────
// NYT Cooking may use __NEXT_DATA__ (older Next.js) or RSC flight data
// (newer Next.js with React Server Components). We try multiple strategies.

async function scrapeNYTCooking(env: Env): Promise<FeedItem[]> {
  try {
    const html = await fetchPage("https://cooking.nytimes.com/", env);
    if (!html) return [];

    const items: FeedItem[] = [];

    // Strategy 1: __NEXT_DATA__ JSON blob (classic Next.js)
    const nextDataMatch = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (nextDataMatch?.[1]) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        findRecipesInJson(data, items);
      } catch {
        // Invalid JSON
      }
    }

    // Strategy 2: RSC flight data (Next.js with React Server Components)
    // Flight data is embedded as self.__next_f.push([...]) calls
    if (items.length === 0) {
      const flightChunks: string[] = [];
      const flightRegex = /self\.__next_f\.push\(\[[\d,]*"([^"]*)"\]\)/g;
      let flightMatch;
      while ((flightMatch = flightRegex.exec(html)) !== null) {
        if (flightMatch[1]) {
          flightChunks.push(flightMatch[1]);
        }
      }
      if (flightChunks.length > 0) {
        // Flight data contains embedded JSON objects — extract recipe-like URLs
        const combined = flightChunks.join("");
        // Look for recipe URLs and associated data in the flight stream
        const recipeUrlRegex = /(?:cooking\.nytimes\.com)?\/recipes\/(\d+)[-a-z0-9]*/gi;
        const recipeUrls = new Set<string>();
        let urlMatch;
        while ((urlMatch = recipeUrlRegex.exec(combined)) !== null) {
          const fullUrl = urlMatch[0]!.startsWith("http")
            ? urlMatch[0]!
            : `https://cooking.nytimes.com${urlMatch[0]}`;
          recipeUrls.add(normalizeUrl(fullUrl));
        }

        // Try to find JSON fragments in the flight data that contain recipe info
        const jsonFragRegex = /\{[^{}]*"(?:name|title|headline)"[^{}]*"(?:url|path|slug)"[^{}]*\}/g;
        let fragMatch;
        while ((fragMatch = jsonFragRegex.exec(combined)) !== null) {
          try {
            const obj = JSON.parse(fragMatch[0]) as Record<string, unknown>;
            findRecipesInJson(obj, items);
          } catch {
            // Not valid JSON
          }
        }

        // If JSON parsing didn't work, create items from found URLs
        if (items.length === 0 && recipeUrls.size > 0) {
          for (const url of recipeUrls) {
            const slugMatch = url.match(/\/recipes\/\d+-([a-z0-9-]+)/);
            const slug = slugMatch?.[1];
            if (slug) {
              const title = slug
                .replace(/-/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
              items.push({ title, url });
            }
          }
        }
      }
    }

    // Strategy 3: JSON-LD structured data
    if (items.length === 0) {
      const jsonLdItems = extractJsonLdRecipes(html, "cooking.nytimes.com");
      items.push(...jsonLdItems);
    }

    // Strategy 4: HTML link extraction (broadest fallback)
    if (items.length === 0) {
      const linkItems = extractRecipeLinks(
        html,
        /https?:\/\/cooking\.nytimes\.com\/recipes\/\d+[-a-z0-9]*/gi,
        "cooking.nytimes.com"
      );
      items.push(...linkItems);
    }

    // Strategy 5: Open Graph / meta tag extraction for at least the featured recipe
    if (items.length === 0) {
      const metaItem = extractMetaTags(html, "cooking.nytimes.com");
      if (metaItem) items.push(metaItem);
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    return items
      .filter((item) => {
        const key = normalizeUrl(item.url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 40);
  } catch {
    return [];
  }
}

/**
 * Recursively search a JSON tree for objects that look like recipe entries
 * (have a name/title and a URL containing "/recipes/").
 */
function findRecipesInJson(
  obj: unknown,
  results: FeedItem[],
  depth = 0
): void {
  if (depth > 20 || !obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) findRecipesInJson(item, results, depth + 1);
    return;
  }

  const rec = obj as Record<string, unknown>;

  // Check for recipe-like object
  const name =
    (typeof rec.name === "string" && rec.name.length > 2 && rec.name) ||
    (typeof rec.title === "string" && rec.title.length > 2 && rec.title) ||
    (typeof rec.headline === "string" && rec.headline.length > 2 && rec.headline) ||
    (typeof rec.displayName === "string" && rec.displayName.length > 2 && rec.displayName);

  let recipeUrl: string | null = null;
  for (const key of ["url", "uri", "path", "slug", "href", "link"]) {
    const val = rec[key];
    if (typeof val === "string" && val.includes("/recipes/")) {
      recipeUrl = val.startsWith("http")
        ? val
        : `https://cooking.nytimes.com${val}`;
      break;
    }
  }

  if (name && recipeUrl) {
    const imageUrl = extractImageFromJson(rec);
    const description =
      typeof rec.description === "string"
        ? rec.description.slice(0, 200)
        : typeof rec.topnote === "string"
          ? rec.topnote.replace(/<[^>]+>/g, "").slice(0, 200)
          : undefined;

    results.push({ title: name, url: recipeUrl, imageUrl, description });
    return; // Don't recurse into children of a matched recipe
  }

  for (const value of Object.values(rec)) {
    findRecipesInJson(value, results, depth + 1);
  }
}

/** Extract an image URL from various JSON structures */
function extractImageFromJson(rec: Record<string, unknown>): string | undefined {
  for (const key of [
    "image",
    "thumbnail",
    "thumbnailUrl",
    "photo",
    "media",
    "img",
    "promotionalImage",
    "cardImage",
  ]) {
    const val = rec[key];
    if (typeof val === "string" && val.startsWith("http")) return val;

    if (val && typeof val === "object" && !Array.isArray(val)) {
      const imgObj = val as Record<string, unknown>;
      if (typeof imgObj.url === "string") return imgObj.url;

      // NYT Cooking: image.src.card or image.src (string)
      if (imgObj.src && typeof imgObj.src === "object") {
        const srcObj = imgObj.src as Record<string, unknown>;
        if (typeof srcObj.card === "string") return srcObj.card;
        // Fall through to crops
        if (Array.isArray(srcObj.crops)) {
          const firstCrop = srcObj.crops[0] as Record<string, unknown> | undefined;
          if (firstCrop && typeof firstCrop.url === "string") return firstCrop.url;
        }
      }
      if (typeof imgObj.src === "string") return imgObj.src;

      // Generic crops/renditions
      for (const cropKey of ["crops", "renditions", "sizes"]) {
        const crops = imgObj[cropKey];
        if (crops && typeof crops === "object") {
          for (const crop of Object.values(
            crops as Record<string, unknown>
          )) {
            if (crop && typeof crop === "object") {
              const c = crop as Record<string, unknown>;
              if (typeof c.url === "string") return c.url;
            }
          }
        }
      }
    }

    if (Array.isArray(val) && val.length > 0) {
      const first = val[0];
      if (typeof first === "string" && first.startsWith("http")) return first;
      if (first && typeof first === "object") {
        const f = first as Record<string, unknown>;
        if (typeof f.url === "string") return f.url;
        if (typeof f.src === "string") return f.src;
      }
    }
  }

  return undefined;
}

// ── AllRecipes (homepage + trending) ─────────────────────

async function scrapeAllRecipes(env: Env): Promise<FeedItem[]> {
  const urls = [
    "https://www.allrecipes.com/",
    "https://www.allrecipes.com/recipes/",
  ];

  const allItems: FeedItem[] = [];
  const seen = new Set<string>();

  /** Only keep URLs that are actual recipe pages (/recipe/ID/slug) */
  const isRecipeUrl = (url: string): boolean =>
    /\/recipe\/\d+\/[a-z0-9-]+/i.test(url);

  /** Derive a clean title from an AllRecipes URL slug */
  const titleFromSlug = (url: string): string | undefined => {
    const m = url.match(/\/recipe\/\d+\/([a-z0-9-]+)/i);
    return m?.[1]
      ?.replace(/-recipe$/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  /** Check if text is promotional rather than a recipe name */
  const isPromoText = (text: string): boolean => {
    const lc = text.toLowerCase();
    return /\b(?:save|saving|sign up|subscribe|newsletter|featured|home cook|advertisement|start saving|join|log ?in|get the magazine)\b/.test(lc);
  };

  for (const pageUrl of urls) {
    try {
      const html = await fetchPage(pageUrl, env);
      if (!html) continue;

      // Try JSON-LD extraction first (most reliable)
      const jsonLdItems = extractJsonLdRecipes(html, "allrecipes.com");
      for (const item of jsonLdItems) {
        if (!isRecipeUrl(item.url)) continue;
        const key = normalizeUrl(item.url);
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push(item);
        }
      }

      // HTML link extraction — only matches /recipe/ID/slug pattern
      const linkItems = extractRecipeLinks(
        html,
        /https?:\/\/www\.allrecipes\.com\/recipe\/\d+\/[a-z0-9-]+\/?/gi,
        "allrecipes.com"
      );
      for (const item of linkItems) {
        const key = normalizeUrl(item.url);
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push(item);
        }
      }

      if (allItems.length >= 10) break;
    } catch {
      continue;
    }
  }

  // Post-process: fix promotional titles and non-food images
  return allItems.slice(0, 30).map((item) => {
    // Replace promotional text titles with slug-derived recipe name
    const slug = titleFromSlug(item.url);
    const title = isPromoText(item.title) ? (slug ?? item.title) : item.title;

    // Only keep /thmb/ images (recipe thumbnails) — filter out chef
    // profile photos, social avatars, and promotional graphics
    const imageUrl = item.imageUrl && item.imageUrl.includes("/thmb/")
      ? item.imageUrl
      : undefined;

    return { ...item, title, imageUrl };
  });
}

// ── Serious Eats (/recipes page + homepage) ─────────────

async function scrapeSeriousEats(env: Env): Promise<FeedItem[]> {
  const urls = [
    "https://www.seriouseats.com/recipes",
    "https://www.seriouseats.com/",
  ];

  const allItems: FeedItem[] = [];
  const seen = new Set<string>();

  /** Check if a Serious Eats URL is likely an actual recipe page */
  const isRecipePage = (url: string): boolean => {
    const path = new URL(url).pathname.replace(/\/$/, "");
    const slug = path.split("/").pop() ?? "";

    // Must have a slug with substance
    if (slug.length < 8) return false;

    // Positive signals: slug contains "recipe" (very common for SE recipes)
    if (/-recipe$/.test(slug) || slug.includes("-recipe-")) return true;

    // Negative signals: non-recipe content patterns
    const nonRecipePatterns = [
      /^how-to-/,          // how-to guides
      /^what-is-/,         // explainers
      /^what-are-/,        // explainers
      /^why-/,             // explainers
      /^best-/,            // equipment/product roundups
      /^the-best-/,        // equipment/product roundups
      /-guide$/,           // guides
      /-guide-/,           // guides
      /-review$/,          // product reviews
      /-reviews$/,         // product reviews
      /-vs-/,              // comparisons
      /-tips$/,            // tip articles
      /-techniques$/,      // technique articles
      /-essential-/,       // essential guides
      /^about-/,           // about pages
    ];
    if (nonRecipePatterns.some((p) => p.test(slug))) return false;

    // Reject known section pages
    if (/^\/(recipes|about|contact|newsletter|culture|equipment|ingredients|the-food-lab)\/?$/i.test(path)) return false;

    // Accept remaining slugs (many SE recipes don't end in -recipe)
    return true;
  };

  /** Build a map of all /thmb/ images in the HTML keyed by nearby slug/alt */
  const buildImageIndex = (html: string): Map<string, string> => {
    const index = new Map<string, string>();
    // Match img tags with /thmb/ URLs (Dotdash Meredith recipe thumbnails)
    const imgRegex = /<img[^>]+(?:src|data-src)="(https?:\/\/[^"]*\/thmb\/[^"]*)"/gi;
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
      const imgUrl = m[1]!;
      // Look for alt text on this image
      const tagEnd = html.indexOf(">", m.index);
      const tag = html.slice(m.index, tagEnd);
      const altMatch = tag.match(/alt="([^"]+)"/i);
      if (altMatch?.[1]) {
        index.set(altMatch[1].toLowerCase().trim(), imgUrl);
      }
      // Also look for nearby recipe URL to associate image
      const ctx = html.slice(Math.max(0, m.index - 1000), m.index + 1000);
      const urlMatch = ctx.match(/href="(https?:\/\/www\.seriouseats\.com\/[a-z0-9-]+\/?)"/) ;
      if (urlMatch?.[1]) {
        index.set(normalizeUrl(urlMatch[1]), imgUrl);
      }
    }
    // Also try <source> inside <picture> elements
    const srcRegex = /<source[^>]+srcset="(https?:\/\/[^"]*\/thmb\/[^"\s]*)/gi;
    while ((m = srcRegex.exec(html)) !== null) {
      const imgUrl = m[1]!;
      const ctx = html.slice(Math.max(0, m.index - 1000), m.index + 1000);
      const urlMatch = ctx.match(/href="(https?:\/\/www\.seriouseats\.com\/[a-z0-9-]+\/?)" /);
      if (urlMatch?.[1]) {
        index.set(normalizeUrl(urlMatch[1]), imgUrl);
      }
    }
    return index;
  };

  for (const pageUrl of urls) {
    try {
      const html = await fetchPage(pageUrl, env);
      if (!html) continue;

      const imageIndex = buildImageIndex(html);

      // Try JSON-LD extraction first (most reliable — only returns @type: Recipe)
      const jsonLdItems = extractJsonLdRecipes(html, "seriouseats.com");
      for (const item of jsonLdItems) {
        const key = normalizeUrl(item.url);
        if (!seen.has(key)) {
          seen.add(key);
          // Fill in missing images from the HTML image index
          if (!item.imageUrl) {
            item.imageUrl = imageIndex.get(key)
              ?? imageIndex.get(item.title.toLowerCase());
          }
          allItems.push(item);
        }
      }

      // HTML link extraction — only if JSON-LD didn't yield enough
      if (allItems.length < 10) {
        const linkItems = extractRecipeLinks(
          html,
          /https?:\/\/www\.seriouseats\.com\/[a-z0-9][a-z0-9-]{5,}[a-z0-9]\/?/gi,
          "seriouseats.com"
        );
        const filtered = linkItems.filter((item) => isRecipePage(item.url));
        for (const item of filtered) {
          const key = normalizeUrl(item.url);
          if (!seen.has(key)) {
            seen.add(key);
            // Fill in missing images from the HTML image index
            if (!item.imageUrl) {
              item.imageUrl = imageIndex.get(key)
                ?? imageIndex.get(item.title.toLowerCase());
            }
            allItems.push(item);
          }
        }
      }

      if (allItems.length >= 10) break;
    } catch {
      continue;
    }
  }

  // Only keep /thmb/ images (recipe thumbnails, not profiles/ads)
  return allItems.slice(0, 30).map((item) => ({
    ...item,
    imageUrl: item.imageUrl && item.imageUrl.includes("/thmb/") ? item.imageUrl : undefined,
  }));
}

// ── JSON-LD extraction (works for most modern recipe sites) ──

function extractJsonLdRecipes(html: string, domain: string): FeedItem[] {
  const items: FeedItem[] = [];
  const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]!);
      extractRecipesFromJsonLd(data, items, domain);
    } catch {
      // Invalid JSON, skip
    }
  }
  return items;
}

function extractRecipesFromJsonLd(data: unknown, items: FeedItem[], domain: string): void {
  if (!data || typeof data !== "object") return;

  if (Array.isArray(data)) {
    for (const item of data) extractRecipesFromJsonLd(item, items, domain);
    return;
  }

  const obj = data as Record<string, unknown>;

  // Check for @graph array (common wrapper)
  if (Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"]) extractRecipesFromJsonLd(item, items, domain);
    return;
  }

  // Check for ItemList with itemListElement (recipe carousels)
  if (obj["@type"] === "ItemList" && Array.isArray(obj.itemListElement)) {
    for (const entry of obj.itemListElement) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        const itemUrl = typeof e.url === "string" ? e.url : undefined;
        const itemName = typeof e.name === "string" ? e.name : undefined;
        if (itemUrl && itemName && itemUrl.includes(domain)) {
          const imageUrl = extractJsonLdImage(e);
          items.push({ title: itemName, url: itemUrl, imageUrl, description: typeof e.description === "string" ? e.description.slice(0, 200) : undefined });
        }
      }
    }
    return;
  }

  // Check for Recipe type
  const type = obj["@type"];
  const isRecipe = type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"));
  if (isRecipe) {
    const name = typeof obj.name === "string" ? obj.name : undefined;
    let url = typeof obj.url === "string" ? obj.url
      : typeof obj.mainEntityOfPage === "string" ? obj.mainEntityOfPage
      : undefined;
    if (url && !url.startsWith("http")) url = `https://www.${domain}${url}`;

    if (name && url) {
      const imageUrl = extractJsonLdImage(obj);
      items.push({
        title: name,
        url,
        imageUrl,
        description: typeof obj.description === "string" ? obj.description.slice(0, 200) : undefined,
      });
    }
    return;
  }
}

/** Extract image URL from a JSON-LD object */
function extractJsonLdImage(obj: Record<string, unknown>): string | undefined {
  const img = obj.image;
  if (typeof img === "string") return img;
  if (Array.isArray(img) && typeof img[0] === "string") return img[0];
  if (img && typeof img === "object" && typeof (img as Record<string, unknown>).url === "string") {
    return (img as Record<string, unknown>).url as string;
  }
  // Check thumbnailUrl as fallback
  if (typeof obj.thumbnailUrl === "string") return obj.thumbnailUrl;
  return undefined;
}

// ── Extract recipe links from HTML with context-based title/image ──

function extractRecipeLinks(
  html: string,
  urlPattern: RegExp,
  domain: string
): FeedItem[] {
  const rawUrls = html.match(urlPattern) ?? [];
  const seen = new Set<string>();
  const items: FeedItem[] = [];

  // Build image map: scan for <img> tags (src, data-src, srcset)
  const imgMap = new Map<string, string>();
  const imgRegex =
    /<img[^>]+?(?:alt="([^"]*)"[^>]*?(?:src|data-src)="([^"]+)"|(?:src|data-src)="([^"]+)"[^>]*?alt="([^"]*)")/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const alt = (imgMatch[1] ?? imgMatch[4] ?? "").trim().toLowerCase();
    const src = imgMatch[2] ?? imgMatch[3] ?? "";
    if (alt.length > 3 && src.startsWith("http") && !src.includes("data:")) {
      imgMap.set(alt, src);
    }
  }

  for (const rawUrl of rawUrls) {
    const url = rawUrl.replace(/\/$/, "");
    if (seen.has(url)) continue;
    if (url.includes("-recipes-")) continue;
    seen.add(url);

    // Get context around this URL for title/image extraction
    const idx = html.indexOf(url);
    if (idx === -1) continue;
    const ctxStart = Math.max(0, idx - 2000);
    const ctxEnd = Math.min(html.length, idx + url.length + 2000);
    const ctx = html.slice(ctxStart, ctxEnd);

    // Find title from multiple sources (ordered by reliability)
    // 1. Link text: <a href="...url...">Title</a>
    const linkTextMatch = ctx.match(
      new RegExp(`href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*"[^>]*>\\s*(?:<[^>]+>)*\\s*([^<]{3,100})`, "i")
    );
    // 2. Heading text with title/card class (AllRecipes uses mntl-card__title)
    const headingText = ctx.match(
      /<(?:span|h[1-4]|div|a)[^>]*class="[^"]*(?:title|heading|name|card__title|card-title|mntl-card__title)[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{3,100})/i
    )?.[1]?.trim();
    // 3. data-title or aria-label attribute (more reliable than img alt)
    const dataTitle = ctx.match(
      /(?:data-title|aria-label)="([^"]{3,100})"/i
    )?.[1]?.trim();
    // 4. Any nearby heading
    const genericHeading = ctx.match(
      /<h[2-4][^>]*>\s*(?:<[^>]+>\s*)*([^<]{3,100})/i
    )?.[1]?.trim();
    // 5. Fallback: generate title from URL slug (better than img alt text)
    const slugMatch = url.match(/\/([a-z0-9][a-z0-9-]+[a-z0-9])(?:\/?$)/);
    const slug = slugMatch?.[1]
      ?.replace(/-recipe.*$/, "")
      .replace(/-\d+$/, "");
    const slugTitle = slug
      ?.replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const title = linkTextMatch?.[1]?.trim() ?? headingText ?? dataTitle ?? genericHeading ?? slugTitle;
    if (!title || title.length < 3) continue;

    // Find image from context — prefer /thmb/ images (Dotdash Meredith recipe thumbnails)
    const allCtxImages: string[] = [];
    // img src/data-src
    const ctxImgRegex = /<img[^>]+(?:src|data-src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
    let ctxImgM;
    while ((ctxImgM = ctxImgRegex.exec(ctx)) !== null) {
      if (ctxImgM[1]) allCtxImages.push(ctxImgM[1]);
    }
    // srcset
    const srcsetMatch = ctx.match(
      /srcset="(https?:\/\/[^"\s]+\.(?:jpg|jpeg|png|webp)[^"\s]*)[\s,]/i
    );
    if (srcsetMatch?.[1]) allCtxImages.push(srcsetMatch[1]);
    // <source> in <picture> elements (Dotdash Meredith uses these)
    const sourceRegex = /<source[^>]+srcset="(https?:\/\/[^"\s]+\/thmb\/[^"\s]*)/gi;
    let sourceM;
    while ((sourceM = sourceRegex.exec(ctx)) !== null) {
      if (sourceM[1]) allCtxImages.push(sourceM[1]);
    }
    // CSS background-image
    const bgImgMatch = ctx.match(
      /background-image:\s*url\(["']?(https?:\/\/[^"')]+\.(?:jpg|jpeg|png|webp)[^"')]*)/i
    );
    if (bgImgMatch?.[1]) allCtxImages.push(bgImgMatch[1]);
    // data-src (lazy loading)
    const dataSrcMatch = ctx.match(
      /data-src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i
    );
    if (dataSrcMatch?.[1]) allCtxImages.push(dataSrcMatch[1]);
    // From alt-text image map
    const mapImg = imgMap.get(title.toLowerCase());
    if (mapImg) allCtxImages.push(mapImg);

    // Prefer /thmb/ images (actual recipe thumbnails, not profiles/ads)
    const imageUrl = allCtxImages.find((u) => u.includes("/thmb/"))
      ?? allCtxImages[0];

    // Validate image URL belongs to a known domain (not tracking pixels)
    const validImage = imageUrl && isValidImageUrl(imageUrl, domain) ? imageUrl : undefined;

    items.push({ title, url, imageUrl: validImage ?? imageUrl });
  }

  return items.slice(0, 30);
}

/** Check if an image URL looks like a real recipe image (not a tracker/pixel) */
function isValidImageUrl(url: string, _domain: string): boolean {
  // Skip tiny tracking pixels and data URIs
  if (url.includes("1x1") || url.includes("pixel") || url.startsWith("data:")) return false;
  // Must have an image extension or be from a known image CDN
  if (/\.(jpg|jpeg|png|webp|avif)/i.test(url)) return true;
  if (url.includes("/thmb/") || url.includes("/image/") || url.includes("imagesvc")) return true;
  return false;
}

// ── Extract recipe from meta / Open Graph tags ──────────

function extractMetaTags(html: string, domain: string): FeedItem | null {
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1]
    ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i)?.[1];
  const ogUrl = html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i)?.[1]
    ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:url"/i)?.[1];
  const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1]
    ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i)?.[1];
  const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)?.[1]
    ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i)?.[1];

  if (ogTitle && ogUrl && ogUrl.includes(domain)) {
    return {
      title: ogTitle,
      url: ogUrl,
      imageUrl: ogImage,
      description: ogDesc?.slice(0, 200),
    };
  }
  return null;
}
