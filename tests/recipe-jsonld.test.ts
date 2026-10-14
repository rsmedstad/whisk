import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLIENT_JSONLD_MAX_BYTES,
  clientJsonLdImportResult,
  findRecipeObject,
  hostKey,
  jsonLdDeclaredUrls,
  sourceUrlMatchesJsonLd,
  stripHtml,
  validateClientJsonLd,
} from "../functions/lib/recipe-jsonld";
import { extractRecipeJsonLd, jsonLdAsHtml } from "../functions/lib/recipe-fetch";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const kitchnGraph = JSON.parse(
  readFileSync(join(fixtureDir, "fixtures/kitchn-like-graph.json"), "utf8"),
) as unknown;

const KITCNN_URL = "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745";

describe("findRecipeObject", () => {
  test("finds Recipe inside a Kitchn-like @graph", () => {
    const recipe = findRecipeObject(kitchnGraph);
    expect(recipe?.name).toBe("Greek Meatballs (Keftedes)");
    expect(Array.isArray(recipe?.recipeIngredient)).toBe(true);
  });

  test("finds Recipe in a top-level array", () => {
    const recipe = findRecipeObject([
      { "@type": "Organization", name: "Example" },
      { "@type": "Recipe", name: "Array Soup", recipeIngredient: ["water"] },
    ]);
    expect(recipe?.name).toBe("Array Soup");
  });

  test("finds Recipe via mainEntity", () => {
    const recipe = findRecipeObject({
      "@type": "WebPage",
      mainEntity: { "@type": "Recipe", name: "Nested", recipeIngredient: ["salt"] },
    });
    expect(recipe?.name).toBe("Nested");
  });

  test("accepts schema.org/Recipe @type", () => {
    const recipe = findRecipeObject({
      "@type": "https://schema.org/Recipe",
      name: "IRI",
      recipeIngredient: ["flour"],
    });
    expect(recipe?.name).toBe("IRI");
  });

  test("accepts @type array including Recipe", () => {
    const recipe = findRecipeObject({
      "@type": ["Article", "Recipe"],
      name: "Both",
      recipeIngredient: ["egg"],
    });
    expect(recipe?.name).toBe("Both");
  });

  test("returns null when no Recipe exists", () => {
    expect(findRecipeObject({ "@type": "WebPage", name: "Index" })).toBeNull();
  });
});

describe("source URL matching", () => {
  test("www-insensitive host match", () => {
    expect(hostKey("https://www.thekitchn.com/foo")).toBe("thekitchn.com");
    expect(hostKey("https://thekitchn.com/foo")).toBe("thekitchn.com");
  });

  test("reads url and mainEntityOfPage from the Kitchn-like Recipe", () => {
    const recipe = findRecipeObject(kitchnGraph);
    expect(recipe).toBeTruthy();
    const urls = jsonLdDeclaredUrls(recipe!);
    expect(urls.some((u) => u.includes("thekitchn.com"))).toBe(true);
  });

  test("allows a source URL that matches the JSON-LD host", () => {
    const recipe = findRecipeObject(kitchnGraph)!;
    expect(sourceUrlMatchesJsonLd(KITCNN_URL, recipe)).toBe(true);
    expect(sourceUrlMatchesJsonLd("https://thekitchn.com/other-slug", recipe)).toBe(true);
  });

  test("rejects a mismatched host when JSON-LD declares a url", () => {
    const recipe = findRecipeObject(kitchnGraph)!;
    expect(sourceUrlMatchesJsonLd("https://www.allrecipes.com/recipe/123", recipe)).toBe(false);
  });

  test("allows any source URL when JSON-LD has no url fields", () => {
    expect(
      sourceUrlMatchesJsonLd("https://example.com/x", {
        "@type": "Recipe",
        name: "Plain",
        recipeIngredient: ["a"],
      }),
    ).toBe(true);
  });
});

describe("sanitization", () => {
  test("strips script and HTML tags", () => {
    expect(stripHtml('<script>alert(1)</script>Hello <b>world</b>')).toBe("Hello world");
  });

  test("drops prototype keys and HTML in name", () => {
    const result = validateClientJsonLd(
      {
        "@type": "Recipe",
        name: "<b>Safe Soup</b>",
        recipeIngredient: ["<i>1 onion</i>"],
        recipeInstructions: ["<script>steal()</script>Simmer."],
        __proto__: { polluted: true },
        constructor: { name: "nope" },
      },
      "https://example.com/soup",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.name).toBe("Safe Soup");
    expect(JSON.stringify(result.recipe)).not.toContain("polluted");
    expect(JSON.stringify(result.recipe.recipeInstructions)).not.toContain("<script>");
    expect(JSON.stringify(result.recipe.recipeIngredient)).toContain("1 onion");
  });

  test("drops javascript: and data: images", () => {
    const result = validateClientJsonLd(
      {
        "@type": "Recipe",
        name: "Img",
        recipeIngredient: ["salt"],
        image: ["javascript:alert(1)", "data:image/gif;base64,xxxx", "https://cdn.example.com/ok.jpg"],
      },
      "https://example.com/img",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.image).toEqual(["https://cdn.example.com/ok.jpg"]);
  });
});

describe("validateClientJsonLd / endpoint contract", () => {
  test("accepts the Kitchn-like @graph and wraps HTML the existing parser can read", () => {
    const result = clientJsonLdImportResult(kitchnGraph, KITCNN_URL);
    expect(result.status).toBe(200);
    expect(result.recipe?.name).toBe("Greek Meatballs (Keftedes)");
    expect(result.html).toContain("application/ld+json");
    const extracted = extractRecipeJsonLd(result.html ?? "");
    expect(extracted?.name).toBe("Greek Meatballs (Keftedes)");
    expect((extracted?.recipeIngredient as unknown[])?.length).toBe(5);
  });

  test("jsonLdAsHtml of a sanitized Recipe is parseable", () => {
    const validated = validateClientJsonLd(kitchnGraph, KITCNN_URL);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const html = jsonLdAsHtml(validated.recipe);
    expect(extractRecipeJsonLd(html)?.name).toBe("Greek Meatballs (Keftedes)");
  });

  test("rejects a payload with no Recipe", () => {
    const result = clientJsonLdImportResult({ "@type": "WebPage" }, "https://example.com/x");
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("jsonld_not_recipe");
  });

  test("rejects a Recipe without ingredients", () => {
    const result = clientJsonLdImportResult(
      { "@type": "Recipe", name: "Empty" },
      "https://example.com/x",
    );
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("jsonld_invalid");
  });

  test("rejects a host mismatch", () => {
    const result = clientJsonLdImportResult(kitchnGraph, "https://evil.example/phish");
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("jsonld_url_mismatch");
  });

  test("rejects oversized JSON-LD", () => {
    const huge = {
      "@type": "Recipe",
      name: "Huge",
      recipeIngredient: ["a"],
      description: "x".repeat(CLIENT_JSONLD_MAX_BYTES),
    };
    const result = clientJsonLdImportResult(huge, "https://example.com/huge");
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("jsonld_too_large");
  });
});
