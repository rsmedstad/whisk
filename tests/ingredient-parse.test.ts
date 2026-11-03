import { describe, expect, test } from "bun:test";
import { parseIngredientLine, parseIngredientLines } from "../src/lib/ingredient-parse";

describe("parseIngredientLine", () => {
  test("a leading g in the name is not grams", () => {
    expect(parseIngredientLine("6 garlic cloves, minced")).toEqual({ amount: "6", unit: undefined, name: "garlic cloves, minced" });
    expect(parseIngredientLine("9 lasagna noodles")).toEqual({ amount: "9", unit: undefined, name: "lasagna noodles" });
  });

  test("rejoins split-letter text saved by older versions", () => {
    // Older imports stored amount 6, unit "g", name "Arlic cloves"
    expect(parseIngredientLine("6 g Arlic cloves")?.name).toBe("garlic cloves");
    expect(parseIngredientLine("9 l asagna noodles")?.name).toBe("lasagna noodles");
  });

  test("ranges keep both ends", () => {
    expect(parseIngredientLine("1 or 2 sprigs parsley or cilantro, for garnish")).toEqual({
      amount: "1-2",
      unit: "sprigs",
      name: "parsley or cilantro, for garnish",
    });
    expect(parseIngredientLine("1 to 2 tablespoons olive oil")).toMatchObject({ amount: "1-2", unit: "tablespoons", name: "olive oil" });
    expect(parseIngredientLine("2-3 limes")).toMatchObject({ amount: "2-3", name: "limes" });
  });

  test("hyphenated mixed numbers", () => {
    expect(parseIngredientLine("2-1/4 teaspoons fresh basil")).toMatchObject({ amount: "2 ¼", unit: "teaspoons", name: "fresh basil" });
    expect(parseIngredientLine("1 -3/4 cups water")).toMatchObject({ amount: "1 ¾", unit: "cups", name: "water" });
    expect(parseIngredientLine("1 3/4 cups water")).toMatchObject({ amount: "1 ¾", unit: "cups", name: "water" });
  });

  test("package size in parentheses", () => {
    expect(parseIngredientLine("2 (15-ounce) cans chickpeas, drained")).toMatchObject({
      amount: "2",
      unit: "cans",
      name: "chickpeas, drained (15-ounce)",
    });
  });

  test("ribs and stalks are units", () => {
    expect(parseIngredientLine("3 ribs celery, chopped")).toMatchObject({ amount: "3", unit: "ribs", name: "celery, chopped" });
  });

  test("words that start like range separators stay in the name", () => {
    expect(parseIngredientLine("2 oranges")).toMatchObject({ amount: "2", name: "oranges" });
    expect(parseIngredientLine("1 tomato")).toMatchObject({ amount: "1", name: "tomato" });
  });

  test("second measures and spaced decimals", () => {
    expect(parseIngredientLine("1 cup plus 1 tablespoon sugar")).toMatchObject({ amount: "1", unit: "cup", name: "sugar" });
    expect(parseIngredientLine("2/3 cup /2½ ounces finely grated Parmesan")).toMatchObject({ amount: "⅔", unit: "cup", name: "finely grated Parmesan" });
    expect(parseIngredientLine("1 .5 tablespoons mayonnaise")).toMatchObject({ amount: "1 ½", unit: "tablespoons", name: "mayonnaise" });
    expect(parseIngredientLine("3 packets instant yeast")).toMatchObject({ amount: "3", unit: "packets", name: "instant yeast" });
  });

  test("unicode fractions and lines without amounts", () => {
    expect(parseIngredientLine("1½ cups milk")).toMatchObject({ amount: "1½", unit: "cups", name: "milk" });
    expect(parseIngredientLine("Chile crisp, lemon wedges, for serving")).toEqual({ name: "Chile crisp, lemon wedges, for serving" });
  });
});

describe("parseIngredientLines", () => {
  test("section headers become groups", () => {
    const out = parseIngredientLines(["For the sauce:", "2 tbsp soy sauce", "DRESSING", "1 lemon"]);
    expect(out).toEqual([
      { amount: "2", unit: "tbsp", name: "soy sauce", group: "sauce" },
      { amount: "1", unit: undefined, name: "lemon", group: "Dressing" },
    ]);
  });
});
