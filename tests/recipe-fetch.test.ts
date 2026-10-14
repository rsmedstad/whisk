import { describe, expect, test } from "bun:test";
import {
  RECIPE_FETCH_TIMEOUT_MS,
  RECIPE_IMPORT_CLIENT_TIMEOUT_MS,
  buildSourceFetchError,
  classifyPageFetch,
  decodeXmlEntities,
  extractRecipeFromRssItem,
  extractRecipeJsonLd,
  feedUrlForPage,
  findRssItemForUrl,
  hasRecipeJsonLd,
  isAbortError,
  isChallengeHtml,
  jsonLdAsHtml,
  normalizeRecipeUrl,
  parseRssItems,
  shouldFailFast,
  sourceLabelForUrl,
  type RecipePageFetch,
} from "../functions/lib/recipe-fetch";

const KITCHN_403 = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Access to this page has been denied.</title>
<script>window._pxAppId = "PXjAYekY18";</script>
</head>
<body>
<div id="px-captcha"></div>
<p>Access to this page has been denied.</p>
</body>
</html>`;

const DOTDASH_403_WITH_RECIPE = `<!DOCTYPE html><html><head>
<title>Easy Pasta</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"Easy Pasta",
 "recipeIngredient":["1 lb pasta","2 tbsp olive oil"],
 "recipeInstructions":[{"@type":"HowToStep","text":"Boil water."}]}
</script>
</head><body><h1>Easy Pasta</h1><p>A real page that happens to 403.</p></body></html>`;

const KITCHN_RSS = `<?xml version='1.0' encoding='utf-8'?>
<rss xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>Kitchn</title>
    <item>
      <title>Greek Meatballs (Keftedes)</title>
      <link>https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745?utm_source=RSS&amp;utm_medium=feed</link>
      <guid>https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745</guid>
      <description>&lt;img src="https://cdn.apartmenttherapy.info/image/upload/keftedes-375"&gt;
These Greek meatballs are weeknight-friendly.
&lt;a href="https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745"&gt;READ MORE...&lt;/a&gt;</description>
      <g:image_link>https://cdn.apartmenttherapy.info/image/upload/keftedes-375</g:image_link>
      <category>Recipes</category>
      <category>dinner</category>
      <category>greek</category>
    </item>
    <item>
      <title>Full Recipe In Feed</title>
      <link>https://smittenkitchen.com/full-recipe-in-feed/</link>
      <content:encoded><![CDATA[
        <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Recipe","name":"Full Recipe In Feed",
         "image":"https://example.com/pie.jpg",
         "recipeIngredient":["2 cups flour","1 cup butter"],
         "recipeInstructions":[{"@type":"HowToStep","text":"Mix and bake."}]}
        </script>
        <p>Preheat the oven.</p>
      ]]></content:encoded>
    </item>
  </channel>
</rss>`;

function page(partial: Partial<RecipePageFetch>): RecipePageFetch {
  return {
    html: null,
    status: null,
    timedOut: false,
    challenge: false,
    ms: 40,
    ...partial,
  };
}

describe("timeout constants", () => {
  test("server fetch budget is ~8s", () => {
    expect(RECIPE_FETCH_TIMEOUT_MS).toBe(8000);
  });
  test("client import timeout is above the server budget", () => {
    expect(RECIPE_IMPORT_CLIENT_TIMEOUT_MS).toBeGreaterThan(RECIPE_FETCH_TIMEOUT_MS);
  });
});

describe("isChallengeHtml", () => {
  test("flags The Kitchn PerimeterX interstitial", () => {
    expect(isChallengeHtml(KITCHN_403)).toBe(true);
  });
  test("flags an empty / tiny body without JSON-LD", () => {
    expect(isChallengeHtml("nope")).toBe(true);
    expect(isChallengeHtml("")).toBe(true);
  });
  test("does not flag a 403 body that still has Recipe JSON-LD", () => {
    expect(isChallengeHtml(DOTDASH_403_WITH_RECIPE)).toBe(false);
  });
  test("flags Cloudflare / generic interstitials", () => {
    expect(isChallengeHtml("<html><title>Just a moment...</title><p>challenge-platform</p></html>")).toBe(true);
    expect(isChallengeHtml("<html><body>Vercel Security Checkpoint</body></html>")).toBe(true);
  });
});

describe("hasRecipeJsonLd / extractRecipeJsonLd", () => {
  test("Kitchn 403 has no recipe data", () => {
    expect(hasRecipeJsonLd(KITCHN_403)).toBe(false);
    expect(extractRecipeJsonLd(KITCHN_403)).toBeNull();
  });
  test("pulls ingredients, steps, and image from a Recipe block", () => {
    expect(hasRecipeJsonLd(DOTDASH_403_WITH_RECIPE)).toBe(true);
    const recipe = extractRecipeJsonLd(DOTDASH_403_WITH_RECIPE);
    expect(recipe?.name).toBe("Easy Pasta");
    expect(recipe?.recipeIngredient).toEqual(["1 lb pasta", "2 tbsp olive oil"]);
    expect(Array.isArray(recipe?.recipeInstructions)).toBe(true);
  });
});

describe("shouldFailFast / classifyPageFetch", () => {
  test("timeout → source_timeout", () => {
    const p = page({ timedOut: true });
    expect(shouldFailFast(p)).toBe(true);
    expect(classifyPageFetch(p)).toBe("source_timeout");
  });
  test("Kitchn-style 403 challenge → source_blocked", () => {
    const p = page({ html: KITCHN_403, status: 403, challenge: true, ms: 40 });
    expect(shouldFailFast(p)).toBe(true);
    expect(classifyPageFetch(p)).toBe("source_blocked");
  });
  test("403 with Recipe JSON-LD is usable — do not fail fast", () => {
    const p = page({
      html: DOTDASH_403_WITH_RECIPE,
      status: 403,
      challenge: isChallengeHtml(DOTDASH_403_WITH_RECIPE),
    });
    expect(shouldFailFast(p)).toBe(false);
    expect(classifyPageFetch(p)).toBeNull();
  });
  test("empty body → blocked", () => {
    const p = page({ html: "", status: 200 });
    expect(classifyPageFetch(p)).toBe("source_blocked");
  });
});

describe("source error payload", () => {
  test("blocked Kitchn URL names the source and keeps the original link", () => {
    const body = buildSourceFetchError(
      "source_blocked",
      "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
    );
    expect(body.code).toBe("source_blocked");
    expect(body.sourceLabel).toBe("The Kitchn");
    expect(body.sourceUrl).toContain("thekitchn.com/greek-meatballs-keftedes-recipe-23847745");
    expect(body.error).toMatch(/The Kitchn/i);
    expect(body.error).toMatch(/original recipe/i);
  });
  test("timeout payload is distinct", () => {
    const body = buildSourceFetchError("source_timeout", "https://www.thekitchn.com/foo");
    expect(body.code).toBe("source_timeout");
    expect(body.error).toMatch(/didn't respond in time/i);
  });
});

describe("normalizeRecipeUrl", () => {
  test("strips www, trailing slash, and RSS utm params", () => {
    expect(
      normalizeRecipeUrl(
        "http://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745/?utm_source=RSS&utm_medium=feed",
      ),
    ).toBe("https://thekitchn.com/greek-meatballs-keftedes-recipe-23847745");
  });
});

describe("RSS strategy — The Kitchn teasers vs full-content feeds", () => {
  const items = parseRssItems(KITCHN_RSS);

  test("parses both items", () => {
    expect(items).toHaveLength(2);
  });

  test("matches a Discover URL to the Kitchn item despite UTM params", () => {
    const item = findRssItemForUrl(
      items,
      "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
    );
    expect(item?.title).toBe("Greek Meatballs (Keftedes)");
    expect(item?.imageUrl).toContain("apartmenttherapy.info");
    expect(item?.categories).toContain("Recipes");
  });

  test("Kitchn content:encoded is absent — description is a teaser, no JSON-LD Recipe", () => {
    const item = findRssItemForUrl(
      items,
      "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
    );
    expect(item).toBeDefined();
    expect(item!.contentHtml).toBe("");
    expect(item!.descriptionHtml).toMatch(/weeknight-friendly/);
    expect(extractRecipeFromRssItem(item!)).toBeNull();
    expect(hasRecipeJsonLd(item!.descriptionHtml)).toBe(false);
  });

  test("a feed item that carries Recipe JSON-LD in content:encoded is used", () => {
    const item = findRssItemForUrl(items, "https://smittenkitchen.com/full-recipe-in-feed/");
    const recipe = extractRecipeFromRssItem(item!);
    expect(recipe?.name).toBe("Full Recipe In Feed");
    expect(recipe?.recipeIngredient).toEqual(["2 cups flour", "1 cup butter"]);
    expect(recipe?.image).toBe("https://example.com/pie.jpg");
    const html = jsonLdAsHtml(recipe!);
    expect(hasRecipeJsonLd(html)).toBe(true);
  });
});

describe("per-source feed lookup", () => {
  test("The Kitchn maps to main.rss", () => {
    expect(feedUrlForPage("https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745"))
      .toBe("https://www.thekitchn.com/main.rss");
    expect(sourceLabelForUrl("https://www.thekitchn.com/foo")).toBe("The Kitchn");
  });
  test("unknown hosts have no feed strategy", () => {
    expect(feedUrlForPage("https://example.com/recipe")).toBeUndefined();
  });
});

describe("isAbortError", () => {
  test("recognizes AbortError / timeout wording", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(isAbortError(abort)).toBe(true);
    const timeout = new Error("signal timed out");
    expect(isAbortError(timeout)).toBe(true);
    expect(isAbortError(new Error("no recipe data"))).toBe(false);
  });
});

describe("decodeXmlEntities", () => {
  test("unwraps CDATA and common entities", () => {
    expect(decodeXmlEntities("<![CDATA[1 < 2 &amp; 3]]>")).toBe("1 < 2 & 3");
  });
});

describe("resolveRecipeSource", () => {
  test("Kitchn page 403 + teaser-only RSS → source_blocked (no invented recipe)", async () => {
    const { resolveRecipeSource } = await import("../functions/lib/recipe-fetch");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("main.rss")) {
        return new Response(KITCHN_RSS, { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
      return new Response(KITCHN_403, { status: 403, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    try {
      const resolved = await resolveRecipeSource(
        "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
      );
      expect(resolved.fromFeed).toBe(false);
      expect(resolved.failFastCode).toBe("source_blocked");
      expect(resolved.page.status).toBe(403);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("blocked page + feed item with Recipe JSON-LD uses the feed and does not fail fast", async () => {
    const { resolveRecipeSource } = await import("../functions/lib/recipe-fetch");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("smittenkitchen.com/feed")) {
        return new Response(KITCHN_RSS, { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
      return new Response(KITCHN_403, { status: 403, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    try {
      const resolved = await resolveRecipeSource("https://smittenkitchen.com/full-recipe-in-feed/");
      expect(resolved.fromFeed).toBe(true);
      expect(resolved.failFastCode).toBeNull();
      expect(resolved.html).toContain("Full Recipe In Feed");
      expect(resolved.html).toContain("recipeIngredient");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fetchRecipePage", () => {
  test("records a Kitchn-style 403 challenge in well under the 8s budget", async () => {
    const { fetchRecipePage } = await import("../functions/lib/recipe-fetch");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(KITCHN_403, { status: 403, headers: { "content-type": "text/html" } })
    ) as typeof fetch;
    try {
      const result = await fetchRecipePage(
        "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
      );
      expect(result.status).toBe(403);
      expect(result.timedOut).toBe(false);
      expect(result.challenge).toBe(true);
      expect(result.ms).toBeLessThan(RECIPE_FETCH_TIMEOUT_MS);
      expect(hasRecipeJsonLd(result.html ?? "")).toBe(false);
      expect(classifyPageFetch(result)).toBe("source_blocked");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("classifies an aborted fetch as source_timeout", async () => {
    const { fetchRecipePage } = await import("../functions/lib/recipe-fetch");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }) as typeof fetch;
    try {
      const result = await fetchRecipePage("https://www.thekitchn.com/slow");
      expect(result.timedOut).toBe(true);
      expect(result.html).toBeNull();
      expect(classifyPageFetch(result)).toBe("source_timeout");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
