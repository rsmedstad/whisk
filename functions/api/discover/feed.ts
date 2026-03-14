import type { Env, DiscoverCategory, DiscoverSource, DiscoverConfig, DiscoverSourceConfig } from "../../../src/types";
import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
} from "../../lib/ai-providers";

const KV_KEY = "discover_feed";
const ARCHIVE_KEY = "discover_archive";
const CONFIG_KEY = "discover_config";
const MIN_REFRESH_MS = 2 * 24 * 60 * 60 * 1000; // 2 days between refreshes
const DEFAULT_ITEM_LIFETIME_DAYS = 7; // how long a discover item stays visible
const ARCHIVE_RETENTION_DAYS = 30; // keep expired items in DB for this long before purging

/** Default config — matches the legacy hardcoded sources */
const DEFAULT_CONFIG: DiscoverConfig = {
  sources: [
    { id: "nyt", label: "NYT Cooking", url: "https://cooking.nytimes.com/", enabled: true },
    { id: "allrecipes", label: "AllRecipes", url: "https://www.allrecipes.com/", enabled: true },
    { id: "seriouseats", label: "Serious Eats", url: "https://www.seriouseats.com/", enabled: true },
  ],
  autoRefreshEnabled: true,
  expirationEnabled: true,
  itemLifetimeDays: 7,
  refreshIntervalDays: 2,
};

async function loadConfig(env: Env): Promise<DiscoverConfig> {
  const config = await env.WHISK_KV.get<DiscoverConfig>(CONFIG_KEY, "json");
  return config ?? DEFAULT_CONFIG;
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// Track BR errors during a refresh cycle so we can report them to the client
let brWarnings: string[] = [];

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
    if (!res.ok) {
      if (res.status === 429) {
        brWarnings.push("Browser Rendering rate limit reached. Your Cloudflare plan may need more credits.");
      } else if (res.status === 403) {
        brWarnings.push("Browser Rendering access denied. Check your CF_BR_TOKEN.");
      } else {
        brWarnings.push(`Browser Rendering error (${res.status}) for ${new URL(url).hostname}`);
      }
      return null;
    }
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
  totalTime?: number; // total time in minutes
}

/** A feed item enriched with source, category, tags, and archive timestamp */
interface ArchiveItem extends FeedItem {
  source: string; // source ID (legacy: "nyt" | "allrecipes" | "seriouseats", or user-configured slug)
  category: DiscoverCategory;
  addedAt: string;
  expiresAt?: string; // ISO date when this item leaves the discover feed
  tags?: string[];
  totalTime?: number;
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
  ["breakfast", /\b(?:breakfast|pancakes?|waffles?|french toast|omelette|omelet|scrambled?|frittata|eggs?\b(?!plant)|brunch|granola|oatmeal|cereal|bagels?|bostock|morning buns?|dutch baby|cr[eê]pes?|shakshuka|porridge|acai bowl)\b/i],
  ["soups", /\b(?:soup|stew|chowder|bisque|broth|gumbo|chili|ramen|pho|pozole|minestrone|gazpacho|consomm[eé])\b/i],
  ["salad", /\b(?:salad|slaw|coleslaw|ceviche|poke bowl|grain bowl)\b/i],
  ["dessert", /\b(?:dessert|cake|cookies?|brownies?|pie|tart|ice cream|gelato|pudding|mousse|crumble|cobbler|cupcakes?|cheesecake|tiramisu|macarons?|fudge|candy|chocolate truffles?|sorbet|panna cotta|souffl[eé]|pastry|eclair|profiterole|cr[eê]me br[uû]l[eé]e)\b/i],
  ["baking", /\b(?:bread|biscuits?|scones?|focaccia|pretzel|croissant|challah|sourdough|brioche|ciabatta|flatbread|naan|pita|cinnamon rolls?|doughnuts?|donuts?|muffins?|danish pastry)\b/i],
  ["drinks", /\b(?:cocktail|drink|smoothie|lemonade|margarita|sangria|spritz|mojito|punch|tea\b|coffee\b|latte|chai|matcha|hot chocolate|eggnog|cider)\b/i],
  ["appetizer", /\b(?:appetizer|dip|hummus|bruschetta|crostini|spring rolls?|dumplings?|wontons?|empanadas?|quesadillas?|nachos?|sliders?|bites?\b|crab cakes?|deviled eggs?|charcuterie)\b/i],
  ["snack", /\b(?:snack|popcorn|trail mix|chips?|crackers?|energy balls?|protein bars?)\b/i],
  ["side dish", /\b(?:side dish|mashed potatoes?|roasted vegetables?|rice pilaf|couscous|baked beans|corn ?bread|mac and cheese|macaroni|stuffing|au gratin|roasted potatoes?|french fries|fries|potato salad)\b/i],
  // "dinner" is the default/catch-all for main dishes
];

function classifyRecipe(title: string, description?: string): DiscoverCategory {
  const text = `${title} ${description ?? ""}`;
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return "dinner"; // Default: main dish / entrée
}

// ── AI batch-tagging for discover items ─────────────────
// Uses Groq (fast) to tag items with cuisine, meal type, and diet.
// Falls back to keyword matching when no AI provider is available.

/** Tags allowed for discover items — kept tight to avoid bloat */
const DISCOVER_TAGS = [
  // Meal (maps to DiscoverCategory — but AI may be more accurate)
  "breakfast", "brunch", "dinner", "salad", "dessert", "appetizer", "snack", "side dish", "drinks",
  // Cuisine
  "italian", "mexican", "chinese", "thai", "indian", "japanese", "korean", "mediterranean", "american", "french",
  // Diet
  "vegetarian", "vegan", "gluten-free", "keto", "healthy",
  // Method
  "grilling", "baking", "slow cook", "instant pot", "one-pot", "air fryer", "no-cook", "stir-fry",
] as const;

const DISCOVER_TAG_SET = new Set<string>(DISCOVER_TAGS);

/** Batch-tag items using AI. Processes up to 20 items per call for efficiency.
 *  Also estimates totalTime for items missing it. */
async function batchTagItems(
  items: ArchiveItem[],
  env: Env
): Promise<void> {
  const untagged = items.filter((i) => !i.tags || i.tags.length === 0);
  if (untagged.length === 0) return;

  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);

  if (!fnConfig) {
    // No AI available — fall back to keyword matching
    for (const item of untagged) {
      item.tags = keywordTagItem(item);
    }
    return;
  }

  // Process in batches of 20
  const BATCH_SIZE = 20;
  for (let i = 0; i < untagged.length; i += BATCH_SIZE) {
    const batch = untagged.slice(i, i + BATCH_SIZE);
    try {
      const numbered = batch.map((item, idx) => `${idx + 1}. "${item.title}"${item.description ? ` — ${item.description}` : ""}`).join("\n");

      const content = await callTextAI(fnConfig, env, [
        {
          role: "system",
          content: [
            "You are a recipe classifier. For each numbered recipe, assign 2-4 tags from this exact list:",
            "",
            DISCOVER_TAGS.join(", "),
            "",
            "Also estimate the total cook time in minutes (prep + cooking combined).",
            "",
            "Rules:",
            "- Only use tags from the list above.",
            "- Include the meal type (dinner, breakfast, dessert, etc.) and cuisine if identifiable.",
            "- Include diet tags only when clearly applicable.",
            "- Estimate totalTime as a number in minutes. Use your knowledge of typical recipes.",
            '- Return JSON: { "results": [{ "index": 1, "tags": ["dinner", "italian"], "totalTime": 45 }, ...] }',
          ].join("\n"),
        },
        { role: "user", content: numbered },
      ], { maxTokens: 1024, temperature: 0.2, jsonMode: true });

      const parsed = JSON.parse(content) as { results?: { index: number; tags: unknown; totalTime?: unknown }[] };
      if (Array.isArray(parsed.results)) {
        for (const result of parsed.results) {
          if (typeof result.index !== "number" || !Array.isArray(result.tags)) continue;
          const item = batch[result.index - 1];
          if (item) {
            // Normalize to lowercase and validate against allowed set
            const validTags = result.tags
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.toLowerCase().trim())
              .filter((t) => DISCOVER_TAG_SET.has(t));
            if (validTags.length > 0) {
              item.tags = [...new Set(validTags)]; // dedupe
            }
            // Store estimated total time (only if item doesn't already have it from JSON-LD)
            if (!item.totalTime && typeof result.totalTime === "number" && result.totalTime > 0 && result.totalTime < 1440) {
              item.totalTime = Math.round(result.totalTime);
            }
          }
        }
      }
    } catch {
      // AI call failed — fall back to keywords for this batch
      for (const item of batch) {
        if (!item.tags || item.tags.length === 0) {
          item.tags = keywordTagItem(item);
        }
      }
    }

    // Fill in any items that didn't get tags from AI
    for (const item of batch) {
      if (!item.tags || item.tags.length === 0) {
        item.tags = keywordTagItem(item);
      }
    }
  }
}

/** Estimate totalTime for items that have tags but are missing time */
async function batchEstimateTimes(
  items: ArchiveItem[],
  env: Env
): Promise<void> {
  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);
  if (!fnConfig) return;

  const BATCH_SIZE = 30;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      const numbered = batch.map((item, idx) => `${idx + 1}. "${item.title}"${item.description ? ` — ${item.description}` : ""}`).join("\n");

      const content = await callTextAI(fnConfig, env, [
        {
          role: "system",
          content: [
            "Estimate the total cook time in minutes (prep + cooking combined) for each numbered recipe.",
            "Use your knowledge of typical recipes.",
            '- Return JSON: { "results": [{ "index": 1, "totalTime": 45 }, ...] }',
          ].join("\n"),
        },
        { role: "user", content: numbered },
      ], { maxTokens: 512, temperature: 0.2, jsonMode: true });

      const parsed = JSON.parse(content) as { results?: { index: number; totalTime?: unknown }[] };
      if (Array.isArray(parsed.results)) {
        for (const result of parsed.results) {
          if (typeof result.index !== "number") continue;
          const item = batch[result.index - 1];
          if (item && !item.totalTime && typeof result.totalTime === "number" && result.totalTime > 0 && result.totalTime < 1440) {
            item.totalTime = Math.round(result.totalTime);
          }
        }
      }
    } catch {
      // AI call failed — skip this batch
    }
  }
}

/** Keyword-based fallback tagging when AI is unavailable */
function keywordTagItem(item: ArchiveItem): string[] {
  const text = `${item.title} ${item.description ?? ""}`.toLowerCase();
  const tags: string[] = [];

  // Add meal type from category classification
  if (item.category && item.category !== "dinner") {
    // Map DiscoverCategory to tag names (most are 1:1)
    const catTag = item.category === "soups" ? "dinner" : item.category === "baking" ? "baking" : item.category;
    if (DISCOVER_TAG_SET.has(catTag)) tags.push(catTag);
  }
  if (tags.length === 0 || item.category === "dinner") tags.push("dinner");

  // Cuisine detection
  const cuisineKeywords: [string, string[]][] = [
    ["italian", ["italian", "pasta", "risotto", "pizza", "lasagna", "pesto", "marinara", "bolognese", "gnocchi", "bruschetta", "carbonara", "parmesan"]],
    ["mexican", ["mexican", "taco", "burrito", "enchilada", "salsa", "guacamole", "quesadilla", "tamale", "tortilla", "elote"]],
    ["chinese", ["chinese", "stir-fry", "wok", "dumpling", "dim sum", "lo mein", "kung pao", "szechuan", "sichuan", "fried rice"]],
    ["thai", ["thai", "pad thai", "satay", "tom yum", "green curry", "red curry", "larb"]],
    ["indian", ["indian", "tandoori", "tikka", "masala", "naan", "biryani", "samosa", "paneer", "dal", "vindaloo", "korma"]],
    ["japanese", ["japanese", "sushi", "ramen", "teriyaki", "tempura", "miso", "udon", "yakitori", "gyoza", "katsu"]],
    ["korean", ["korean", "bibimbap", "kimchi", "bulgogi", "gochujang", "japchae", "galbi"]],
    ["mediterranean", ["mediterranean", "falafel", "hummus", "tzatziki", "pita", "shawarma", "tabbouleh", "couscous"]],
    ["american", ["american", "burger", "bbq", "mac and cheese", "fried chicken", "buffalo", "hot dog", "cornbread"]],
    ["french", ["french", "soufflé", "crêpe", "croissant", "ratatouille", "coq au vin", "gratin", "quiche", "bouillabaisse"]],
  ];

  for (const [cuisine, keywords] of cuisineKeywords) {
    if (keywords.some((kw) => text.includes(kw))) {
      tags.push(cuisine);
      break; // One cuisine per item
    }
  }

  // Method detection
  if (/\b(?:grill|grilled|grilling|bbq|barbecue)\b/.test(text)) tags.push("grilling");
  else if (/\b(?:slow cook|crockpot|crock pot)\b/.test(text)) tags.push("slow cook");
  else if (/\b(?:instant pot|pressure cook)\b/.test(text)) tags.push("instant pot");
  else if (/\b(?:air fr(?:y|yer|ied))\b/.test(text)) tags.push("air fryer");
  else if (/\b(?:one[- ]pot|one[- ]pan|sheet pan)\b/.test(text)) tags.push("one-pot");
  else if (/\b(?:no[- ]cook|no[- ]bake|raw)\b/.test(text)) tags.push("no-cook");
  else if (/\b(?:stir[- ]fr(?:y|ied))\b/.test(text)) tags.push("stir-fry");

  // Diet detection (only obvious ones from title/description)
  if (/\bvegan\b/.test(text)) tags.push("vegan");
  else if (/\bvegetarian\b/.test(text)) tags.push("vegetarian");
  if (/\bgluten[- ]free\b/.test(text)) tags.push("gluten-free");
  if (/\bketo\b/.test(text)) tags.push("keto");
  if (/\bhealthy\b/.test(text)) tags.push("healthy");

  return tags;
}

// ── GET: return category-grouped feed from archive ──────

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const [archive, config] = await Promise.all([
    env.WHISK_KV.get<Archive>(ARCHIVE_KEY, "json"),
    loadConfig(env),
  ]);

  if (!archive || archive.items.length === 0) {
    // Try legacy format for backward compat
    const legacy = await env.WHISK_KV.get<Feed>(KV_KEY, "json");
    if (legacy) return Response.json(migrateLegacyFeed(legacy));
    return Response.json({ lastRefreshed: null, categories: {} });
  }

  // Use config for lifetime, or client override via ?lifetime=N
  const { searchParams } = new URL(request.url);
  const lifetimeDays = parseInt(searchParams.get("lifetime") ?? "", 10) || config.itemLifetimeDays;
  const sourcesParam = searchParams.get("sources");
  // Filter by enabled sources from config, or client override
  const enabledSourceIds = sourcesParam
    ? new Set(sourcesParam.split(",").filter(Boolean))
    : new Set(config.sources.filter((s) => s.enabled).map((s) => s.id));
  const now = Date.now();

  // Filter: only show items from enabled sources, and respect expiration setting
  const visibleItems = archive.items.filter((item) => {
    if (item.source && !enabledSourceIds.has(item.source)) return false;
    // When expiration is disabled, show all items regardless of age
    if (!config.expirationEnabled) return true;
    const expiry = item.expiresAt
      ? new Date(item.expiresAt).getTime()
      : new Date(item.addedAt).getTime() + lifetimeDays * 24 * 60 * 60 * 1000;
    return expiry > now;
  });

  // Purge items past retention period from the archive in the background
  // (only when expiration is enabled)
  if (config.expirationEnabled) {
    const retentionCutoff = now - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const itemsBeforePurge = archive.items.length;
    const retained = archive.items.filter((item) => {
      const addedMs = new Date(item.addedAt).getTime();
      return addedMs > retentionCutoff;
    });
    if (retained.length < itemsBeforePurge) {
      // Fire-and-forget background purge
      env.WHISK_KV.put(ARCHIVE_KEY, JSON.stringify({
        lastRefreshed: archive.lastRefreshed,
        items: retained,
      }));
    }
  }

  const filtered: Archive = { lastRefreshed: archive.lastRefreshed, items: visibleItems };
  return Response.json(archiveToCategoryFeed(filtered));
};

// ── POST: refresh feed by scraping, merge into archive ──
// Pass ?force=true to bypass 2-day rate limit (still respects 1-hour minimum)

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  brWarnings = []; // Reset warnings for this refresh cycle
  const [archive, config] = await Promise.all([
    env.WHISK_KV.get<Archive>(ARCHIVE_KEY, "json"),
    loadConfig(env),
  ]);
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";
  const lifetimeDays = config.itemLifetimeDays;
  const refreshMs = config.refreshIntervalDays * 24 * 60 * 60 * 1000;
  const MIN_FORCE_MS = 60 * 60 * 1000; // 1 hour minimum even on force

  // Determine which sources to scrape
  const enabledSources = config.sources.filter((s) => s.enabled);

  // Rate limit: configured interval auto, 1 hour on manual force
  if (archive?.lastRefreshed && archive.items.length > 10) {
    const elapsed = Date.now() - new Date(archive.lastRefreshed).getTime();
    const limit = force ? MIN_FORCE_MS : refreshMs;
    if (elapsed < limit) {
      const enabledIds = new Set(enabledSources.map((s) => s.id));
      const filtered = { ...archive, items: archive.items.filter((i) => !i.source || enabledIds.has(i.source)) };
      const remainingMin = Math.ceil((limit - elapsed) / 60000);
      const feed = archiveToCategoryFeed(filtered);
      return Response.json({
        ...feed,
        warnings: [`Feed was refreshed recently. Try again in ${remainingMin} minute${remainingMin !== 1 ? "s" : ""}.`],
      });
    }
  }

  // Map of legacy source IDs to their dedicated site-specific scrapers.
  // These are optimized for sites with non-standard structures (Next.js RSC, Dotdash Meredith CMS).
  // For all other sites, the generic scraper auto-detects the framework and applies enhanced parsing.
  const SITE_PROFILES: Record<string, (env: Env) => Promise<FeedItem[]>> = {
    nyt: scrapeNextJsSite,          // Next.js RSC framework (cooking.nytimes.com)
    allrecipes: scrapeDotdashSite,  // Dotdash Meredith CMS (allrecipes.com)
    seriouseats: scrapeSeriousEatsSite, // Dotdash Meredith CMS variant (seriouseats.com)
  };

  // Scrape all enabled sources in parallel — use site profiles for known sites, generic for others
  const scrapeResults = await Promise.all(
    enabledSources.map(async (src): Promise<{ sourceId: string; items: FeedItem[] }> => {
      try {
        const siteProfile = SITE_PROFILES[src.id];
        if (siteProfile) {
          // Use the dedicated site profile (optimized for this site's framework)
          const items = await siteProfile(env);
          return { sourceId: src.id, items };
        }
        // Generic scraper with auto-framework detection for user-configured sites
        const items = await scrapeGenericSite(src, env);
        return { sourceId: src.id, items };
      } catch {
        brWarnings.push(`Failed to scrape ${src.label}`);
        return { sourceId: src.id, items: [] };
      }
    })
  );

  // Merge new items into archive (dedup by URL + title similarity)
  const now = new Date().toISOString();
  const existingUrls = new Set(archive?.items.map((i) => normalizeUrl(i.url)) ?? []);
  const existingTitles = (archive?.items ?? []).map((i) => i.title);
  const newItems: ArchiveItem[] = [];

  for (const { sourceId, items } of scrapeResults) {
    for (const item of items) {
      const key = normalizeUrl(item.url);
      if (existingUrls.has(key)) continue;
      const isDupTitle = existingTitles.some((t) => titleSimilarity(item.title, t) >= 0.75);
      if (isDupTitle) continue;
      existingUrls.add(key);
      existingTitles.push(item.title);
      const expiresAt = config.expirationEnabled
        ? new Date(Date.now() + lifetimeDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined;
      newItems.push({
        ...item,
        source: sourceId,
        category: classifyRecipe(item.title, item.description),
        addedAt: now,
        expiresAt,
      });
    }
  }

  // AI-tag new items (uses Groq for speed, falls back to keyword matching)
  if (newItems.length > 0) {
    await batchTagItems(newItems, env);
  }

  // Also tag any existing items that don't have tags yet (backfill)
  const untaggedExisting = (archive?.items ?? []).filter((i) => !i.tags || i.tags.length === 0);
  if (untaggedExisting.length > 0) {
    await batchTagItems(untaggedExisting, env);
  }

  // Backfill totalTime for items that have tags but no time estimate
  const allItems = [...(archive?.items ?? []), ...newItems];
  const missingTime = allItems.filter((i) => !i.totalTime && i.tags && i.tags.length > 0);
  if (missingTime.length > 0) {
    await batchEstimateTimes(missingTime, env);
  }

  // Clean up existing archive items
  const cleanedExisting = (archive?.items ?? []).map((item) => ({
    ...item,
    expiresAt: config.expirationEnabled
      ? (item.expiresAt ?? new Date(new Date(item.addedAt).getTime() + lifetimeDays * 24 * 60 * 60 * 1000).toISOString())
      : undefined,
    imageUrl: sanitizeImageUrl(item.imageUrl),
  }));

  const updatedArchive: Archive = {
    lastRefreshed: now,
    items: [...cleanedExisting, ...newItems],
  };

  await env.WHISK_KV.put(ARCHIVE_KEY, JSON.stringify(updatedArchive));

  const feed = archiveToCategoryFeed(updatedArchive);
  const warnings = [...new Set(brWarnings)];
  const totalScraped = scrapeResults.reduce((n, r) => n + r.items.length, 0);
  if (newItems.length === 0 && totalScraped > 0) {
    warnings.push(`Checked ${enabledSources.length} source${enabledSources.length !== 1 ? "s" : ""} and found ${totalScraped} recipe${totalScraped !== 1 ? "s" : ""}, but all were already in your feed.`);
  } else if (newItems.length === 0 && totalScraped === 0) {
    warnings.push(`Checked ${enabledSources.length} source${enabledSources.length !== 1 ? "s" : ""} but couldn't extract any recipes. Sites may be blocking automated access.`);
  }
  return Response.json({
    ...feed,
    newCount: newItems.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
};

// ── PATCH: update a feed item (e.g. fix image after import) ──

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { url, imageUrl, totalTime, tags, category } = (await request.json()) as {
    url: string;
    imageUrl?: string;
    totalTime?: number;
    tags?: string[];
    category?: DiscoverCategory;
  };
  if (!url) {
    return new Response(JSON.stringify({ error: "url required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const archive = await env.WHISK_KV.get<Archive>(ARCHIVE_KEY, "json");
  if (!archive) {
    return new Response(JSON.stringify({ error: "no feed" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  let updated = false;
  for (const item of archive.items) {
    if (normalizeUrl(item.url) === normalizeUrl(url)) {
      if (imageUrl) item.imageUrl = sanitizeImageUrl(imageUrl);
      if (totalTime) item.totalTime = totalTime;
      if (tags) item.tags = tags;
      if (category) item.category = category;
      updated = true;
      break;
    }
  }
  if (updated) {
    await env.WHISK_KV.put(ARCHIVE_KEY, JSON.stringify(archive));
  }
  return Response.json({ ok: true, updated });
};

/** DELETE /api/discover/feed?url=... — remove a single item from the feed */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const reqUrl = new URL(request.url);
  const itemUrl = reqUrl.searchParams.get("url");
  if (!itemUrl) {
    return new Response(JSON.stringify({ error: "url required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const archive = await env.WHISK_KV.get<Archive>(ARCHIVE_KEY, "json");
  if (!archive) {
    return Response.json({ ok: true, removed: false });
  }
  const before = archive.items.length;
  archive.items = archive.items.filter(
    (i) => normalizeUrl(i.url) !== normalizeUrl(itemUrl)
  );
  if (archive.items.length < before) {
    await env.WHISK_KV.put(ARCHIVE_KEY, JSON.stringify(archive));
  }
  return Response.json({ ok: true, removed: archive.items.length < before });
};

/** Convert archive to category-grouped feed for the UI, sanitizing images.
 *  Re-classifies items on every serve so improvements to the regex
 *  automatically fix previously mis-categorised recipes (e.g. items that
 *  defaulted to "dinner" because the keyword wasn't in the list yet). */
function archiveToCategoryFeed(archive: Archive): CategoryFeed {
  const categories: Partial<Record<DiscoverCategory, ArchiveItem[]>> = {};
  for (const item of archive.items) {
    // Re-classify instead of using the frozen category from scrape time
    const cat = classifyRecipe(item.title, item.description);
    if (!categories[cat]) categories[cat] = [];
    categories[cat]!.push({
      ...item,
      category: cat,
      imageUrl: sanitizeImageUrl(item.imageUrl),
    });
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

// ── Title-based deduplication ────────────────────────────

/** Normalize a title for similarity comparison */
function normalizeCompareTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[''"""\-–—:,!?.()[\]{}]/g, " ")
    .replace(/\b(the|a|an|and|or|of|for|with|from|to|in|on|is|are|my|our|your|this|that|best|easy|simple|classic|perfect|ultimate|homemade|recipe)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaccard word similarity between two titles (0–1) */
function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeCompareTitle(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeCompareTitle(b).split(" ").filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let inter = 0;
  for (const w of wordsA) if (wordsB.has(w)) inter++;
  const union = wordsA.size + wordsB.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Remove items with near-duplicate titles (Jaccard >= 0.75). Prefers items with images. */
function deduplicateByTitle(items: FeedItem[]): FeedItem[] {
  const result: FeedItem[] = [];
  const norms: string[] = [];
  for (const item of items) {
    const norm = normalizeCompareTitle(item.title);
    let isDup = false;
    for (let i = 0; i < result.length; i++) {
      if (norm === norms[i] || titleSimilarity(item.title, result[i]!.title) >= 0.75) {
        if (!result[i]!.imageUrl && item.imageUrl) {
          result[i] = item;
          norms[i] = norm;
        }
        isDup = true;
        break;
      }
    }
    if (!isDup) {
      result.push(item);
      norms.push(norm);
    }
  }
  return result;
}

// ── Framework detection ─────────────────────────────────
// Auto-detect the CMS/framework powering a recipe site from its HTML.
// This allows the generic scraper to apply enhanced extraction strategies.

type DetectedFramework = "nextjs" | "dotdash-meredith" | "generic";

/** Known domain → framework hints. Skips detection for sites we've already profiled.
 *  Users can add any site — unknown domains fall through to auto-detection. */
const FRAMEWORK_HINTS: Record<string, DetectedFramework> = {
  "cooking.nytimes.com": "nextjs",
  "allrecipes.com": "dotdash-meredith",
  "seriouseats.com": "dotdash-meredith",
  "foodnetwork.com": "dotdash-meredith",
  "simplyrecipes.com": "dotdash-meredith",
  "thespruceeats.com": "dotdash-meredith",
  "food.com": "dotdash-meredith",
  "bhg.com": "dotdash-meredith",        // Better Homes & Gardens
  "marthastewart.com": "dotdash-meredith",
};

function detectFramework(html: string, domain?: string): DetectedFramework {
  // Check known domain hints first (instant, no HTML parsing needed)
  if (domain) {
    const hint = FRAMEWORK_HINTS[domain] ?? FRAMEWORK_HINTS[domain.replace(/^www\./, "")];
    if (hint) return hint;
  }
  // Next.js: __NEXT_DATA__ or RSC flight data
  if (
    html.includes('id="__NEXT_DATA__"') ||
    html.includes("self.__next_f.push")
  ) {
    return "nextjs";
  }

  // Dotdash Meredith CMS: /thmb/ image CDN + characteristic class names
  // Used by AllRecipes, Serious Eats, Food Network, The Spruce Eats, Simply Recipes, etc.
  if (
    html.includes("/thmb/") &&
    (html.includes("mntl-") || html.includes("dotdash") || html.includes("Dotdash"))
  ) {
    return "dotdash-meredith";
  }

  return "generic";
}

/** Extract recipes from Next.js __NEXT_DATA__ and RSC flight data (framework-level, works on any Next.js recipe site) */
function extractNextJsData(html: string, domain: string): FeedItem[] {
  const items: FeedItem[] = [];

  // Strategy 1: __NEXT_DATA__ JSON blob (classic Next.js)
  const nextDataMatch = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (nextDataMatch?.[1]) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      findRecipesInJson(data, items, 0, domain);
    } catch {
      // Invalid JSON
    }
  }

  // Strategy 2: RSC flight data (Next.js with React Server Components)
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
      const combined = flightChunks.join("");
      // Extract recipe URLs from flight data
      const recipeUrlRegex = new RegExp(
        `(?:${domain.replace(/\./g, "\\.")})?/recipes?/[a-z0-9/-]+`,
        "gi"
      );
      const recipeUrls = new Set<string>();
      let urlMatch;
      while ((urlMatch = recipeUrlRegex.exec(combined)) !== null) {
        const fullUrl = urlMatch[0]!.startsWith("http")
          ? urlMatch[0]!
          : `https://${domain}${urlMatch[0]}`;
        recipeUrls.add(normalizeUrl(fullUrl));
      }

      // Try JSON fragments in flight data
      const jsonFragRegex = /\{[^{}]*"(?:name|title|headline)"[^{}]*"(?:url|path|slug)"[^{}]*\}/g;
      let fragMatch;
      while ((fragMatch = jsonFragRegex.exec(combined)) !== null) {
        try {
          const obj = JSON.parse(fragMatch[0]) as Record<string, unknown>;
          findRecipesInJson(obj, items, 0, domain);
        } catch {
          // Not valid JSON
        }
      }

      // Fallback: create items from found URLs
      if (items.length === 0 && recipeUrls.size > 0) {
        for (const url of recipeUrls) {
          const slugMatch = url.match(/\/(?:recipes?)\/(?:\d+-)?([a-z0-9-]+)/);
          const slug = slugMatch?.[1];
          if (slug) {
            const title = slug
              .replace(/-recipe.*$/, "")
              .replace(/-/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase());
            items.push({ title, url });
          }
        }
      }
    }
  }

  return items;
}

/** Build image index from Dotdash Meredith /thmb/ CDN URLs (works for AllRecipes, Serious Eats, Food Network, etc.) */
function buildDotdashImageIndex(html: string, domain: string): Map<string, string> {
  const index = new Map<string, string>();
  const imgRegex = /<img[^>]+(?:src|data-src)="(https?:\/\/[^"]*\/thmb\/[^"]*)"/gi;
  let m;
  while ((m = imgRegex.exec(html)) !== null) {
    const imgUrl = m[1]!;
    if (isPersonImage(imgUrl)) continue;
    const tagEnd = html.indexOf(">", m.index);
    const tag = html.slice(m.index, tagEnd);
    const altMatch = tag.match(/alt="([^"]+)"/i);
    if (altMatch?.[1]) {
      index.set(altMatch[1].toLowerCase().trim(), imgUrl);
    }
    const ctx = html.slice(Math.max(0, m.index - 1000), m.index + 1000);
    const urlMatch = ctx.match(new RegExp(`href="(https?://(?:www\\.)?${domain.replace(/\./g, "\\.")}[^"]+)"`, "i"));
    if (urlMatch?.[1]) {
      index.set(normalizeUrl(urlMatch[1]), imgUrl);
    }
  }
  // Also try <source> inside <picture> elements
  const srcRegex = /<source[^>]+srcset="(https?:\/\/[^"]*\/thmb\/[^"\s]*)/gi;
  while ((m = srcRegex.exec(html)) !== null) {
    const imgUrl = m[1]!;
    if (isPersonImage(imgUrl)) continue;
    const ctx = html.slice(Math.max(0, m.index - 1000), m.index + 1000);
    const urlMatch = ctx.match(new RegExp(`href="(https?://(?:www\\.)?${domain.replace(/\./g, "\\.")}[^"]+)"`, "i"));
    if (urlMatch?.[1]) {
      index.set(normalizeUrl(urlMatch[1]), imgUrl);
    }
  }
  return index;
}

// ── Generic site scraper (for user-configured sources) ──
// Auto-detects the site's framework and applies enhanced extraction strategies.
// Falls back to JSON-LD → HTML link extraction → Open Graph for unknown frameworks.

async function scrapeGenericSite(source: DiscoverSourceConfig, env: Env): Promise<FeedItem[]> {
  const url = source.url;
  const domain = new URL(url).hostname.replace(/^www\./, "");

  // Fetch the homepage
  const html = await fetchPage(url, env);
  if (!html) return [];

  // Auto-detect the framework powering this site (or use known hint)
  const framework = detectFramework(html, domain);
  const items: FeedItem[] = [];

  // Framework-specific enhanced extraction
  if (framework === "nextjs") {
    const nextJsItems = extractNextJsData(html, domain);
    items.push(...nextJsItems);
  }

  // Strategy 1: JSON-LD structured data (most reliable for recipe sites)
  if (items.length < 5) {
    const jsonLdItems = extractJsonLdRecipes(html, domain);
    const existingUrls = new Set(items.map((i) => normalizeUrl(i.url)));
    for (const item of jsonLdItems) {
      if (!existingUrls.has(normalizeUrl(item.url))) {
        items.push(item);
        existingUrls.add(normalizeUrl(item.url));
      }
    }
  }

  // Strategy 2: HTML link extraction with contextual title/image
  if (items.length < 5) {
    const recipePattern = new RegExp(
      `https?://(?:www\\.)?${domain.replace(/\./g, "\\.")}(?:/[a-z]{2})?/(?:recipes?|cooking)/[a-z0-9-]+[a-z0-9]`,
      "gi"
    );
    const linkItems = extractRecipeLinks(html, recipePattern, domain);
    const existingUrls = new Set(items.map((i) => normalizeUrl(i.url)));
    for (const item of linkItems) {
      if (!existingUrls.has(normalizeUrl(item.url))) {
        items.push(item);
        existingUrls.add(normalizeUrl(item.url));
      }
    }
  }

  // Strategy 3: Broader link extraction if still low results
  if (items.length < 5) {
    const broadPattern = new RegExp(
      `https?://(?:www\\.)?${domain.replace(/\./g, "\\.")}(?:/[a-z0-9-]+){2,}[a-z0-9]`,
      "gi"
    );
    const broadItems = extractRecipeLinks(html, broadPattern, domain);
    const existingUrls = new Set(items.map((i) => normalizeUrl(i.url)));
    for (const item of broadItems) {
      if (!existingUrls.has(normalizeUrl(item.url))) {
        items.push(item);
        existingUrls.add(normalizeUrl(item.url));
      }
    }
  }

  // Strategy 4: Open Graph / meta tag for at least the featured recipe
  if (items.length === 0) {
    const metaItem = extractMetaTags(html, domain);
    if (metaItem) items.push(metaItem);
  }

  // Framework-specific image backfill
  if (framework === "dotdash-meredith") {
    const imageIndex = buildDotdashImageIndex(html, domain);
    for (const item of items) {
      if (!item.imageUrl) {
        item.imageUrl = imageIndex.get(normalizeUrl(item.url))
          ?? imageIndex.get(item.title.toLowerCase());
      }
    }
  }

  // Filter out non-recipe content
  const filtered = items.filter((item) => {
    const lc = item.url.toLowerCase();
    if (/\/(about|contact|privacy|terms|newsletter|subscribe|login|sign-?up|tag|category|author|search)\b/.test(lc)) return false;
    if (/\/(how-to-|what-is-|best-|review|guide|tip|technique|equipment|comparison)/.test(lc)) return false;
    return true;
  });

  return deduplicateByTitle(filtered).slice(0, 30);
}

// ── Next.js site profile (cooking.nytimes.com) ──────────
// Optimized for Next.js sites using __NEXT_DATA__ or RSC flight data.
// The generic scraper also applies Next.js extraction via extractNextJsData()
// for any new Next.js site, but this profile has NYT-specific URL patterns
// and image CDN handling that improve results.

async function scrapeNextJsSite(env: Env): Promise<FeedItem[]> {
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

    // Build an image index from HTML <img> tags to fill in missing images
    // (same approach as Serious Eats — associate images with nearby recipe URLs)
    const imageIndex = buildNYTImageIndex(html);
    for (const item of items) {
      if (!item.imageUrl) {
        const key = normalizeUrl(item.url);
        item.imageUrl = imageIndex.get(key)
          ?? imageIndex.get(item.title.toLowerCase());
      }
    }

    // Deduplicate by URL, then by title similarity
    const seen = new Set<string>();
    const urlDeduped = items.filter((item) => {
      const key = normalizeUrl(item.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return deduplicateByTitle(urlDeduped).slice(0, 40);
  } catch {
    return [];
  }
}

/** Build an image index from NYT Cooking HTML — associate <img> tags with nearby recipe URLs */
function buildNYTImageIndex(html: string): Map<string, string> {
  const index = new Map<string, string>();
  // Match img tags with NYT image CDN URLs (static01.nyt.com, nyt.com/images, etc.)
  const imgRegex = /<img[^>]+(?:src|data-src|srcset)="(https?:\/\/[^"\s]*(?:static01\.nyt|nyt\.com\/images|cooking\.nytimes)[^"\s]*)"/gi;
  let m;
  while ((m = imgRegex.exec(html)) !== null) {
    let imgUrl = m[1]!;
    // For srcset, take just the first URL
    if (imgUrl.includes(" ")) imgUrl = imgUrl.split(" ")[0]!;
    if (isPersonImage(imgUrl)) continue;
    // Look for alt text on this image
    const tagEnd = html.indexOf(">", m.index);
    const tag = html.slice(m.index, tagEnd);
    const altMatch = tag.match(/alt="([^"]+)"/i);
    if (altMatch?.[1]) {
      index.set(altMatch[1].toLowerCase().trim(), imgUrl);
    }
    // Look for nearby recipe URL to associate image with recipe
    const ctx = html.slice(Math.max(0, m.index - 1500), m.index + 1500);
    const urlMatch = ctx.match(/(?:href="|(?:cooking\.nytimes\.com))(\/recipes\/\d+[-a-z0-9]*)/i);
    if (urlMatch?.[1]) {
      const fullUrl = `https://cooking.nytimes.com${urlMatch[1]}`;
      index.set(normalizeUrl(fullUrl), imgUrl);
    }
  }
  // Also try <source> inside <picture> elements
  const srcRegex = /<source[^>]+srcset="(https?:\/\/[^"\s]*(?:static01\.nyt|nyt\.com\/images)[^"\s]*)/gi;
  while ((m = srcRegex.exec(html)) !== null) {
    let imgUrl = m[1]!;
    if (imgUrl.includes(" ")) imgUrl = imgUrl.split(" ")[0]!;
    if (isPersonImage(imgUrl)) continue;
    const ctx = html.slice(Math.max(0, m.index - 1500), m.index + 1500);
    const urlMatch = ctx.match(/(?:href="|(?:cooking\.nytimes\.com))(\/recipes\/\d+[-a-z0-9]*)/i);
    if (urlMatch?.[1]) {
      const fullUrl = `https://cooking.nytimes.com${urlMatch[1]}`;
      index.set(normalizeUrl(fullUrl), imgUrl);
    }
  }
  return index;
}

/**
 * Recursively search a JSON tree for objects that look like recipe entries
 * (have a name/title and a URL containing "/recipes/" or "/recipe/").
 * The domain parameter is used to construct full URLs from relative paths.
 */
function findRecipesInJson(
  obj: unknown,
  results: FeedItem[],
  depth = 0,
  domain = "cooking.nytimes.com"
): void {
  if (depth > 20 || !obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) findRecipesInJson(item, results, depth + 1, domain);
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
    if (typeof val === "string" && (val.includes("/recipes/") || val.includes("/recipe/"))) {
      recipeUrl = val.startsWith("http")
        ? val
        : `https://${domain}${val}`;
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
    // Try to extract time from the JSON object
    const totalTime = parseIsoDuration(rec.totalTime)
      ?? (((parseIsoDuration(rec.prepTime) ?? 0) + (parseIsoDuration(rec.cookTime) ?? 0)) || undefined);

    results.push({ title: name, url: recipeUrl, imageUrl, description, totalTime });
    return; // Don't recurse into children of a matched recipe
  }

  for (const value of Object.values(rec)) {
    findRecipesInJson(value, results, depth + 1, domain);
  }
}

/** Extract an image URL from various JSON structures, filtering out person photos */
function extractImageFromJson(rec: Record<string, unknown>): string | undefined {
  // Skip keys that typically contain author/person photos
  const PERSON_KEYS = new Set(["author", "authorImage", "authorPhoto", "byline", "contributor", "profile"]);

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
    if (PERSON_KEYS.has(key)) continue;
    const val = rec[key];
    if (typeof val === "string" && val.startsWith("http")) {
      const clean = sanitizeImageUrl(val);
      if (clean) return clean;
      continue;
    }

    if (val && typeof val === "object" && !Array.isArray(val)) {
      const imgObj = val as Record<string, unknown>;
      if (typeof imgObj.url === "string") {
        const clean = sanitizeImageUrl(imgObj.url);
        if (clean) return clean;
      }

      // NYT Cooking: image.src.card or image.src (string)
      if (imgObj.src && typeof imgObj.src === "object") {
        const srcObj = imgObj.src as Record<string, unknown>;
        if (typeof srcObj.card === "string") {
          const clean = sanitizeImageUrl(srcObj.card);
          if (clean) return clean;
        }
        // Fall through to crops
        if (Array.isArray(srcObj.crops)) {
          const firstCrop = srcObj.crops[0] as Record<string, unknown> | undefined;
          if (firstCrop && typeof firstCrop.url === "string") {
            const clean = sanitizeImageUrl(firstCrop.url as string);
            if (clean) return clean;
          }
        }
      }
      if (typeof imgObj.src === "string") {
        const clean = sanitizeImageUrl(imgObj.src);
        if (clean) return clean;
      }

      // Generic crops/renditions
      for (const cropKey of ["crops", "renditions", "sizes"]) {
        const crops = imgObj[cropKey];
        if (crops && typeof crops === "object") {
          for (const crop of Object.values(
            crops as Record<string, unknown>
          )) {
            if (crop && typeof crop === "object") {
              const c = crop as Record<string, unknown>;
              if (typeof c.url === "string") {
                const clean = sanitizeImageUrl(c.url);
                if (clean) return clean;
              }
            }
          }
        }
      }
    }

    if (Array.isArray(val) && val.length > 0) {
      const first = val[0];
      if (typeof first === "string" && first.startsWith("http")) {
        const clean = sanitizeImageUrl(first);
        if (clean) return clean;
      }
      if (first && typeof first === "object") {
        const f = first as Record<string, unknown>;
        if (typeof f.url === "string") {
          const clean = sanitizeImageUrl(f.url);
          if (clean) return clean;
        }
        if (typeof f.src === "string") {
          const clean = sanitizeImageUrl(f.src);
          if (clean) return clean;
        }
      }
    }
  }

  return undefined;
}

// ── Dotdash Meredith site profile (allrecipes.com) ───────
// Optimized for Dotdash Meredith CMS sites which use /thmb/ image CDN
// and serve JSON-LD even on 403 responses. The generic scraper also applies
// Dotdash image handling via buildDotdashImageIndex() for any detected DM site.

async function scrapeDotdashSite(env: Env): Promise<FeedItem[]> {
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

  // Post-process: fix promotional titles and non-food images, then dedup by title
  return deduplicateByTitle(allItems).slice(0, 30).map((item) => {
    // Replace promotional text titles with slug-derived recipe name
    const slug = titleFromSlug(item.url);
    const title = isPromoText(item.title) ? (slug ?? item.title) : item.title;

    return { ...item, title, imageUrl: sanitizeImageUrl(item.imageUrl) };
  });
}

// ── Dotdash Meredith variant: Serious Eats (/recipes page + homepage) ──
// Similar to the main Dotdash profile but with additional slug-based
// recipe vs non-recipe filtering specific to seriouseats.com's content mix.

async function scrapeSeriousEatsSite(env: Env): Promise<FeedItem[]> {
  const urls = [
    "https://www.seriouseats.com/recipes",
    "https://www.seriouseats.com/",
  ];

  const allItems: FeedItem[] = [];
  const seen = new Set<string>();

  /** Check if a Serious Eats URL looks like a collection/roundup/gallery page.
   *  Dotdash Meredith collection pages have a numeric ID suffix (7+ digits),
   *  e.g. "boozy-irish-desserts-11921158" or "best-chicken-recipes-5091059" */
  const isCollectionPage = (url: string): boolean => {
    const path = new URL(url).pathname.replace(/\/$/, "");
    const slug = path.split("/").pop() ?? "";
    // Collection pages end with -DIGITS where the digits are 7+ chars (article IDs)
    // Recipe pages with -recipe suffix may also have IDs, so exclude those
    if (/-\d{7,}$/.test(slug) && !/-recipe-\d+$/.test(slug)) return true;
    // Pluralized roundup patterns: "best-X-recipes", "X-desserts", "X-dishes"
    if (/-(recipes|desserts|dishes|dinners|lunches|breakfasts|appetizers|cocktails|drinks|sides|soups|salads|snacks|meals)\b/.test(slug) && !/-recipe$/.test(slug)) return true;
    return false;
  };

  /** Check if a Serious Eats URL is likely an actual recipe page */
  const isRecipePage = (url: string): boolean => {
    const path = new URL(url).pathname.replace(/\/$/, "");
    const slug = path.split("/").pop() ?? "";

    // Must have a slug with substance
    if (slug.length < 8) return false;

    // Reject collection/roundup pages
    if (isCollectionPage(url)) return false;

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

        // Separate collection pages from individual recipes
        const collectionUrls: string[] = [];
        const filtered = linkItems.filter((item) => {
          if (isCollectionPage(item.url)) {
            collectionUrls.push(item.url);
            return false;
          }
          return isRecipePage(item.url);
        });

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

        // Crawl into collection/roundup pages to extract individual recipe links
        // (e.g. "boozy-irish-desserts-11921158" → individual dessert recipes)
        if (allItems.length < 20) {
          const uniqueCollections = [...new Set(collectionUrls.map(normalizeUrl))].slice(0, 3);
          const collectionResults = await Promise.all(
            uniqueCollections.map(async (colUrl) => {
              try {
                const colHtml = await fetchPage(colUrl, env);
                if (!colHtml) return [];
                const colImageIndex = buildImageIndex(colHtml);
                // Extract recipe links from the collection page
                const colJsonLd = extractJsonLdRecipes(colHtml, "seriouseats.com");
                const colLinks = extractRecipeLinks(
                  colHtml,
                  /https?:\/\/www\.seriouseats\.com\/[a-z0-9][a-z0-9-]{5,}[a-z0-9]\/?/gi,
                  "seriouseats.com"
                );
                const combined = [...colJsonLd, ...colLinks].filter((i) => isRecipePage(i.url));
                // Backfill images from the collection page
                for (const item of combined) {
                  if (!item.imageUrl) {
                    item.imageUrl = colImageIndex.get(normalizeUrl(item.url))
                      ?? colImageIndex.get(item.title.toLowerCase());
                  }
                }
                return combined;
              } catch {
                return [];
              }
            })
          );
          for (const colItems of collectionResults) {
            for (const item of colItems) {
              const key = normalizeUrl(item.url);
              if (!seen.has(key)) {
                seen.add(key);
                allItems.push(item);
              }
            }
          }
        }
      }

      if (allItems.length >= 10) break;
    } catch {
      continue;
    }
  }

  return deduplicateByTitle(allItems).slice(0, 30).map((item) => ({
    ...item,
    imageUrl: sanitizeImageUrl(item.imageUrl),
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
      const totalTime = extractJsonLdTime(obj);
      items.push({
        title: name,
        url,
        imageUrl,
        description: typeof obj.description === "string" ? obj.description.slice(0, 200) : undefined,
        totalTime,
      });
    }
    return;
  }
}

/** Parse ISO 8601 duration (e.g. "PT45M", "PT1H30M", "PT2H") to minutes */
function parseIsoDuration(val: unknown): number | undefined {
  if (typeof val !== "string") return undefined;
  const match = val.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return undefined;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const total = hours * 60 + minutes;
  return total > 0 ? total : undefined;
}

/** Extract total time from JSON-LD Recipe: prefer totalTime, fall back to prep+cook */
function extractJsonLdTime(obj: Record<string, unknown>): number | undefined {
  const total = parseIsoDuration(obj.totalTime);
  if (total) return total;
  const prep = parseIsoDuration(obj.prepTime) ?? 0;
  const cook = parseIsoDuration(obj.cookTime) ?? 0;
  const sum = prep + cook;
  return sum > 0 ? sum : undefined;
}

/** Extract image URL from a JSON-LD object, filtering out person photos */
function extractJsonLdImage(obj: Record<string, unknown>): string | undefined {
  const img = obj.image;
  if (typeof img === "string") return sanitizeImageUrl(img);
  if (Array.isArray(img)) {
    // Try each image in the array — skip person photos
    for (const candidate of img) {
      if (typeof candidate === "string") {
        const clean = sanitizeImageUrl(candidate);
        if (clean) return clean;
      }
      if (candidate && typeof candidate === "object") {
        const c = candidate as Record<string, unknown>;
        if (typeof c.url === "string") {
          const clean = sanitizeImageUrl(c.url);
          if (clean) return clean;
        }
      }
    }
  }
  if (img && typeof img === "object" && typeof (img as Record<string, unknown>).url === "string") {
    return sanitizeImageUrl((img as Record<string, unknown>).url as string);
  }
  // Check thumbnailUrl as fallback
  if (typeof obj.thumbnailUrl === "string") return sanitizeImageUrl(obj.thumbnailUrl);
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
    // Use a tight context (500 chars) to avoid cross-contamination between recipes,
    // with a wider fallback (1500 chars) only for images
    const idx = html.indexOf(url);
    if (idx === -1) continue;
    const tightStart = Math.max(0, idx - 500);
    const tightEnd = Math.min(html.length, idx + url.length + 500);
    const tightCtx = html.slice(tightStart, tightEnd);
    const wideStart = Math.max(0, idx - 1500);
    const wideEnd = Math.min(html.length, idx + url.length + 1500);
    const ctx = html.slice(wideStart, wideEnd);

    // Find title from multiple sources (ordered by reliability)
    // 1. Link text: <a href="...url...">Title</a> (most reliable — directly associated)
    const linkTextMatch = tightCtx.match(
      new RegExp(`href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*"[^>]*>\\s*(?:<[^>]+>)*\\s*([^<]{3,100})`, "i")
    );
    // 2. Heading text with title/card class (tight context only)
    const headingText = tightCtx.match(
      /<(?:span|h[1-4]|div|a)[^>]*class="[^"]*(?:title|heading|name|card__title|card-title|mntl-card__title)[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{3,100})/i
    )?.[1]?.trim();
    // 3. data-title or aria-label attribute (tight context only)
    const dataTitle = tightCtx.match(
      /(?:data-title|aria-label)="([^"]{3,100})"/i
    )?.[1]?.trim();
    // 4. Any nearby heading (tight context only)
    const genericHeading = tightCtx.match(
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

    // Find image from context — search tight context first (500 chars), then wide (1500 chars)
    // Tight context prevents picking up images from neighboring cards (e.g. state/travel hero images)
    const findImages = (searchCtx: string): string[] => {
      const imgs: string[] = [];
      // img src/data-src
      const ctxImgRegex = /<img[^>]+(?:src|data-src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
      let ctxImgM;
      while ((ctxImgM = ctxImgRegex.exec(searchCtx)) !== null) {
        if (ctxImgM[1]) imgs.push(ctxImgM[1]);
      }
      // srcset
      const srcsetMatch = searchCtx.match(
        /srcset="(https?:\/\/[^"\s]+\.(?:jpg|jpeg|png|webp)[^"\s]*)[\s,]/i
      );
      if (srcsetMatch?.[1]) imgs.push(srcsetMatch[1]);
      // <source> in <picture> elements (Dotdash Meredith uses these)
      const sourceRegex = /<source[^>]+srcset="(https?:\/\/[^"\s]+\/thmb\/[^"\s]*)/gi;
      let sourceM;
      while ((sourceM = sourceRegex.exec(searchCtx)) !== null) {
        if (sourceM[1]) imgs.push(sourceM[1]);
      }
      // CSS background-image
      const bgImgMatch = searchCtx.match(
        /background-image:\s*url\(["']?(https?:\/\/[^"')]+\.(?:jpg|jpeg|png|webp)[^"')]*)/i
      );
      if (bgImgMatch?.[1]) imgs.push(bgImgMatch[1]);
      // data-src (lazy loading)
      const dataSrcMatch = searchCtx.match(
        /data-src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i
      );
      if (dataSrcMatch?.[1]) imgs.push(dataSrcMatch[1]);
      return imgs;
    };

    // Search tight context first, fall back to wide context
    let allCtxImages = findImages(tightCtx);
    if (allCtxImages.length === 0) allCtxImages = findImages(ctx);
    // From alt-text image map (last resort)
    const mapImg = imgMap.get(title.toLowerCase());
    if (mapImg) allCtxImages.push(mapImg);

    // Filter out person/profile images, then prefer /thmb/ images
    const cleanImages = allCtxImages.filter((u) => !isPersonImage(u));
    const imageUrl = cleanImages.find((u) => u.includes("/thmb/"))
      ?? cleanImages[0];

    // Validate image URL belongs to a known domain (not tracking pixels)
    const validImage = imageUrl && isValidImageUrl(imageUrl, domain) ? imageUrl : undefined;

    items.push({ title, url, imageUrl: validImage ?? sanitizeImageUrl(imageUrl) });
  }

  return items.slice(0, 30);
}

/** Check if an image URL looks like a real recipe image (not a tracker/pixel) */
function isValidImageUrl(url: string, _domain: string): boolean {
  // Skip tiny tracking pixels and data URIs
  if (url.includes("1x1") || url.includes("pixel") || url.startsWith("data:")) return false;
  // Skip person/profile images
  if (isPersonImage(url)) return false;
  // Must have an image extension or be from a known image CDN
  if (/\.(jpg|jpeg|png|webp|avif)/i.test(url)) return true;
  if (url.includes("/thmb/") || url.includes("/image/") || url.includes("imagesvc")) return true;
  return false;
}

/**
 * Detect image URLs that are likely person/author photos rather than food.
 * Common patterns: author headshots, avatars, profile pics, byline photos.
 */
function isPersonImage(url: string): boolean {
  const lc = url.toLowerCase();

  // URL path patterns for profile/person images
  if (/(?:author|avatar|profile|headshot|byline|contributor|bio|staff|portrait|people|person|user)[\/-]/i.test(lc)) return true;

  // Geographic/non-food images (state pages, location headers, travel)
  if (/(?:\/state\/|\/states\/|\/city\/|\/cities\/|\/location\/|\/destination\/|\/travel\/|\/getty-?images)/i.test(lc)) return true;

  // Stock photo / editorial image patterns (often author or lifestyle, not food)
  if (/(?:editorial|lifestyle|headshot|portrait|stock-?photo)/i.test(lc)) return true;

  // Gravatar and similar avatar services
  if (lc.includes("gravatar.com") || lc.includes("secure.gravatar")) return true;

  // Very small image dimensions in the URL (typical for author avatars)
  // Matches patterns like /60x60/, _60x60., -60x60. etc.
  const dimMatch = lc.match(/[/_-](\d+)x(\d+)[./_-]/);
  if (dimMatch) {
    const w = parseInt(dimMatch[1]!, 10);
    const h = parseInt(dimMatch[2]!, 10);
    if (w <= 150 && h <= 150) return true;
  }

  // NYT-specific: author photos often in /images/... with small crop dimensions
  if (lc.includes("nyt.com") && /author|byline/i.test(lc)) return true;

  // NYT / editorial images that show places, maps, or non-food content
  if (/(?:\/maps\/|\/places\/|\/region\/|\/illustration|\/graphic|promo-image|newsletter)/i.test(lc)) return true;

  return false;
}

/**
 * Sanitize an image URL — returns undefined if it looks like a person/profile photo.
 * Use this as a single filter point for all image extraction paths.
 */
function sanitizeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Allow local R2 photo paths (from imported recipes) and http URLs
  if (!url.startsWith("http") && !url.startsWith("/photos/")) return undefined;
  if (isPersonImage(url)) return undefined;
  // Skip tracking pixels
  if (url.includes("1x1") || url.includes("pixel")) return undefined;
  return url;
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
      imageUrl: sanitizeImageUrl(ogImage),
      description: ogDesc?.slice(0, 200),
    };
  }
  return null;
}
