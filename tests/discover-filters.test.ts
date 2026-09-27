import { describe, expect, test } from "bun:test";
import {
  classifyRecipe,
  isCollectionTitle,
  isNonRecipeFeedCategories,
  isNonRecipeFeedTitle,
  isNonRecipeUrl,
} from "../functions/lib/discover-filters";

// Titles/URLs/categories below are real samples from The Kitchn's main.rss
// (the source of the mug-warmer regression) plus a few synthetic edge cases.

describe("isNonRecipeFeedTitle — shopping/product/editorial rejects", () => {
  const rejects = [
    "The Best Coffee Mug Warmer for 2026", // the repro item (best … for <year> + gear noun)
    "The Best Stand Mixers of 2025",
    "Pastry Chefs Agree: These Are the 3 Best Cakes You Can Order Online",
    "The 34 Best Kitchen Deals to Shop This Week from Ninja, HelloFresh, and More",
    "My Honest Review of the Instant Pot MagicFroth 9-in-1 Milk Frother",
    "This Famous Air Fryer Doubles as Food Storage and It’s on Sale for Its Lowest Price Ever!",
    "We Tried 10 Instant Noodle Brands — And a Momofuku Fan-Favorite Came Out on Top",
    "Chefs Agree: This Is the Absolute Best Bacon You Can Buy",
    "Our Favorite Kitchen Gadgets Under $50",
    "The Best Milk Frothers",
    "The Ultimate Holiday Gift Guide for Home Cooks",
    "22 Must-Make Summer Desserts",
  ];
  for (const title of rejects) {
    test(`rejects: ${title}`, () => {
      expect(isNonRecipeFeedTitle(title)).toBe(true);
    });
  }

  const keeps = [
    "Apple Slab Pie",
    "The Most Delicious Beef Stew of All Time",
    "Loaded Chicken Gyro Fries",
    "Easy Shepherd's Pie",
    "Bacon and White Bean Melting Cabbage",
    "These Easy French Toast Sticks Are Better Than the Frozen Ones I Grew Up On",
    "Easy Soft Pretzels",
    "The Best Banana Bread", // "best" + dish (not gear) must survive
    "Best-Ever Blender Salsa",
  ];
  for (const title of keeps) {
    test(`keeps: ${title}`, () => {
      expect(isNonRecipeFeedTitle(title)).toBe(false);
    });
  }
});

describe("isNonRecipeUrl — shopping/roundup slugs", () => {
  test("rejects the Kitchn mug-warmer product URL", () => {
    expect(isNonRecipeUrl("https://www.thekitchn.com/best-coffee-mug-warmer-23845669")).toBe(true);
  });
  test("rejects deals and gift-guide slugs", () => {
    expect(isNonRecipeUrl("https://www.thekitchn.com/best-home-kitchen-lifestyle-deals-of-the-week-23760740")).toBe(true);
    expect(isNonRecipeUrl("https://example.com/holiday-gift-guide-2026")).toBe(true);
    expect(isNonRecipeUrl("https://example.com/shopping/le-creuset-sale")).toBe(true);
  });
  test("still rejects collection/editorial hubs (pre-existing behavior)", () => {
    expect(isNonRecipeUrl("https://www.bbcgoodfood.com/recipes/collection/cherry-recipes")).toBe(true);
    expect(isNonRecipeUrl("https://example.com/reviews/best-dutch-oven")).toBe(true);
  });
  test("keeps real recipe URLs, including best-<dish>-recipe slugs", () => {
    expect(isNonRecipeUrl("https://www.thekitchn.com/apple-slab-pie-recipe-23846024")).toBe(false);
    expect(isNonRecipeUrl("https://www.thekitchn.com/beef-stew-recipe-23846522")).toBe(false);
    expect(isNonRecipeUrl("https://www.thekitchn.com/french-toast-sticks-recipe-review-23846565")).toBe(false);
    expect(isNonRecipeUrl("https://example.com/best-banana-bread-recipe")).toBe(false);
    expect(isNonRecipeUrl("https://example.com/best-blender-salsa-recipe")).toBe(false);
  });
});

describe("isNonRecipeFeedCategories — RSS <category> gate", () => {
  test("rejects the mug warmer via its shopping categories", () => {
    expect(isNonRecipeFeedCategories(
      ["Tools", "news", "product module", "product review", "product text link", "seo september 2026", "shopping"]
    )).toBe(true);
  });
  test("rejects news/skills tips posts without a recipe category", () => {
    expect(isNonRecipeFeedCategories(["Skills", "chef", "cooking tips", "experts", "news"])).toBe(true);
    expect(isNonRecipeFeedCategories(["Groceries", "news"])).toBe(true);
  });
  test("keeps recipes vouched for by a Recipes category, even with a news tag", () => {
    expect(isNonRecipeFeedCategories(["Recipes", "dinner", "ground beef", "i tried it", "news", "short-lead"])).toBe(false);
    expect(isNonRecipeFeedCategories(["Recipes", "breakfast", "kitchn love letters", "news", "recipe review"])).toBe(false);
  });
  test("leaves plain food-tag feeds (WordPress blogs) and empty categories alone", () => {
    expect(isNonRecipeFeedCategories(["bread", "fall", "baking"])).toBe(false);
    expect(isNonRecipeFeedCategories([])).toBe(false);
  });
});

describe("isCollectionTitle", () => {
  test("still catches roundup hubs", () => {
    expect(isCollectionTitle("Sheet Pan Chicken Dinners")).toBe(true);
    expect(isCollectionTitle("Cherry recipes")).toBe(true);
    expect(isCollectionTitle("Easy Soft Pretzels")).toBe(false);
  });
});

describe("classifyRecipe — meal categories", () => {
  test("soft pretzels classify as baking, not dinner", () => {
    expect(classifyRecipe("Easy Soft Pretzels")).toBe("baking");
    expect(classifyRecipe("Soft Pretzel Bites")).toBe("baking");
    expect(classifyRecipe("Buttery Soft Pretzels", "Chewy homemade pretzels with coarse salt")).toBe("baking");
  });
  test("plural baked goods classify as baking", () => {
    expect(classifyRecipe("Flaky Croissants")).toBe("baking");
    expect(classifyRecipe("Homemade Flatbreads")).toBe("baking");
    expect(classifyRecipe("No-Knead Crusty Breads")).toBe("baking");
  });
  test("snack keywords land in snack, not dinner", () => {
    expect(classifyRecipe("Chewy Granola Bars")).toBe("snack");
    expect(classifyRecipe("Peanut Butter Energy Bites")).toBe("snack");
    expect(classifyRecipe("Sweet and Salty Chex Mix")).toBe("snack");
  });
  test("granola bars don't get stolen by the breakfast granola keyword", () => {
    expect(classifyRecipe("Honey Granola Bars")).toBe("snack");
    expect(classifyRecipe("Maple Pecan Granola")).toBe("breakfast");
  });
  test("mains still classify as dinner", () => {
    expect(classifyRecipe("Garlic Butter Chicken Thighs")).toBe("dinner");
    expect(classifyRecipe("Easy Shepherd's Pie")).toBe("dinner"); // savory pie, not dessert
  });
  test("AI meal tags are preferred over the dinner default for ambiguous titles", () => {
    expect(classifyRecipe("Grandma's Secret Knots", undefined, ["baking", "italian"])).toBe("baking");
    expect(classifyRecipe("Game Day Party Mix-Up", undefined, ["snack"])).toBe("snack");
    // No keywords, no tags — falls back to dinner bucket
    expect(classifyRecipe("Grandma's Mystery Dish")).toBe("dinner");
  });
});
