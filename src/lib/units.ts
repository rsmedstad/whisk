// ── Gram Weight Estimation ──────────────────────────────
// Grams per 1 cup for common baking/cooking ingredients.
// Sources: USDA FoodData Central, King Arthur Baking weight chart.
const DENSITY_G_PER_CUP: Record<string, number> = {
  // Flours
  "all-purpose flour": 120, "all purpose flour": 120, "flour": 120, "ap flour": 120,
  "bread flour": 130, "cake flour": 115, "pastry flour": 115,
  "whole wheat flour": 128, "whole-wheat flour": 128,
  "almond flour": 96, "almond meal": 96,
  "coconut flour": 128, "oat flour": 92,
  "rice flour": 158, "rye flour": 102,
  "self-rising flour": 120, "self rising flour": 120,
  "cornstarch": 128, "corn starch": 128,

  // Sugars
  "granulated sugar": 200, "sugar": 200, "white sugar": 200, "caster sugar": 200,
  "brown sugar": 220, "light brown sugar": 220, "dark brown sugar": 220, "packed brown sugar": 220,
  "powdered sugar": 120, "confectioners sugar": 120, "icing sugar": 120, "confectioners' sugar": 120,
  "turbinado sugar": 180, "demerara sugar": 180,

  // Fats
  "butter": 227, "unsalted butter": 227, "salted butter": 227,
  "vegetable oil": 218, "canola oil": 218, "olive oil": 216,
  "coconut oil": 218, "shortening": 205, "lard": 205,
  "cream cheese": 232,

  // Dairy
  "milk": 244, "whole milk": 244, "skim milk": 244, "buttermilk": 245,
  "heavy cream": 238, "heavy whipping cream": 238, "whipping cream": 238,
  "sour cream": 230, "yogurt": 245, "greek yogurt": 245,

  // Liquids
  "water": 237, "honey": 340, "maple syrup": 312, "molasses": 328,
  "corn syrup": 328, "agave": 336,

  // Chocolate & cocoa
  "cocoa powder": 86, "cocoa": 86, "unsweetened cocoa": 86, "dutch process cocoa": 86,
  "chocolate chips": 170, "mini chocolate chips": 170,

  // Nuts & seeds
  "chopped walnuts": 120, "walnuts": 120,
  "chopped pecans": 110, "pecans": 110,
  "sliced almonds": 90, "almonds": 140,
  "peanuts": 145, "cashews": 140, "pistachios": 120,
  "sunflower seeds": 140, "sesame seeds": 144,
  "peanut butter": 258, "almond butter": 256,

  // Grains & starches
  "rolled oats": 90, "oats": 90, "old-fashioned oats": 90, "quick oats": 80,
  "rice": 185, "white rice": 185, "brown rice": 190,
  "breadcrumbs": 108, "panko": 60, "panko breadcrumbs": 60,
  "cornmeal": 150,

  // Dried fruit
  "raisins": 150, "dried cranberries": 120, "chopped dates": 150,

  // Other
  "shredded coconut": 80, "coconut flakes": 80, "sweetened shredded coconut": 93,
  "salt": 288, "kosher salt": 240,
  "baking powder": 230, "baking soda": 230,
};

// Volume units normalized to cups
const UNIT_TO_CUPS: Record<string, number> = {
  cup: 1, cups: 1,
  tbsp: 1 / 16, tablespoon: 1 / 16, tablespoons: 1 / 16,
  tsp: 1 / 48, teaspoon: 1 / 48, teaspoons: 1 / 48,
};

/** Estimate gram weight for a volume-based ingredient. Returns null if unknown. */
export function estimateGrams(
  amount: number,
  unit: string,
  ingredientName: string
): number | null {
  const unitLower = unit.toLowerCase().trim();
  const cupFraction = UNIT_TO_CUPS[unitLower];
  if (cupFraction === undefined) return null;

  const nameLower = ingredientName.toLowerCase().trim();

  // Try exact match first, then progressively shorter substrings
  let density = DENSITY_G_PER_CUP[nameLower];
  if (density === undefined) {
    // Try matching the last word(s) — e.g. "sifted all-purpose flour" → "all-purpose flour" → "flour"
    const words = nameLower.split(/\s+/);
    for (let start = 1; start < words.length && density === undefined; start++) {
      density = DENSITY_G_PER_CUP[words.slice(start).join(" ")];
    }
  }

  if (density === undefined) return null;

  const grams = amount * cupFraction * density;
  // Round sensibly
  if (grams < 5) return Math.round(grams * 10) / 10;
  if (grams < 50) return Math.round(grams);
  return Math.round(grams / 5) * 5;
}
