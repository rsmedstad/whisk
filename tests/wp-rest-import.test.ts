import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_DISCOVER_CONFIG,
  SMITTEN_KITCHEN_FEED_URL,
  migrateDiscoverConfig,
} from "../functions/lib/discover-config";
import {
  feedUrlForPage,
  isWpRestHost,
  parseRssItems,
  wpRestPostToHtml,
} from "../functions/lib/recipe-fetch";
import {
  extractMicrodata,
  runHtmlStrategies,
  splitJetpackDirections,
} from "../functions/api/import/url";

const fixture = (name: string) =>
  readFileSync(new URL(`../functions/lib/fixtures/${name}`, import.meta.url), "utf8");

const TACOS_URL = "https://smittenkitchen.com/2026/09/simple-chicken-tacos/";

describe("WordPress REST post to HTML", () => {
  const rest = JSON.parse(fixture("sk-wp-rest-simple-chicken-tacos.json")) as unknown;

  test("accepts a slug match and yields extractable recipe HTML", () => {
    const html = wpRestPostToHtml(rest, TACOS_URL);
    expect(html).not.toBeNull();
    expect(html!).toContain('<div class="entry-content">');
    const recipe = runHtmlStrategies(html!);
    expect(recipe?.recipeIngredient?.length).toBe(3);
    expect(recipe?.recipeInstructions?.length).toBe(3);
  });

  test("tolerates www, http and trailing-slash differences", () => {
    expect(wpRestPostToHtml(rest, "http://www.smittenkitchen.com/2026/09/simple-chicken-tacos")).not.toBeNull();
  });

  test("rejects a response whose link does not match the page URL", () => {
    expect(wpRestPostToHtml(rest, "https://smittenkitchen.com/2026/09/other-recipe/")).toBeNull();
  });

  test("rejects empty and non-array responses", () => {
    expect(wpRestPostToHtml([], TACOS_URL)).toBeNull();
    expect(wpRestPostToHtml({ code: "rest_no_route" }, TACOS_URL)).toBeNull();
  });

  test("only Smitten Kitchen is flagged wpRest", () => {
    expect(isWpRestHost(TACOS_URL)).toBe(true);
    expect(isWpRestHost("https://www.thekitchn.com/chicken-normandy-recipe-23847408")).toBe(false);
    expect(isWpRestHost("https://pinchofyum.com/x")).toBe(false);
  });
});

describe("Jetpack directions", () => {
  const block = `<div class="jetpack-recipe-directions e-instructions" itemprop="recipeInstructions"><p>Step one text.</p><p>Step two text.</p><p>Step three text.</p><p>Step four text.</p></div>`;

  test("splits <p> blocks into separate steps", () => {
    expect(splitJetpackDirections(block)).toEqual([
      "Step one text.",
      "Step two text.",
      "Step three text.",
      "Step four text.",
    ]);
  });

  test("splits <li> blocks", () => {
    const li = `<div class="jetpack-recipe-directions"><ol><li>First.</li><li>Second.</li></ol></div>`;
    expect(splitJetpackDirections(li)).toEqual(["First.", "Second."]);
  });

  test("extractMicrodata returns every direction block (pumpkin bread regression)", () => {
    const html = `<article><div class="jetpack-recipe hrecipe" itemscope itemtype="https://schema.org/Recipe"><h3 itemprop="name">Pumpkin Bread</h3><ul><li itemprop="recipeIngredient">1 cup sugar</li><li itemprop="recipeIngredient">2 eggs</li></ul>${block}</div></article>`;
    const recipe = extractMicrodata(html);
    expect(recipe?.recipeInstructions?.length).toBe(4);
  });
});

describe("Smitten Kitchen feed", () => {
  test("default feed is the Atom URL", () => {
    expect(feedUrlForPage(TACOS_URL)).toBe("https://smittenkitchen.com/feed/atom/");
    expect(SMITTEN_KITCHEN_FEED_URL).toBe("https://smittenkitchen.com/feed/atom/");
  });

  test("Atom feed parses with alternate links", () => {
    const items = parseRssItems(fixture("sk-atom-feed.xml"));
    expect(items.map((i) => i.url)).toEqual([
      "https://smittenkitchen.com/2026/09/simple-chicken-tacos/",
      "https://smittenkitchen.com/2026/10/skillet-pierogi-with-mushrooms/",
    ]);
  });

  test("saved KV config with the old feed URL is migrated", () => {
    for (const old of ["https://smittenkitchen.com/feed/", "http://feeds.feedburner.com/smittenkitchen"]) {
      const saved = {
        ...DEFAULT_DISCOVER_CONFIG,
        sources: DEFAULT_DISCOVER_CONFIG.sources.map((s) =>
          s.id === "smittenkitchen" ? { ...s, feedUrl: old } : s,
        ),
      };
      const migrated = migrateDiscoverConfig(saved);
      expect(migrated.sources.find((s) => s.id === "smittenkitchen")?.feedUrl).toBe(SMITTEN_KITCHEN_FEED_URL);
    }
  });

  test("a customized feed URL and an up-to-date config are left alone", () => {
    expect(migrateDiscoverConfig(DEFAULT_DISCOVER_CONFIG)).toBe(DEFAULT_DISCOVER_CONFIG);
    const custom = {
      ...DEFAULT_DISCOVER_CONFIG,
      sources: DEFAULT_DISCOVER_CONFIG.sources.map((s) =>
        s.id === "smittenkitchen" ? { ...s, feedUrl: "https://example.com/my-feed" } : s,
      ),
    };
    expect(migrateDiscoverConfig(custom)).toBe(custom);
  });
});
