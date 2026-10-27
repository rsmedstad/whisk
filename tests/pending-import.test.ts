import { describe, expect, test } from "bun:test";
import {
  BLOCKED_SHEET_FIXTURE,
  blockedSheetFrameLimitCopy,
  blockedSheetNextStepCopy,
  clearPendingImport,
  getPendingImport,
  isBlockedDiscoverSource,
  pendingImportFromUrl,
  preferSameTabOpen,
  setPendingImport,
  sourceLabelFromPending,
  titleFromRecipeUrl,
} from "../src/lib/pending-import";
import { findRecipeIdBySourceUrl, normalizeSourceUrl, sourceUrlsMatch } from "../src/lib/source-url";
import { findRecipeIdBySourceUrl as findRecipeIdBySourceUrlServer } from "../functions/lib/source-url";

describe("blocked Discover sources", () => {
  test("treats Kitchn source ids and hosts as blocked", () => {
    expect(isBlockedDiscoverSource("thekitchn")).toBe(true);
    expect(isBlockedDiscoverSource("kitchn")).toBe(true);
    expect(isBlockedDiscoverSource(undefined, "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745")).toBe(true);
    expect(isBlockedDiscoverSource("nyt", "https://cooking.nytimes.com/recipes/1")).toBe(false);
  });

  test("honest sheet copy names the source and X-Frame-Options", () => {
    const copy = blockedSheetFrameLimitCopy("The Kitchn");
    expect(copy).toContain("The Kitchn");
    expect(copy).toContain("X-Frame-Options");
    expect(copy).toContain("framing");
  });

  test("next-step copy is bookmark/Shortcut on iOS/desktop and Share on Android", () => {
    expect(blockedSheetNextStepCopy("The Kitchn", "ios")).toContain("tap Save to Whisk");
    expect(blockedSheetNextStepCopy("The Kitchn", "desktop")).toContain("bookmark, or Shortcut");
    expect(blockedSheetNextStepCopy("The Kitchn", "android")).toBe("Open on The Kitchn → then Share → Whisk.");
  });

  test("mobile prefers the same tab so Back returns to Whisk", () => {
    expect(preferSameTabOpen("ios")).toBe(true);
    expect(preferSameTabOpen("android")).toBe(true);
    expect(preferSameTabOpen("desktop")).toBe(false);
  });

  test("source label falls back to The Kitchn", () => {
    expect(sourceLabelFromPending(BLOCKED_SHEET_FIXTURE)).toBe("The Kitchn");
  });
});

describe("pending import localStorage", () => {
  test("round-trips and clears by matching URL", () => {
    const mem = new Map<string, string>();
    const store = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => { mem.set(key, value); },
      removeItem: (key: string) => { mem.delete(key); },
    };
    setPendingImport({
      url: "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
      title: "Greek Meatballs (Keftedes)",
      timestamp: 1,
    }, store);
    expect(getPendingImport(store)?.title).toBe("Greek Meatballs (Keftedes)");
    clearPendingImport("https://thekitchn.com/other", store);
    expect(getPendingImport(store)?.title).toBe("Greek Meatballs (Keftedes)");
    clearPendingImport("https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745/", store);
    expect(getPendingImport(store)).toBeNull();
  });
});

describe("source URL idempotency", () => {
  const kitchn = "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745";

  test("normalizes www, trailing slash, http, and query", () => {
    expect(sourceUrlsMatch(kitchn, "http://thekitchn.com/greek-meatballs-keftedes-recipe-23847745/")).toBe(true);
    expect(sourceUrlsMatch(kitchn, `${kitchn}?utm_source=x`)).toBe(true);
    expect(sourceUrlsMatch(kitchn, "https://www.thekitchn.com/other-recipe")).toBe(false);
    expect(normalizeSourceUrl(kitchn)).toBe("https://thekitchn.com/greek-meatballs-keftedes-recipe-23847745");
  });

  test("finds an existing recipe by source URL", () => {
    const recipes = [
      { id: "r_keep", sourceUrl: "https://cooking.nytimes.com/recipes/1" },
      { id: "r_keftedes", sourceUrl: kitchn },
    ];
    expect(findRecipeIdBySourceUrl(recipes, "http://thekitchn.com/greek-meatballs-keftedes-recipe-23847745/")).toBe("r_keftedes");
    expect(findRecipeIdBySourceUrlServer(recipes, "https://thekitchn.com/greek-meatballs-keftedes-recipe-23847745")).toBe("r_keftedes");
    expect(findRecipeIdBySourceUrl(recipes, "https://example.com/nope")).toBeUndefined();
  });
});

describe("Add-from-URL blocked sheet content", () => {
  test("derives a readable title from the recipe slug and drops trailing ids", () => {
    expect(titleFromRecipeUrl("https://www.thekitchn.com/easy-sheet-pan-chicken-fajitas-recipe-23153617")).toBe(
      "Easy Sheet Pan Chicken Fajitas Recipe",
    );
    expect(titleFromRecipeUrl("https://example.com/recipes/chicken-shawarma/")).toBe("Chicken Shawarma");
  });

  test("falls back to the host when the slug has no readable words", () => {
    expect(titleFromRecipeUrl("https://www.thekitchn.com/")).toBe("thekitchn.com");
    expect(titleFromRecipeUrl("https://example.com/r/12345678")).toBe("example.com");
    expect(titleFromRecipeUrl("not a url")).toBe("not a url");
  });

  test("builds sheet content with the server-provided source label", () => {
    const item = pendingImportFromUrl("https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745", "The Kitchn", 42);
    expect(item.url).toBe("https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745");
    expect(item.title).toBe("Greek Meatballs Keftedes Recipe");
    expect(item.timestamp).toBe(42);
    expect(sourceLabelFromPending(item)).toBe("The Kitchn");
  });

  test("omits the label when the server did not send one", () => {
    const item = pendingImportFromUrl("https://example.com/best-pancakes", undefined, 1);
    expect("sourceLabel" in item).toBe(false);
    expect(sourceLabelFromPending(item)).toBe("the original site");
  });
});
