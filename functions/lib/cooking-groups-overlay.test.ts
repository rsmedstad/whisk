import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { overlayImportedRecipe } from "./cooking-groups-overlay";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/tasty-sally-focaccia.html"
);
const tastyFixture = readFileSync(fixturePath, "utf8");

describe("overlayImportedRecipe", () => {
  test("overlays Tasty headings and HowToStep names onto a flat import", () => {
    const flat = {
      ingredients: [
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
      ],
      steps: [
        { text: "Whisk half of the water, sugar, and yeast together." },
        { text: "Add the remaining water, olive oil, salt, and flour." },
        { text: "Whisk the remaining olive oil with the minced garlic and herbs." },
      ],
    };
    const out = overlayImportedRecipe(flat, tastyFixture);
    expect(out.ingredients?.[0]?.group).toBeUndefined();
    expect(out.ingredients?.[6]?.group).toBe("Topping & Pan");
    expect(out.steps?.[0]?.group).toBe("Prepare the dough");
    expect(out.steps?.[2]?.group).toBe("Prepare the toppings");
    expect(out.ingredients?.[0]?.amount).toBe("2");
  });
});
