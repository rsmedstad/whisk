import { describe, expect, test } from "bun:test";
import { cleanRecipeText, parseTextRecipeResponse, MAX_RECIPE_TEXT_CHARS } from "../functions/lib/recipe-text";
import { blockedSheetPasteCopy } from "../src/lib/pending-import";

describe("parseTextRecipeResponse", () => {
  const good = JSON.stringify({
    title: "Chicken Normandy",
    ingredients: ["2 tablespoons butter", "1 cup apple cider", "4 chicken thighs"],
    steps: ["Brown the chicken in butter.", { text: "Add cider and simmer 20 minutes." }],
    servings: 4,
    cookTime: 35,
  });

  test("valid response becomes a recipe", () => {
    const r = parseTextRecipeResponse(good)!;
    expect(r.title).toBe("Chicken Normandy");
    expect(r.ingredients.length).toBe(3);
    expect(r.steps.length).toBe(2);
    expect(r.servings).toBe(4);
    expect(r.cookTime).toBe(35);
  });

  test("tolerates prose around the JSON", () => {
    expect(parseTextRecipeResponse(`Here you go:\n${good}`)?.title).toBe("Chicken Normandy");
  });

  test("rejects empty / partial / invalid output", () => {
    expect(parseTextRecipeResponse('{"title":"","ingredients":[],"steps":[]}')).toBeNull();
    expect(parseTextRecipeResponse('{"title":"X","ingredients":["a pinch salt"],"steps":["Cook it well."]}')).toBeNull();
    expect(parseTextRecipeResponse("not json")).toBeNull();
  });
});

describe("cleanRecipeText", () => {
  test("strips control chars and caps length", () => {
    expect(cleanRecipeText("a\x00b\nc")).toBe("ab\nc");
    expect(cleanRecipeText("x".repeat(MAX_RECIPE_TEXT_CHARS + 500)).length).toBe(MAX_RECIPE_TEXT_CHARS);
  });
});

test("blocked sheet paste copy mentions pasting", () => {
  expect(blockedSheetPasteCopy()).toContain("paste");
});
