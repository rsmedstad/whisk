import { describe, expect, test } from "bun:test";
import { parseFraction, scaleIngredient } from "../src/lib/utils";

describe("scaleIngredient", () => {
  test("scales both ends of a range", () => {
    expect(scaleIngredient({ name: "red wine vinegar", amount: "1-2", unit: "tbsp" }, 4, 8).amount).toBe("2-4");
  });
  test("reads unicode fractions", () => {
    expect(parseFraction("1 ½")).toBe(1.5);
    expect(parseFraction("1½")).toBe(1.5);
    expect(parseFraction("¾")).toBe(0.75);
    expect(scaleIngredient({ name: "milk", amount: "1 ½", unit: "cups" }, 2, 4).amount).toBe("3");
  });
  test("plain amounts still scale", () => {
    expect(scaleIngredient({ name: "eggs", amount: "2" }, 4, 2).amount).toBe("1");
    expect(scaleIngredient({ name: "flour", amount: "1/2", unit: "cup" }, 1, 3).amount).toBe("1 1/2");
  });
});
