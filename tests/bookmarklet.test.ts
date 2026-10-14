import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOOKMARKLET_HASH_MAX,
  buildBookmarkletHref,
  decodeImportLdHash,
  decodeImportLdHashAsync,
  encodeImportLdHash,
  encodeImportLdHashGzip,
  extractLdScriptsFromHtml,
  extractRecipeFromLdScripts,
  firstHttpUrl,
  slimRecipeJsonLd,
} from "../src/lib/bookmarklet";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const kitchnGraph = readFileSync(join(fixtureDir, "fixtures/kitchn-like-graph.json"), "utf8");

const kitchnHtml = `<!DOCTYPE html><html><head>
<script type="application/json">{"not":"ld"}</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Kitchn"}
</script>
<script type="application/ld+json">
${kitchnGraph}
</script>
</head><body><h1>Greek Meatballs</h1></body></html>`;

describe("bookmarklet JSON-LD extraction", () => {
  test("reads every ld+json script and picks the Recipe out of a Kitchn-like @graph", () => {
    const scripts = extractLdScriptsFromHtml(kitchnHtml);
    expect(scripts.length).toBe(2);
    const recipe = extractRecipeFromLdScripts(scripts);
    expect(recipe?.name).toBe("Greek Meatballs (Keftedes)");
    const slim = slimRecipeJsonLd(recipe!);
    expect(slim["@type"]).toBe("Recipe");
    expect(slim.recipeIngredient).toEqual(recipe!.recipeIngredient);
    expect(slim.publisher).toBeUndefined();
  });

  test("handles a single Recipe node and an array payload", () => {
    const html = `
      <script type="application/ld+json">
      [{"@type":"WebPage","name":"x"},{"@type":"Recipe","name":"Array Cake","recipeIngredient":["flour"]}]
      </script>`;
    const recipe = extractRecipeFromLdScripts(extractLdScriptsFromHtml(html));
    expect(recipe?.name).toBe("Array Cake");
  });

  test("returns null when no Recipe is present", () => {
    const html = `<script type="application/ld+json">{"@type":"WebPage"}</script>`;
    expect(extractRecipeFromLdScripts(extractLdScriptsFromHtml(html))).toBeNull();
  });
});

describe("bookmarklet transport helpers", () => {
  test("round-trips a hash payload", () => {
    const jsonLd = extractRecipeFromLdScripts(extractLdScriptsFromHtml(kitchnHtml));
    const encoded = encodeImportLdHash({
      url: "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
      jsonLd,
    });
    expect(encoded.length).toBeLessThan(BOOKMARKLET_HASH_MAX);
    const decoded = decodeImportLdHash(`#ld=${encoded}`);
    expect(decoded?.url).toContain("thekitchn.com");
    expect((decoded?.jsonLd as { name?: string })?.name).toBe("Greek Meatballs (Keftedes)");
  });

  test("round-trips a gzip #ldz= hash (COOP-safe path)", async () => {
    const jsonLd = extractRecipeFromLdScripts(extractLdScriptsFromHtml(kitchnHtml));
    const encoded = await encodeImportLdHashGzip({
      url: "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
      jsonLd,
    });
    expect(encoded.length).toBeLessThan(BOOKMARKLET_HASH_MAX);
    const decoded = await decodeImportLdHashAsync(`#ldz=${encoded}`);
    expect(decoded?.url).toContain("thekitchn.com");
    expect((decoded?.jsonLd as { name?: string })?.name).toBe("Greek Meatballs (Keftedes)");
  });

  test("buildBookmarkletHref bakes the origin, gzip hash, and postMessage", () => {
    const href = buildBookmarkletHref("https://whisk-15t.pages.dev");
    expect(href.startsWith("javascript:")).toBe(true);
    expect(href).toContain("https://whisk-15t.pages.dev");
    expect(href).toContain("/import/ld");
    expect(href).toContain("postMessage");
    expect(href).toContain("application/ld+json");
    expect(href).toContain("whisk-import-ld");
    expect(href).toContain("ldz=");
    expect(href).toContain("CompressionStream");
  });
});

describe("share-target URL extraction", () => {
  test("reads a bare url", () => {
    expect(firstHttpUrl("https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745"))
      .toBe("https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745");
  });

  test("reads a URL embedded in Android share text", () => {
    expect(firstHttpUrl("Greek Meatballs https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745"))
      .toBe("https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745");
  });

  test("returns null when there is no URL", () => {
    expect(firstHttpUrl("just a title")).toBeNull();
  });
});
