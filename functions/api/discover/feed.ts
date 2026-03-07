import type { Env } from "../../../src/types";

const KV_KEY = "discover_feed";
const MIN_REFRESH_MS = 60 * 60 * 1000; // 1 hour minimum between refreshes

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

/** Fetch a page with direct fetch first, falling back to Browser Rendering */
async function fetchPage(url: string, env: Env): Promise<string | null> {
  // Try direct fetch first
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: BROWSER_HEADERS,
    });
    if (res.ok) {
      const html = await res.text();
      if (html.length > 500) return html;
    }
  } catch {
    // Direct fetch failed
  }

  // Fall back to Browser Rendering
  return fetchWithBrowserRendering(url, env);
}

interface FeedItem {
  title: string;
  url: string;
  imageUrl?: string;
  description?: string;
}

interface Feed {
  lastRefreshed: string;
  sources: {
    nyt: FeedItem[];
    allrecipes: FeedItem[];
    seriouseats: FeedItem[];
  };
}

// ── GET: return cached feed from KV ─────────────────────

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const feed = await env.WHISK_KV.get<Feed>(KV_KEY, "json");
  return Response.json(
    feed ?? { lastRefreshed: null, sources: { nyt: [], allrecipes: [], seriouseats: [] } }
  );
};

// ── POST: refresh feed by scraping all sources ──────────

export const onRequestPost: PagesFunction<Env> = async ({ env }) => {
  // Rate limit: no more than once per hour
  const existing = await env.WHISK_KV.get<Feed>(KV_KEY, "json");
  if (existing?.lastRefreshed) {
    const elapsed = Date.now() - new Date(existing.lastRefreshed).getTime();
    if (elapsed < MIN_REFRESH_MS) {
      return Response.json(existing);
    }
  }

  // Scrape all three in parallel — each handles its own errors
  const [nyt, allrecipes, seriouseats] = await Promise.all([
    scrapeNYTCooking(env),
    scrapeAllRecipes(env),
    scrapeSeriousEats(env),
  ]);

  const feed: Feed = {
    lastRefreshed: new Date().toISOString(),
    sources: { nyt, allrecipes, seriouseats },
  };

  await env.WHISK_KV.put(KV_KEY, JSON.stringify(feed));
  return Response.json(feed);
};

// ── NYT Cooking (homepage __NEXT_DATA__ JSON) ───────────

async function scrapeNYTCooking(env: Env): Promise<FeedItem[]> {
  try {
    const html = await fetchPage("https://cooking.nytimes.com/", env);
    if (!html) return [];

    // Extract __NEXT_DATA__ JSON blob
    const match = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!match?.[1]) return [];

    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      return [];
    }

    const items: FeedItem[] = [];
    findRecipesInJson(data, items);

    // Deduplicate by URL
    const seen = new Set<string>();
    return items
      .filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
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
  // Try multiple pages to maximize results
  const urls = [
    "https://www.allrecipes.com/",
    "https://www.allrecipes.com/recipes/",
  ];

  const allItems: FeedItem[] = [];
  const seen = new Set<string>();

  for (const pageUrl of urls) {
    try {
      const html = await fetchPage(pageUrl, env);
      if (!html) continue;

      // Try JSON-LD extraction first (most reliable)
      const jsonLdItems = extractJsonLdRecipes(html, "allrecipes.com");
      if (jsonLdItems.length > 0) {
        for (const item of jsonLdItems) {
          if (!seen.has(item.url)) {
            seen.add(item.url);
            allItems.push(item);
          }
        }
      }

      // Also try regex-based extraction with broader pattern
      const regexItems = extractRecipeCards(
        html,
        /https?:\/\/www\.allrecipes\.com\/recipe\/\d+\/[a-z0-9-]+\/?/gi
      );
      for (const item of regexItems) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          allItems.push(item);
        }
      }

      if (allItems.length >= 10) break;
    } catch {
      continue;
    }
  }

  return allItems.slice(0, 30);
}

// ── Serious Eats (/recipes page + homepage) ─────────────

async function scrapeSeriousEats(env: Env): Promise<FeedItem[]> {
  const urls = [
    "https://www.seriouseats.com/",
    "https://www.seriouseats.com/recipes",
  ];

  const allItems: FeedItem[] = [];
  const seen = new Set<string>();

  for (const pageUrl of urls) {
    try {
      const html = await fetchPage(pageUrl, env);
      if (!html) continue;

      // Try JSON-LD extraction first
      const jsonLdItems = extractJsonLdRecipes(html, "seriouseats.com");
      if (jsonLdItems.length > 0) {
        for (const item of jsonLdItems) {
          if (!seen.has(item.url)) {
            seen.add(item.url);
            allItems.push(item);
          }
        }
      }

      // Broader regex: match any seriouseats.com slug that looks like a recipe
      // (contains a hyphenated slug, not just a category page)
      const regexItems = extractRecipeCards(
        html,
        /https?:\/\/www\.seriouseats\.com\/[a-z0-9][a-z0-9-]{5,}[a-z0-9]\/?/gi
      );
      // Filter out non-recipe pages (categories, about, etc.)
      const filtered = regexItems.filter((item) => {
        const path = new URL(item.url).pathname;
        // Skip category/section pages (single segment like /recipes, /about, etc.)
        if (path.split("/").filter(Boolean).length < 1) return false;
        // Skip known non-recipe paths
        if (/^\/(recipes|about|contact|newsletter|culture|equipment|ingredients)\/?$/i.test(path)) return false;
        // Skip roundup pages
        if (path.includes("-recipes-")) return false;
        return true;
      });
      for (const item of filtered) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          allItems.push(item);
        }
      }

      if (allItems.length >= 10) break;
    } catch {
      continue;
    }
  }

  return allItems.slice(0, 30);
}

// ── JSON-LD extraction (works for most modern recipe sites) ──

function extractJsonLdRecipes(html: string, domain: string): FeedItem[] {
  const items: FeedItem[] = [];
  // Find all JSON-LD script blocks
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
          const imageUrl = typeof e.image === "string" ? e.image
            : (Array.isArray(e.image) && typeof e.image[0] === "string") ? e.image[0]
            : (e.image && typeof e.image === "object" && typeof (e.image as Record<string, unknown>).url === "string")
              ? (e.image as Record<string, unknown>).url as string
              : undefined;
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
      const imageUrl = typeof obj.image === "string" ? obj.image
        : (Array.isArray(obj.image) && typeof obj.image[0] === "string") ? obj.image[0]
        : (obj.image && typeof obj.image === "object" && typeof (obj.image as Record<string, unknown>).url === "string")
          ? (obj.image as Record<string, unknown>).url as string
          : undefined;
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

// ── Shared: extract recipe cards from HTML ──────────────

function extractRecipeCards(
  html: string,
  urlPattern: RegExp
): FeedItem[] {
  // Find all matching URLs
  const rawUrls = html.match(urlPattern) ?? [];
  const seen = new Set<string>();
  const items: FeedItem[] = [];

  // Build image map: scan all <img> tags for src+alt pairs
  const imgMap = new Map<string, string>(); // lowercase alt → src URL
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
    // Filter out Serious Eats roundup pages ("-recipes-" plural)
    if (url.includes("-recipes-")) continue;
    seen.add(url);

    // Get context around this URL occurrence for title/image extraction
    const idx = html.indexOf(url);
    if (idx === -1) continue;
    const ctxStart = Math.max(0, idx - 1500);
    const ctxEnd = Math.min(html.length, idx + url.length + 1500);
    const ctx = html.slice(ctxStart, ctxEnd);

    // Find title: try alt text, heading, or link text near the URL
    const altText = ctx.match(
      /<img[^>]+alt="([^"]{5,100})"[^>]*>/i
    )?.[1]?.trim();
    const headingText = ctx.match(
      /<(?:span|h[2-4])[^>]*class="[^"]*(?:title|heading|name|card__title)[^"]*"[^>]*>\s*([^<]{5,100})/i
    )?.[1]?.trim();

    // Fallback: generate title from URL slug
    const slugMatch = url.match(/\/([a-z0-9][a-z0-9-]+[a-z0-9])(?:\/?$)/);
    const slug = slugMatch?.[1]
      ?.replace(/-recipe.*$/, "")
      .replace(/-\d+$/, "");
    const slugTitle = slug
      ?.replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const title = altText ?? headingText ?? slugTitle;
    if (!title || title.length < 3) continue;

    // Find image: context-based or image map lookup
    const ctxImgMatch = ctx.match(
      /<img[^>]+(?:src|data-src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i
    );
    const imageUrl = ctxImgMatch?.[1] ?? imgMap.get(title.toLowerCase());

    items.push({ title, url, imageUrl });
  }

  return items.slice(0, 30);
}
