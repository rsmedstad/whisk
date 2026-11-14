import type { DiscoverConfig } from "../../src/types";

/**
 * Single source of truth for the default Discover configuration.
 * Imported by BOTH the feed scraper (api/discover/feed.ts) and the config API
 * (api/discover/config.ts) so the Settings UI and the refresh job never drift.
 *
 * NYT is scraped from HTML; the blog sources use RSS (stable, recency-ordered).
 * AllRecipes & Serious Eats (People Inc / Dotdash Meredith) IP-block Cloudflare,
 * so they're kept but disabled — they auto-recover (with a warning) if that lifts.
 */
/** /feed/ 302s to a FeedBurner URL that answers HTTP 500; the Atom feed is served directly. */
export const SMITTEN_KITCHEN_FEED_URL = "https://smittenkitchen.com/feed/atom/";
const SMITTEN_KITCHEN_OLD_FEED_URLS = [
  "https://smittenkitchen.com/feed/",
  "https://smittenkitchen.com/feed",
  "http://feeds.feedburner.com/smittenkitchen",
  "https://feeds.feedburner.com/smittenkitchen",
];

/**
 * One-time migration for a saved KV config: replace the old, broken Smitten
 * Kitchen feed URL. Returns the same object when nothing changed.
 */
export function migrateDiscoverConfig(config: DiscoverConfig): { config: DiscoverConfig; changed: boolean } {
  let changed = false;
  const sources = config.sources.map((s) => {
    if (s.id === "smittenkitchen" && s.feedUrl && SMITTEN_KITCHEN_OLD_FEED_URLS.includes(s.feedUrl)) {
      changed = true;
      return { ...s, feedUrl: SMITTEN_KITCHEN_FEED_URL };
    }
    return s;
  });
  return changed ? { config: { ...config, sources }, changed } : { config, changed };
}

export const DEFAULT_DISCOVER_CONFIG: DiscoverConfig = {
  sources: [
    { id: "nyt", label: "NYT Cooking", url: "https://cooking.nytimes.com/", enabled: true },
    { id: "smittenkitchen", label: "Smitten Kitchen", url: "https://smittenkitchen.com/", feedUrl: SMITTEN_KITCHEN_FEED_URL, wpRest: true, enabled: true },
    { id: "loveandlemons", label: "Love and Lemons", url: "https://www.loveandlemons.com/", feedUrl: "https://www.loveandlemons.com/feed/", enabled: true },
    { id: "thekitchn", label: "The Kitchn", url: "https://www.thekitchn.com/", feedUrl: "https://www.thekitchn.com/main.rss", enabled: true },
    { id: "pinchofyum", label: "Pinch of Yum", url: "https://pinchofyum.com/", feedUrl: "https://pinchofyum.com/feed/", enabled: true },
    { id: "bbcgoodfood", label: "BBC Good Food", url: "https://www.bbcgoodfood.com/", feedUrl: "https://www.bbcgoodfood.com/recipes/feed", enabled: true },
    { id: "allrecipes", label: "AllRecipes", url: "https://www.allrecipes.com/", enabled: false },
    { id: "seriouseats", label: "Serious Eats", url: "https://www.seriouseats.com/", enabled: false },
  ],
  autoRefreshEnabled: true,
  expirationEnabled: true,
  itemLifetimeDays: 7,
  refreshIntervalDays: 2,
};
