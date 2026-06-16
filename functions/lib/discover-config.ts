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
export const DEFAULT_DISCOVER_CONFIG: DiscoverConfig = {
  sources: [
    { id: "nyt", label: "NYT Cooking", url: "https://cooking.nytimes.com/", enabled: true },
    { id: "smittenkitchen", label: "Smitten Kitchen", url: "https://smittenkitchen.com/", feedUrl: "https://smittenkitchen.com/feed/", enabled: true },
    { id: "loveandlemons", label: "Love and Lemons", url: "https://www.loveandlemons.com/", feedUrl: "https://www.loveandlemons.com/feed/", enabled: true },
    { id: "thekitchn", label: "The Kitchn", url: "https://www.thekitchn.com/", feedUrl: "https://www.thekitchn.com/main.rss", enabled: true },
    { id: "pinchofyum", label: "Pinch of Yum", url: "https://pinchofyum.com/", feedUrl: "https://pinchofyum.com/feed/", enabled: true },
    { id: "allrecipes", label: "AllRecipes", url: "https://www.allrecipes.com/", enabled: false },
    { id: "seriouseats", label: "Serious Eats", url: "https://www.seriouseats.com/", enabled: false },
  ],
  autoRefreshEnabled: true,
  expirationEnabled: true,
  itemLifetimeDays: 7,
  refreshIntervalDays: 2,
};
