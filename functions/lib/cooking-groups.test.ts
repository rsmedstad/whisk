import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanGroupName,
  collectHtmlIngredientLines,
  extractIngredientLinesWithHeadings,
  extractTastyIngredientsHtml,
  howToStepGroup,
  isIngredientGroupHeader,
  overlayIngredientGroups,
  type GroupableIngredient,
} from "./cooking-groups";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/tasty-sally-focaccia.html"
);
const tastyFixture = readFileSync(fixturePath, "utf8");

function groupsFromSentinels(
  lines: string[]
): { name: string; group?: string }[] {
  const results: { name: string; group?: string }[] = [];
  let currentGroup: string | undefined;
  for (const line of lines) {
    if (isIngredientGroupHeader(line)) {
      currentGroup = cleanGroupName(line);
      if (
        currentGroup &&
        currentGroup === currentGroup.toUpperCase() &&
        currentGroup.length > 1
      ) {
        currentGroup =
          currentGroup.charAt(0) + currentGroup.slice(1).toLowerCase();
      }
      continue;
    }
    results.push({ name: line, group: currentGroup });
  }
  return results;
}

describe("isIngredientGroupHeader", () => {
  test("heading-like sentinel lines stay headers", () => {
    expect(isIngredientGroupHeader("Topping & Pan:")).toBe(true);
    expect(isIngredientGroupHeader("For the crispy skirt")).toBe(true);
    expect(isIngredientGroupHeader("DIPPING SAUCE")).toBe(true);
    expect(isIngredientGroupHeader("For the dough:")).toBe(true);
  });

  test("real ingredients are not headers", () => {
    expect(isIngredientGroupHeader("2 cups warm water")).toBe(false);
    expect(
      isIngredientGroupHeader("5 Tablespoons extra virgin olive oil")
    ).toBe(false);
    expect(
      isIngredientGroupHeader("sprinkle of coarse salt and freshly ground black pepper")
    ).toBe(false);
  });
});

describe("Tasty heading overlay", () => {
  test("does not stop at the first nested </div> and keeps the first block unlabeled", () => {
    const section = extractTastyIngredientsHtml(tastyFixture);
    expect(section).toBeTruthy();
    expect(section!).toContain("Topping");
    expect(section!).toContain("garlic cloves");

    const lines = extractIngredientLinesWithHeadings(section!);
    expect(lines.length).toBe(11); // 6 dough + sentinel + 4 topping
    expect(lines[0]).toMatch(/warm water/i);
    expect(lines[6]).toBe("Topping & Pan:");
    expect(lines[7]).toMatch(/olive oil/i);
    expect(lines.some((l) => /^dough:?$/i.test(l))).toBe(false);

    const parsed = groupsFromSentinels(lines);
    expect(parsed).toHaveLength(10);
    expect(parsed.slice(0, 6).every((i) => !i.group)).toBe(true);
    expect(parsed.slice(6).every((i) => i.group === "Topping & Pan")).toBe(true);
  });

  test("collectHtmlIngredientLines finds Tasty groups on the full page", () => {
    const lines = collectHtmlIngredientLines(tastyFixture);
    const parsed = groupsFromSentinels(lines);
    expect(parsed).toHaveLength(10);
    expect(parsed[6]?.group).toBe("Topping & Pan");
  });
});

describe("JSON-LD overlay-when-flat", () => {
  test("copies HTML groups onto flat JSON-LD amounts/names without replacing them", () => {
    const jsonLd: GroupableIngredient[] = [
      { amount: "2", unit: "cups", name: "warm water (between 100–110°F, 38–43°C)" },
      { amount: "2", unit: "teaspoons", name: "granulated sugar" },
      { amount: "2", unit: "teaspoons", name: "instant or active dry yeast" },
      { amount: "¼", unit: "cup", name: "extra virgin olive oil" },
      { amount: "1", unit: "Tablespoon", name: "kosher salt" },
      { amount: "4", name: "and 1/2–5 cups all-purpose flour or bread flour" },
      { amount: "5", unit: "Tablespoons", name: "extra virgin olive oil or more as needed, divided" },
      { amount: "2", name: "garlic cloves, minced" },
      { amount: "3", name: "–4 Tablespoons chopped fresh herbs" },
      { name: "sprinkle of coarse salt and freshly ground black pepper" },
    ];
    const htmlParsed = groupsFromSentinels(
      collectHtmlIngredientLines(tastyFixture)
    );
    const overlaid = overlayIngredientGroups(jsonLd, htmlParsed);

    expect(overlaid[0]?.amount).toBe("2");
    expect(overlaid[0]?.unit).toBe("cups");
    expect(overlaid[0]?.name).toContain("warm water");
    expect(overlaid[0]?.group).toBeUndefined();
    expect(overlaid[6]?.amount).toBe("5");
    expect(overlaid[6]?.name).toContain("olive oil");
    expect(overlaid[6]?.group).toBe("Topping & Pan");
    expect(overlaid[9]?.group).toBe("Topping & Pan");
  });

  test("does not overlay when JSON-LD already has groups", () => {
    const target: GroupableIngredient[] = [
      { name: "flour", group: "Dough" },
      { name: "oil", group: "Dough" },
    ];
    const grouped: GroupableIngredient[] = [
      { name: "flour", group: "Batter" },
      { name: "oil", group: "Topping" },
    ];
    const out = overlayIngredientGroups(target, grouped);
    expect(out[0]?.group).toBe("Dough");
    expect(out[1]?.group).toBe("Dough");
  });

  test("does not invent Dough when HTML first block is unlabeled", () => {
    const target: GroupableIngredient[] = [
      { name: "flour" },
      { name: "oil" },
    ];
    const grouped: GroupableIngredient[] = [
      { name: "flour" },
      { name: "oil", group: "Topping & Pan" },
    ];
    const out = overlayIngredientGroups(target, grouped);
    expect(out[0]?.group).toBeUndefined();
    expect(out[1]?.group).toBe("Topping & Pan");
  });
});

describe("HowToStep.name as group", () => {
  test("uses name as group when both name and text exist", () => {
    expect(
      howToStepGroup("Prepare the dough", "Whisk half of the water together.")
    ).toBe("Prepare the dough");
    expect(
      howToStepGroup("Prepare the toppings:", "Whisk the remaining olive oil.")
    ).toBe("Prepare the toppings");
  });

  test("does not use name as group when text is missing (name stays step text)", () => {
    expect(howToStepGroup("Prepare the dough", undefined, "Bake")).toBe("Bake");
    expect(howToStepGroup("Prepare the dough", "  ", undefined)).toBeUndefined();
  });

  test("HowToSection sectionGroup is kept when the step has no name", () => {
    expect(
      howToStepGroup(undefined, "Add the remaining water.", "Make the dough")
    ).toBe("Make the dough");
  });
});

describe("WPRM / NYT sentinel groups", () => {
  test("WPRM group-name blocks become sentinels and parse as groups", () => {
    const wprm = `
      <div class="wprm-recipe-container">
        <div class="wprm-recipe-ingredient-group">
          <h4 class="wprm-recipe-group-name">For the dough</h4>
          <ul>
            <li class="wprm-recipe-ingredient">2 cups flour</li>
            <li class="wprm-recipe-ingredient">1 tsp yeast</li>
          </ul>
        </div>
        <div class="wprm-recipe-ingredient-group">
          <h4 class="wprm-recipe-group-name">Topping &amp; Pan</h4>
          <ul>
            <li class="wprm-recipe-ingredient">2 garlic cloves</li>
            <li class="wprm-recipe-ingredient">3 Tbsp olive oil</li>
          </ul>
        </div>
        <div class="wprm-recipe-instructions"></div>
      </div>`;
    const lines = collectHtmlIngredientLines(wprm);
    expect(lines[0]).toBe("For the dough:");
    expect(lines).toContain("Topping & Pan:");
    const parsed = groupsFromSentinels(lines);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]?.group).toBe("dough");
    expect(parsed[2]?.group).toBe("Topping & Pan");
  });

  test("NYT-style injected 'Label:' sentinels still parse as groups", () => {
    const lines = [
      "For the crust:",
      "1 1/2 cups flour",
      "Topping:",
      "2 cups cherries",
    ];
    const parsed = groupsFromSentinels(lines);
    expect(parsed[0]).toEqual({ name: "1 1/2 cups flour", group: "crust" });
    expect(parsed[1]).toEqual({ name: "2 cups cherries", group: "Topping" });
  });
});

describe("optional vs recommended headings", () => {
  test("does not drop recommended toppings; optional only if heading contains optional", () => {
    const html = `
      <div class="recipe-card">
        <div class="ingredients">
          <ul><li>2 cups flour</li></ul>
          <p><strong>Recommended toppings</strong></p>
          <ul><li>1 cup berries</li></ul>
          <h3>Optional garnish</h3>
          <ul><li>mint leaves</li></ul>
        </div>
        <div class="instructions"></div>
      </div>`;
    const parsed = groupsFromSentinels(collectHtmlIngredientLines(html));
    expect(parsed.map((p) => p.name)).toEqual([
      "2 cups flour",
      "1 cup berries",
      "mint leaves",
    ]);
    expect(parsed[1]?.group).toBe("Recommended toppings");
    expect(parsed[2]?.group).toBe("Optional garnish");
    expect(parsed[1]?.group?.toLowerCase().includes("optional")).toBe(false);
    expect(parsed[2]?.group?.toLowerCase().includes("optional")).toBe(true);
  });
});

describe("generic h3 / p>strong between lists", () => {
  test("walks headings the same way as Tasty/WPRM sentinels", () => {
    const html = `
      <div class="recipe-content">
        <div id="recipe-ingredients">
          <ul><li>200g chocolate</li><li>100g butter</li></ul>
          <p><strong>For the frosting:</strong></p>
          <ul><li>200g cream cheese</li></ul>
        </div>
        <div class="instructions"></div>
      </div>`;
    const parsed = groupsFromSentinels(collectHtmlIngredientLines(html));
    expect(parsed[0]?.group).toBeUndefined();
    expect(parsed[2]?.group).toBe("frosting");
  });
});
