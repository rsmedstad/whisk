import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_DISCOVER_CONFIG,
  SMITTEN_KITCHEN_FEED_URL,
  migrateDiscoverConfig,
} from "../functions/lib/discover-config";
import {
  isWpRestHost,
  parseRssItems,
  slugFromUrl,
  wpRestPostToHtml,
} from "../functions/lib/recipe-fetch";
import { extractMicrodata } from "../functions/api/import/url";

const fixture = (name: string) =>
  readFileSync(new URL(`../functions/lib/fixtures/${name}`, import.meta.url), "utf8");
const PUMPKIN = "https://smittenkitchen.com/2016/10/pumpkin-bread/";

describe("WordPress REST fetch helpers", () => {
  const posts = JSON.parse(fixture("sk-pumpkin-bread-wp-rest.json"));

  test("slug is the last non-empty path segment", () => {
    expect(slugFromUrl(PUMPKIN)).toBe("pumpkin-bread");
    expect(slugFromUrl("https://smittenkitchen.com/")).toBeNull();
  });

  test("matching link yields wrapped HTML the extractors can read", () => {
    const html = wpRestPostToHtml(posts, PUMPKIN);
    expect(html).toContain("<h1>pumpkin bread</h1>");
    expect(html).toContain('<div class="entry-content">');
    const recipe = extractMicrodata(html!);
    expect(recipe?.recipeIngredient?.length).toBe(14);
  });

  test("link match tolerates www / trailing slash / http", () => {
    expect(wpRestPostToHtml(posts, "http://www.smittenkitchen.com/2016/10/pumpkin-bread")).not.toBeNull();
  });

  test("link mismatch is rejected", () => {
    expect(wpRestPostToHtml(posts, "https://smittenkitchen.com/2016/10/other-post/")).toBeNull();
  });

  test("non-array or empty responses are rejected", () => {
    expect(wpRestPostToHtml([], PUMPKIN)).toBeNull();
    expect(wpRestPostToHtml({ code: "rest_no_route" }, PUMPKIN)).toBeNull();
  });

  test("only Smitten Kitchen is flagged wpRest", () => {
    expect(isWpRestHost(PUMPKIN)).toBe(true);
    expect(isWpRestHost("https://www.thekitchn.com/x-recipe-1")).toBe(false);
    expect(isWpRestHost("https://pinchofyum.com/x")).toBe(false);
  });
});

describe("jetpack-recipe-directions", () => {
  test("splits paragraphs into steps and stops at Notes", () => {
    const html = wpRestPostToHtml(JSON.parse(fixture("sk-pumpkin-bread-wp-rest.json")), PUMPKIN)!;
    const recipe = extractMicrodata(html)!;
    const steps = recipe.recipeInstructions as string[];
    expect(steps.length).toBe(5);
    expect(steps[0]).toStartWith("Heat oven to 350");
    expect(steps.join(" ")).not.toContain("Pan size");
  });
});

describe("Smitten Kitchen feed", () => {
  test("default feed is the Atom URL", () => {
    const sk = DEFAULT_DISCOVER_CONFIG.sources.find((s) => s.id === "smittenkitchen")!;
    expect(sk.feedUrl).toBe("https://smittenkitchen.com/feed/atom/");
    expect(SMITTEN_KITCHEN_FEED_URL).toBe(sk.feedUrl!);
  });

  test("atom fixture parses to items", () => {
    const items = parseRssItems(fixture("sk-atom-feed.xml"));
    expect(items.length).toBe(2);
    expect(items[0]?.url).toBe("https://smittenkitchen.com/2026/10/skillet-pierogi-with-mushrooms/");
    expect(items[0]?.title.length).toBeGreaterThan(3);
  });

  test("migration replaces the old saved feed URL once", () => {
    const saved = structuredClone(DEFAULT_DISCOVER_CONFIG);
    saved.sources.find((s) => s.id === "smittenkitchen")!.feedUrl = "https://smittenkitchen.com/feed/";
    const first = migrateDiscoverConfig(saved);
    expect(first.changed).toBe(true);
    expect(first.config.sources.find((s) => s.id === "smittenkitchen")!.feedUrl).toBe(SMITTEN_KITCHEN_FEED_URL);
    expect(migrateDiscoverConfig(first.config).changed).toBe(false);
  });

  test("migration leaves a user-customised feed URL alone", () => {
    const saved = structuredClone(DEFAULT_DISCOVER_CONFIG);
    saved.sources.find((s) => s.id === "smittenkitchen")!.feedUrl = "https://example.com/my-feed";
    expect(migrateDiscoverConfig(saved).changed).toBe(false);
  });
});
