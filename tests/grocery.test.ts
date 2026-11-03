import { describe, expect, test } from "bun:test";
import {
  buildRecipeItems,
  isStapleIngredient,
  combineAmounts,
  isPantryStaple,
  pluralizeForAmount,
  tidyRecipeItems,
  toBuyableItems,
  type IngredientInput,
} from "../src/lib/grocery";
import { categorizeIngredient } from "../src/lib/categories";

const label = (ing: IngredientInput) =>
  toBuyableItems(ing).map((b) => [b.amount, b.unit, b.name].filter(Boolean).join(" "));

describe("toBuyableItems", () => {
  test("produce measured in cups becomes a count", () => {
    expect(label({ amount: "½", unit: "cup", name: "onion, chopped" })).toEqual(["1 onion"]);
    expect(label({ amount: "1 ½", unit: "cups", name: "diced yellow onion" })).toEqual(["2 yellow onion"]);
    expect(label({ amount: "2", unit: "tablespoons", name: "fresh lemon juice" })).toEqual(["1 lemon"]);
    expect(label({ amount: "¼", unit: "cup", name: "lime juice" })).toEqual(["2 lime"]);
  });

  test("garlic cloves become heads", () => {
    expect(label({ amount: "6", name: "garlic cloves, minced" })).toEqual(["1 head garlic"]);
    expect(label({ amount: "12", unit: "cloves", name: "garlic" })).toEqual(["2 head garlic"]);
    expect(label({ amount: "1", unit: "tbsp", name: "minced garlic" })).toEqual(["1 head garlic"]);
  });

  test("stale split-letter data is repaired", () => {
    expect(label({ amount: "6", unit: "g", name: "Arlic cloves" })).toEqual(["1 head garlic"]);
    expect(label({ amount: "1", name: "or 2 sprigs parsley or cilantro, for garnish" })).toEqual(["1 bunch parsley"]);
    expect(label({ amount: "2", name: "-1/4 teaspoons fresh basil" })).toEqual(["1 bunch basil"]);
  });

  test("herbs and celery are bought by the bunch", () => {
    expect(label({ amount: "3", unit: "ribs", name: "celery, chopped" })).toEqual(["1 bunch celery"]);
    expect(label({ amount: "2", unit: "tbsp", name: "chopped fresh cilantro" })).toEqual(["1 bunch cilantro"]);
    expect(label({ amount: "4", name: "scallions, thinly sliced" })).toEqual(["1 bunch green onions"]);
  });

  test("packaged goods drop the recipe measure", () => {
    expect(label({ amount: "2", name: "large eggs" })).toEqual(["eggs"]);
    expect(label({ amount: "1", name: "Egg" })).toEqual(["eggs"]);
    expect(label({ amount: "¼", unit: "cup", name: "tahini" })).toEqual(["tahini"]);
    expect(label({ amount: "2", unit: "tbsp", name: "unsalted butter, softened" })).toEqual(["butter"]);
    expect(label({ amount: "4", unit: "cups", name: "low-sodium chicken broth" })).toEqual(["chicken broth"]);
    expect(label({ amount: "9", name: "lasagna noodles" })).toEqual(["lasagna noodles"]);
  });

  test("store units and counts are kept", () => {
    expect(label({ amount: "1 ½", unit: "lb", name: "boneless skinless chicken thighs" })).toEqual(["1 ½ lb boneless skinless chicken thighs"]);
    expect(label({ amount: "2", unit: "cans", name: "chickpeas (15-ounce)" })).toEqual(["2 cans chickpeas"]);
    expect(label({ amount: "8", name: "corn tortillas" })).toEqual(["8 corn tortillas"]);
    expect(label({ amount: "2", unit: "lb", name: "russet potatoes" })).toEqual(["2 lb potato"]);
  });

  test("unknown items measured in spoons keep just the name", () => {
    expect(label({ amount: "2", unit: "tbsp", name: "gochujang" })).toEqual(["gochujang"]);
  });

  test("water is never a grocery item", () => {
    expect(label({ amount: "1", name: "-3/4 cups water" })).toEqual([]);
    expect(label({ amount: "2", unit: "cups", name: "warm water" })).toEqual([]);
  });

  test("lines that name several items split; prep notes do not", () => {
    expect(label({ amount: "1", name: "carrot, and 1 yellow onion, diced" })).toEqual(["1 carrot", "1 yellow onion"]);
    expect(label({ name: "Chile crisp, lemon wedges, for serving" })).toEqual(["chile crisp", "1 lemon"]);
    expect(label({ amount: "2", unit: "lb", name: "chicken thighs, trimmed and cut into pieces" })).toEqual(["2 lb chicken thighs"]);
    expect(label({ amount: "1", unit: "cup", name: "half and half" })).toEqual(["half and half"]);
  });

  test("alternatives pick one item", () => {
    expect(label({ amount: "1 1/2", unit: "cups", name: "grape or cherry tomatoes, halved" })).toEqual(["cherry tomatoes"]);
    expect(label({ amount: "7", unit: "cups", name: "chicken or vegetable stock" })).toEqual(["chicken broth"]);
    expect(label({ amount: "2", unit: "tablespoons", name: "raisins or dried cranberries" })).toEqual(["raisins"]);
    expect(label({ amount: "1", unit: "pound", name: "fusilli or other short, curly pasta" })).toEqual(["1 pound fusilli"]);
    expect(label({ amount: "3", name: "packets rapid-rise, bread-machine or other instant yeast" })).toEqual(["3 packets instant yeast"]);
    expect(label({ amount: "2", unit: "cups", name: "full-fat or low-fat Greek yogurt (about 16 ounces)" })).toEqual(["greek yogurt"]);
  });

  test("notes in parentheses, dashes and 'for' tails are dropped", () => {
    expect(label({ amount: "1/2", unit: "teaspoon", name: "garlic powder (you can use fresh too, adjust amount to your taste)" })).toEqual(["garlic powder"]);
    expect(label({ amount: "¼", unit: "teaspoon", name: "of chilli flakes (red pepper flakes) - can use more if you prefer" })).toEqual(["chilli flakes"]);
    expect(label({ name: "Vegetable oil for bowl" })).toEqual(["vegetable oil"]);
    expect(label({ amount: "5", name: "to 5 1/2 cups all-purpose flour, plus more for dusting" })).toEqual(["all-purpose flour"]);
  });

  test("lemon pepper and ground ginger are not fresh produce", () => {
    expect(label({ amount: "1", unit: "tsp", name: "lemon pepper" })).toEqual(["lemon pepper"]);
    expect(label({ amount: "1", unit: "tsp", name: "ground ginger" })).toEqual(["ground ginger"]);
  });
});

describe("buildRecipeItems", () => {
  test("merges the same item within a recipe", () => {
    const items = buildRecipeItems([
      { amount: "1", name: "onion, diced" },
      { amount: "½", unit: "cup", name: "onion, sliced" },
      { amount: "3", unit: "cloves", name: "garlic" },
      { amount: "2", unit: "cloves", name: "garlic, grated" },
      { amount: "1", unit: "tbsp", name: "butter" },
      { amount: "2", name: "eggs" },
    ]);
    expect(items).toEqual([
      { name: "onion", amount: "2" },
      { name: "garlic", amount: "1", unit: "head" },
      { name: "butter" },
      { name: "eggs" },
    ]);
  });
});

describe("combineAmounts", () => {
  test("sums counts, takes the max for heads and bunches", () => {
    expect(combineAmounts(["1", "2"], undefined)).toBe("3");
    expect(combineAmounts(["1", "1"], "head")).toBe("1");
    expect(combineAmounts(["1", "2"], "bunch")).toBe("2");
    expect(combineAmounts(["1 ½", "½"], "lb")).toBe("2");
    expect(combineAmounts([undefined, undefined], undefined)).toBeUndefined();
    expect(combineAmounts(["1", "a few"], undefined)).toBeNull();
  });
});

describe("pluralizeForAmount", () => {
  test("pluralizes the unit or the counted name", () => {
    expect(pluralizeForAmount("3", undefined, "onion")).toEqual({ unit: undefined, name: "onions" });
    expect(pluralizeForAmount("2", undefined, "tomato")).toEqual({ unit: undefined, name: "tomatoes" });
    expect(pluralizeForAmount("2", "head", "garlic")).toEqual({ unit: "heads", name: "garlic" });
    expect(pluralizeForAmount("2", "bunch", "parsley")).toEqual({ unit: "bunches", name: "parsley" });
    expect(pluralizeForAmount("1", undefined, "lemon")).toEqual({ unit: undefined, name: "lemon" });
    expect(pluralizeForAmount("8", undefined, "corn tortillas")).toEqual({ unit: undefined, name: "corn tortillas" });
  });
});

describe("tidyRecipeItems", () => {
  let n = 0;
  const makeId = () => `new-${++n}`;

  test("rewrites old recipe items and leaves manual ones alone", () => {
    const { items, changed } = tidyRecipeItems(
      [
        { id: "a", name: "Arlic cloves", amount: "6", unit: "g", addedBy: "recipe", sourceRecipeId: "r1", checked: false },
        { id: "b", name: "onion, chopped", amount: "½", unit: "cup", addedBy: "recipe", sourceRecipeId: "r1", checked: false },
        { id: "c", name: "Chile crisp, lemon wedges, for serving", addedBy: "recipe", sourceRecipeId: "r2", checked: false },
        { id: "d", name: "1/2 cup onion", addedBy: "manual", checked: false },
        { id: "e", name: "water", amount: "2", unit: "cups", addedBy: "recipe", sourceRecipeId: "r1", checked: false },
      ],
      makeId,
    );
    expect(changed).toBe(true);
    expect(items.map((i) => [i.id, i.amount, i.unit, i.name, i.sourceRecipeId])).toEqual([
      ["a", "1", "head", "garlic", "r1"],
      ["b", "1", undefined, "onion", "r1"],
      ["c", undefined, undefined, "chile crisp", "r2"],
      ["new-1", "1", undefined, "lemon", "r2"],
      ["d", undefined, undefined, "1/2 cup onion", undefined],
    ]);
  });

  test("is a no-op on items already in buyable form", () => {
    const input = [
      { id: "a", name: "garlic", amount: "1", unit: "head", addedBy: "recipe", sourceRecipeId: "r1", checked: false },
      { id: "b", name: "eggs", addedBy: "recipe", sourceRecipeId: "r1", checked: false },
      { id: "c", name: "boneless skinless chicken thighs", amount: "1 ½", unit: "lb", addedBy: "recipe", sourceRecipeId: "r1", checked: false },
    ];
    const { items, changed } = tidyRecipeItems(input, makeId);
    expect(changed).toBe(false);
    expect(items).toEqual(input);
  });
});

describe("isPantryStaple", () => {
  test("staples", () => {
    for (const s of ["kosher salt", "salt and freshly ground black pepper", "olive oil, divided", "extra-virgin olive oil", "water", "all-purpose flour", "1/4 tsp red pepper flakes"]) {
      expect(isPantryStaple(s)).toBe(true);
    }
  });
  test("stored ingredients are re-parsed before the check", () => {
    expect(isStapleIngredient({ amount: "5", name: "to 5 1/2 cups all-purpose flour, plus more for dusting" })).toBe(true);
    expect(isStapleIngredient({ amount: "1", unit: "cup", name: "plus 1 tablespoon sugar" })).toBe(true);
    expect(isStapleIngredient({ amount: "1/2", unit: "teaspoon", name: "garlic powder (you can use fresh too)" })).toBe(true);
    expect(isStapleIngredient({ amount: "2", unit: "tbsp", name: "chopped fresh basil" })).toBe(false);
  });
  test("not staples", () => {
    for (const s of ["fresh basil", "fresh oregano", "salted butter", "onion", "chicken broth", "sparkling water"]) {
      expect(isPantryStaple(s)).toBe(false);
    }
  });
});

describe("categorizeIngredient aisles", () => {
  test("celery is produce even when measured in ribs", () => {
    expect(categorizeIngredient("Ribs celery")).toBe("produce");
    expect(categorizeIngredient("3 ribs celery, chopped")).toBe("produce");
    expect(categorizeIngredient("celery stalks")).toBe("produce");
  });
  test("broth and stock are pantry", () => {
    expect(categorizeIngredient("chicken broth")).toBe("pantry");
    expect(categorizeIngredient("4 cups low-sodium chicken broth")).toBe("pantry");
    expect(categorizeIngredient("beef stock")).toBe("pantry");
  });
  test("meat stays meat", () => {
    expect(categorizeIngredient("pork ribs")).toBe("meat");
    expect(categorizeIngredient("boneless skinless chicken thighs")).toBe("meat");
  });
  test("ground pepper is pantry, peppers are produce", () => {
    expect(categorizeIngredient("black pepper")).toBe("pantry");
    expect(categorizeIngredient("chilli powder")).toBe("pantry");
    expect(categorizeIngredient("bell pepper")).toBe("produce");
  });
  test("chile crisp is pantry", () => {
    expect(categorizeIngredient("chile crisp")).toBe("pantry");
  });
});
