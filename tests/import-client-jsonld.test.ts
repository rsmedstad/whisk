import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clientJsonLdImportResult } from "../functions/lib/recipe-jsonld";
import { extractRecipeJsonLd } from "../functions/lib/recipe-fetch";

const kitchnGraph = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/kitchn-like-graph.json"), "utf8"),
) as unknown;

/** Mirrors POST /api/import/url when `jsonLd` is present: validate, wrap, skip fetch. */
function handleImportUrlBody(body: { url?: string; jsonLd?: unknown }): {
  status: number;
  skippedFetch: boolean;
  skippedOverlay: boolean;
  body: Record<string, unknown>;
} {
  if (!body.url) return { status: 400, skippedFetch: true, skippedOverlay: true, body: { error: "URL required" } };
  if (body.jsonLd != null) {
    const result = clientJsonLdImportResult(body.jsonLd, body.url);
    return {
      status: result.status,
      skippedFetch: true,
      skippedOverlay: true,
      body: result.status === 200
        ? { title: result.recipe?.name, html: result.html, usedClientJsonLd: true }
        : (result.body as Record<string, unknown>),
    };
  }
  return { status: 422, skippedFetch: false, skippedOverlay: false, body: { code: "source_blocked" } };
}

describe("POST /api/import/url client JSON-LD branch", () => {
  test("accepts client JSON-LD and skips the page fetch + overlay refetch", () => {
    const res = handleImportUrlBody({
      url: "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
      jsonLd: kitchnGraph,
    });
    expect(res.status).toBe(200);
    expect(res.skippedFetch).toBe(true);
    expect(res.skippedOverlay).toBe(true);
    expect(res.body.title).toBe("Greek Meatballs (Keftedes)");
    expect(extractRecipeJsonLd(String(res.body.html))?.name).toBe("Greek Meatballs (Keftedes)");
  });

  test("without jsonLd, Kitchn still fail-fasts (no client bypass)", () => {
    const res = handleImportUrlBody({
      url: "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
    });
    expect(res.status).toBe(422);
    expect(res.skippedFetch).toBe(false);
    expect(res.body.code).toBe("source_blocked");
  });

  test("rejects a mismatched source URL", () => {
    const res = handleImportUrlBody({
      url: "https://allrecipes.com/not-this",
      jsonLd: kitchnGraph,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("jsonld_url_mismatch");
  });

  test("requires a URL even when jsonLd is present", () => {
    const res = handleImportUrlBody({ jsonLd: kitchnGraph });
    expect(res.status).toBe(400);
  });
});
