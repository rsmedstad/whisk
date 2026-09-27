import type { DiscoverCategory } from "../../src/types";

/**
 * Shared Discover content filters + meal-category classifier.
 *
 * Extracted from api/discover/feed.ts so the heuristics can be unit-tested
 * (bun test) without pulling in the full Pages Function module. All functions
 * are pure — no fetches, no KV, no side effects.
 */

// ── Category classifier ─────────────────────────────────
// Maps recipe titles to meal categories using keyword matching.
// These align with the existing tag system's "meal" group.

const CATEGORY_KEYWORDS: [DiscoverCategory, RegExp][] = [
  ["breakfast", /\b(?:breakfast|pancakes?|waffles?|french toast|omelette|omelet|scrambled?|frittata|eggs?\b(?!plant)|brunch|granola(?!\s+bars?)|oatmeal|cereal|bagels?|bostock|morning buns?|dutch baby|cr[eê]pes?|shakshuka|porridge|acai bowl)\b/i],
  ["soups", /\b(?:soups?|stew|chowder|bisque|broth|gumbo|chili|ramen|pho|pozole|minestrone|gazpacho|consomm[eé])\b/i],
  ["salad", /\b(?:salads?|slaw|coleslaw|ceviche|poke bowl|grain bowl)\b/i],
  ["dessert", /\b(?:desserts?|cake|cookies?|brownies?|pie|tart|ice cream|gelato|pudding|mousse|crumble|cobbler|cupcakes?|cheesecake|tiramisu|macarons?|fudge|candy|chocolate truffles?|sorbet|panna cotta|souffl[eé]|pastry|eclair|profiterole|cr[eê]me br[uû]l[eé]e|brittle|toffee|praline|turnover|strudel|baklava|bark(?:\s|$)|caramels?\b(?!\s*(?:sauce|onion|chicken)))\b/i],
  ["baking", /\b(?:breads?|biscuits?|scones?|focaccia|pretzels?|croissants?|challah|sourdough|brioche|ciabatta|flatbreads?|naan|pitas?\b|cinnamon rolls?|dinner rolls?|sticky buns?|babka|baguettes?|breadsticks?|crescent rolls?|doughnuts?|donuts?|muffins?|danish pastry)\b/i],
  ["drinks", /\b(?:cocktails?|drinks?|smoothie|lemonade|limeade|margarita|sangria|spritz|mojito|caipirinha|paloma|negroni|sidecar|punch|tea\b|coffee\b|latte|chai|matcha|hot chocolate|eggnog|cider)\b/i],
  ["appetizer", /\b(?:appetizers?|dip|hummus|bruschetta|crostini|spring rolls?|dumplings?|wontons?|empanadas?|quesadillas?|nachos?|sliders?|(?<!energy )bites?\b|crab cakes?|deviled eggs?|charcuterie)\b/i],
  ["snack", /\b(?:snacks?|popcorn|trail mix|snack mix|chex mix|muddy buddies|(?<!fish and )chips?|crackers?|energy (?:balls?|bites?)|protein (?:bars?|balls?)|granola bars?|cereal bars?|roasted chickpeas|fruit leather|cheese straws?)\b/i],
  ["side dish", /\b(?:side dish|mashed potatoes?|roasted vegetables?|rice pilaf|couscous|baked beans|corn ?bread|mac and cheese|macaroni|stuffing|au gratin|roasted potatoes?|french fries|fries|potato salad)\b/i],
  // "dinner" is the default/catch-all for main dishes
];

/** Main-dish proteins — if the title contains one of these, override snack/appetizer/drinks categories */
export const MAIN_DISH_PROTEIN = /\b(?:fish|salmon|tuna|shrimp|chicken|turkey|duck|pork|beef|steak|lamb|veal|ribs|brisket|meatloaf|roast|chops?)\b/i;

/** Savory pie/tart markers — these match the dessert regex via "pie"/"tart" but are mains */
const SAVORY_PIE = /\b(?:shepherd'?s?|cottage|pot|meat|mince|savou?ry|guinness|chicken|beef|pork|lamb|turkey|ham|fish|seafood|crab|leek|spinach|quiche|pizza|asparagus|tomato|onion|mushroom|goat)\b/i;

export function classifyRecipe(title: string, description?: string, tags?: string[]): DiscoverCategory {
  const text = `${title} ${description ?? ""}`;
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) {
      // Don't let a keyword override when the title is clearly a main dish
      // (e.g. "Sweet Tea-Brined Roast Chicken" matches drinks via "tea")
      if ((category === "snack" || category === "appetizer" || category === "drinks") && MAIN_DISH_PROTEIN.test(title)) {
        return "dinner";
      }
      // Savory pies/tarts (shepherd's, cottage, pot, mince…) match dessert via "pie"/"tart"
      if (category === "dessert" && /\b(?:pie|tart)\b/i.test(title) && SAVORY_PIE.test(title)) {
        return "dinner";
      }
      return category;
    }
  }
  // Before defaulting to "dinner", check if AI-assigned tags indicate a category —
  // when Groq tagged a meal type, prefer it over the keyword default.
  if (tags && tags.length > 0) {
    const mealTags: DiscoverCategory[] = ["breakfast", "dessert", "snack", "appetizer", "salad", "side dish", "drinks", "baking", "soups"];
    for (const tag of tags) {
      if (mealTags.includes(tag as DiscoverCategory)) {
        return tag as DiscoverCategory;
      }
    }
  }
  return "dinner"; // Default: main dish / entrée
}

// ── Non-recipe URL / title filters ──────────────────────

/**
 * Detect URLs that point to a collection/roundup, editorial section, or
 * shopping/product post rather than a single recipe. Recipe sites expose
 * "hub" pages — e.g. bbcgoodfood.com/recipes/collection/cherry-recipes —
 * and commerce slugs — e.g. thekitchn.com/best-coffee-mug-warmer-23845669 —
 * that have no ingredients or steps and fail when imported as a recipe.
 */
export function isNonRecipeUrl(url: string): boolean {
  const lc = url.toLowerCase();
  // Collection / roundup / gallery / premium hubs
  if (/\/(?:collections?|roundups?|galler(?:y|ies)|premium)\//.test(lc)) return true;
  // Editorial / shopping / news / how-to sections
  if (/\/(?:reviews?|health|news-?trends?|news|how-?to|guides?|inspiration|advice|shopping|wellness|opinion|video)\//.test(lc)) return true;
  // Shopping-event / deals / gift-guide slugs
  if (/(?:^|[/-])(?:gift-guides?|deals?|prime-day|black-friday|cyber-monday|mail-order)(?:[/-]|$)/.test(lc)) return true;
  // "best-<kitchen gear>" product-roundup slugs (e.g. /best-coffee-mug-warmer-23845669).
  // The gear noun must end the slug (an optional numeric CMS id may follow) so
  // recipe slugs like /best-blender-salsa-recipe are not caught.
  if (/\/(?:the-)?best-[a-z0-9-]*(?:warmer|frother|gadget|cookware|bakeware|knife|knives|blender|mixer|kettle|toaster|appliance|machine|maker|opener|storage|organizer|container|mug|gear|tool|product|brand|subscription)s?(?:-\d+)?(?:\/|$)/.test(lc)) return true;
  return false;
}

/**
 * Detect titles that name a roundup/collection ("Cherry recipes", "Exclusive
 * salad recipes", "Sheet Pan Chicken Dinners") rather than a single dish.
 * Individual recipes are named after the dish ("Mexican street corn salad"),
 * so a multi-word title ending in a plural roundup noun is almost always a hub.
 */
export function isCollectionTitle(title: string): boolean {
  const t = title.trim();
  if (t.split(/\s+/).length < 2) return false;
  return /\b(?:recipes|ideas|dishes|bakes|traybakes|dinners|lunches|breakfasts|desserts|mains|sides)$/i.test(t);
}

/** Titles that signal editorial/news/roundups/shopping rather than a single
 *  recipe (mixed blog feeds like The Kitchn and Pinch of Yum include these). */
export function isNonRecipeFeedTitle(title: string): boolean {
  const t = title.trim();
  // Numeric roundups / listicles: "22 Must-Make Summer Desserts", "40 Easy Dinners"
  if (/^\d{1,3}\b[\s\S]*\b(?:recipes?|dinners?|desserts?|ideas|meals?|ways|sides?|salads?|snacks?|dishes|cocktails?|drinks?|breakfasts?|lunches|appetizers?|bakes?)\b/i.test(t)) return true;
  // Editorial / shopping / news patterns
  if (/\b(?:why|how a|shares|reviews?|deals?|sales?\b|amazon|costco|trader joe|aldi|i tried|i asked|we tried|we tested|according to|gift guides?|news|announc|recall|worth the hype|taste test|cooking club|newsletter|meal plan|what to cook|weekly menu|giveaway|podcast)\b/i.test(t)) return true;
  // Product roundups pegged to a year: "The Best Coffee Mug Warmer for 2026",
  // "Best Stand Mixers of 2025" (any number of words, "of" or "for")
  if (/\bbest\b[^.!?]{0,80}\b(?:of|for)\s+20\d{2}\b/i.test(t)) return true;
  // Shopping calls-to-action / commerce phrasing
  if (/\b(?:order online|you can (?:buy|order)|to shop\b|add to cart|free shipping|\d+% off|under \$\d+|on sale|lowest price|price drop)\b/i.test(t)) return true;
  // "Best/top/favorite <kitchen gear>" roundups — a gear noun ending the title
  // ("The Best Milk Frothers"). End-anchored so dish titles that merely mention
  // equipment ("Best-Ever Blender Salsa") are not caught; roundups with trailing
  // clauses are covered by the year/price/CTA rules above.
  if (/\b(?:best|top(?:\s+\d+)?|favorite|essential)\b[^.!?]{0,60}\b(?:warmers?|frothers?|gadgets?|blenders?|mixers?|kettles?|toasters?|cookware|bakeware|knife|knives|appliances?|machines?|makers?|openers?|storage|organizers?|containers?|mugs?|air fryers?|dutch ovens?|gear|tools?|products?|brands?|subscriptions?)\s*[.!?]*\s*$/i.test(t)) return true;
  return false;
}

// ── RSS <category> gate ─────────────────────────────────
// Editorial+commerce feeds (esp. The Kitchn) annotate every item with
// categories: recipes carry "Recipes"/"recipe"/"recipe review", while
// shopping posts carry "shopping"/"product review"/… and tips/news posts
// carry "news"/"skills". Use these as a strong recipe signal when present.

const SHOPPING_FEED_CATEGORY = /^(?:shopping|product (?:reviews?|roundups?|modules?|text links?)|sales? & events|deals?|gift guides?|megalist|taste test|buying guides?)$/i;
const EDITORIAL_FEED_CATEGORY = /^(?:news|skills)$/i;
const RECIPE_FEED_CATEGORY = /^recipes?\b/i; // "Recipes", "recipe", "recipe review"

/** Reject a feed item based on its RSS <category> tags (decoded, raw casing).
 *  Conservative: only rejects when a shopping/editorial marker is present AND
 *  no recipe category vouches for the item. Feeds without category metadata
 *  (or with plain food-tag categories) are unaffected. */
export function isNonRecipeFeedCategories(categories: string[]): boolean {
  if (categories.length === 0) return false;
  const hasRecipeCat = categories.some((c) => RECIPE_FEED_CATEGORY.test(c.trim()));
  if (hasRecipeCat) return false;
  if (categories.some((c) => SHOPPING_FEED_CATEGORY.test(c.trim()))) return true;
  if (categories.some((c) => EDITORIAL_FEED_CATEGORY.test(c.trim()))) return true;
  return false;
}
