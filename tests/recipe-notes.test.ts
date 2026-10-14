import { describe, expect, test } from "bun:test";
import { parseInstructions } from "../functions/api/import/url";

describe("HowToSection Notes → recipe.notes", () => {
  test("moves Notes and Recipe Notes sections out of steps", () => {
    const { steps, notes } = parseInstructions([
      { "@type": "HowToStep", text: "Mix the flour and water." },
      {
        "@type": "HowToSection",
        name: "Notes",
        itemListElement: [{ "@type": "HowToStep", text: "Best the next day." }],
      },
      {
        "@type": "HowToSection",
        name: "Recipe Notes",
        itemListElement: [{ "@type": "HowToDirection", text: "Salt to taste." }],
      },
      { "@type": "HowToStep", text: "Bake at 375°F." },
    ]);
    expect(steps.map((s) => s.text)).toEqual([
      "Mix the flour and water.",
      "Bake at 375°F.",
    ]);
    expect(notes).toContain("Best the next day.");
    expect(notes).toContain("Salt to taste.");
  });
});
