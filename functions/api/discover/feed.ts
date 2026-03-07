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
    scrapeNYTCooking(),
    scrapeAllRecipes(),
    scrapeSeriousEats(),
  ]);

  const feed: Feed = {
    lastRefreshed: new Date().toISOString(),
    sources: { nyt, allrecipes, seriouseats },
  };

  await env.WHISK_KV.put(KV_KEY, JSON.stringify(feed));
  return Response.json(feed);
};

// ── NYT Cooking (homepage __NEXT_DATA__ JSON) ───────────

async function scrapeNYTCooking(): Promise<FeedItem[]> {
  try {
    const res = await fetch("https://cooking.nytimes.com/", {
      signal: AbortSignal.timeout(15000),
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return [];
    const html = await res.text();

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

// ── AllRecipes (homepage HTML) ──────────────────────────

async function scrapeAllRecipes(): Promise<FeedItem[]> {
  try {
    const res = await fetch("https://www.allrecipes.com/", {
      signal: AbortSignal.timeout(15000),
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return [];
    const html = await res.text();

    return extractRecipeCards(
      html,
      /https?:\/\/www\.allrecipes\.com\/recipe\/\d+\/[a-z0-9-]+\/?/gi
    );
  } catch {
    return [];
  }
}

// ── Serious Eats (/recipes page HTML) ───────────────────

async function scrapeSeriousEats(): Promise<FeedItem[]> {
  try {
    const res = await fetch("https://www.seriouseats.com/recipes", {
      signal: AbortSignal.timeout(15000),
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Match individual recipe URLs (contain "-recipe-" or end with "-recipe")
    // but NOT roundup pages (which have "-recipes-" plural)
    return extractRecipeCards(
      html,
      /https?:\/\/www\.seriouseats\.com\/[a-z0-9][a-z0-9-]+-recipe(?:-\d+)?\/?/gi
    );
  } catch {
    return [];
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
