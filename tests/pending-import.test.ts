import { describe, expect, test } from "bun:test";
import {
  BLOCKED_SHEET_FIXTURE,
  blockedSheetFrameLimitCopy,
  blockedSheetNextStepCopy,
  clearPendingImport,
  getPendingImport,
  isBlockedDiscoverSource,
  preferSameTabOpen,
  setPendingImport,
  sourceLabelFromPending,
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
