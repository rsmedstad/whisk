// Test suite for the Whisk AI chat endpoint
// Usage:
//   bun run scripts/test-ai.ts                              # uses deployed endpoint, reads token from env
//   bun run scripts/test-ai.ts --token YOUR_TOKEN           # explicit auth token
//   bun run scripts/test-ai.ts --url http://localhost:5173  # override base URL
//   bun run scripts/test-ai.ts --verbose                    # print full AI responses

// ── CLI arg parsing ──────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const BASE_URL = getArg("url") ?? "https://whisk-15t.pages.dev";
const VERBOSE = hasFlag("verbose");
let AUTH_TOKEN = getArg("token") ?? process.env.WHISK_TOKEN;

if (!AUTH_TOKEN) {
  // Try reading from localStorage-style file or prompt
  console.error(
    "\x1b[33mNo auth token provided. Use --token <TOKEN> or set WHISK_TOKEN env var.\x1b[0m"
  );
  console.error(
    `You can find your token in the app's localStorage under 'whisk_token', or by logging in at ${BASE_URL}`
  );
  process.exit(1);
}

// ── Colors ───────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ── Mock data ────────────────────────────────────────────────

const MOCK_RECIPES = [
  { title: "Chicken Parmesan", tags: ["dinner", "italian"], prepTime: 15, cookTime: 30, servings: 4 },
  { title: "Classic Pancakes", tags: ["breakfast"], prepTime: 5, cookTime: 15, servings: 4 },
  { title: "Caesar Salad", tags: ["lunch", "salad"], prepTime: 15, cookTime: 0, servings: 2 },
  { title: "Beef Tacos", tags: ["dinner", "mexican"], prepTime: 10, cookTime: 20, servings: 4 },
  { title: "Chocolate Chip Cookies", tags: ["dessert", "baking"], prepTime: 15, cookTime: 20, servings: 24 },
  { title: "Vegetable Stir Fry", tags: ["dinner", "asian", "vegetarian"], prepTime: 10, cookTime: 10, servings: 2 },
  { title: "Banana Bread", tags: ["breakfast", "baking"], prepTime: 10, cookTime: 50, servings: 8 },
  { title: "Greek Salad", tags: ["lunch", "salad", "vegetarian"], prepTime: 10, cookTime: 0, servings: 4 },
  { title: "Spaghetti Bolognese", tags: ["dinner", "italian"], prepTime: 10, cookTime: 30, servings: 6 },
  { title: "Chicken Tikka Masala", tags: ["dinner", "indian"], prepTime: 15, cookTime: 35, servings: 4 },
];

const MOCK_RECIPE_TITLES = MOCK_RECIPES.map((r) => r.title.toLowerCase());

const MOCK_MEAL_PLAN = [
  { date: "2026-03-10", slot: "dinner", title: "Chicken Parmesan", recipeId: "r1", completed: false },
  { date: "2026-03-11", slot: "dinner", title: "Beef Tacos", recipeId: "r4", completed: false },
  { date: "2026-03-12", slot: "breakfast", title: "Classic Pancakes", recipeId: "r2", completed: false },
  // Wednesday-Sunday left empty to test gap-filling suggestions
];

const MOCK_SHOPPING_LIST = [
  { name: "chicken breast", checked: false, category: "Meat" },
  { name: "parmesan cheese", checked: false, category: "Dairy" },
  { name: "spaghetti", checked: false, category: "Pantry" },
  { name: "tortillas", checked: true, category: "Bakery" },
  { name: "ground beef", checked: true, category: "Meat" },
  { name: "lettuce", checked: false, category: "Produce" },
  { name: "tomatoes", checked: false, category: "Produce" },
  { name: "olive oil", checked: true, category: "Pantry" },
];

const MOCK_PREFERENCES = {
  dietaryRestrictions: ["no nuts"],
  favoriteCuisines: ["italian", "mexican"],
  dislikedIngredients: [] as string[],
};

const MOCK_SEASONAL_CONTEXT = `Today is Tuesday, March 10, 2026. Season: Early Spring. Upcoming: St. Patrick's Day (March 17). Household size: 2 people.`;

// ── API caller ───────────────────────────────────────────────

interface ChatResponse {
  content: string;
}

async function callChat(
  userMessage: string,
  options?: {
    includeSeasonalContext?: boolean;
    includeMealPlan?: boolean;
    includeShoppingList?: boolean;
    includePreferences?: boolean;
  }
): Promise<{ content: string; status: number; ok: boolean }> {
  const opts = {
    includeSeasonalContext: true,
    includeMealPlan: true,
    includeShoppingList: true,
    includePreferences: true,
    ...options,
  };

  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: userMessage }],
  };

  if (opts.includeSeasonalContext) body.seasonalContext = MOCK_SEASONAL_CONTEXT;
  if (opts.includeMealPlan) body.mealPlan = MOCK_MEAL_PLAN;
  if (opts.includeShoppingList) body.shoppingList = MOCK_SHOPPING_LIST;
  if (opts.includePreferences) body.preferences = MOCK_PREFERENCES;

  try {
    const res = await fetch(`${BASE_URL}/api/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { content: text, status: res.status, ok: false };
    }

    const data = (await res.json()) as ChatResponse;
    return { content: data.content, status: res.status, ok: true };
  } catch (err) {
    return {
      content: `Fetch error: ${(err as Error).message}`,
      status: 0,
      ok: false,
    };
  }
}

// ── Test definitions ─────────────────────────────────────────

interface TestCase {
  name: string;
  prompt: string;
  options?: Parameters<typeof callChat>[1];
  validate: (content: string) => TestResult;
}

interface TestResult {
  pass: boolean;
  reason: string;
  warnings?: string[];
}

/** Check that the response mentions at least one of the given keywords (case-insensitive). */
function hasAnyKeyword(content: string, keywords: string[]): boolean {
  const lower = content.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/** Check if any recipe name appears in the response that is NOT in the mock collection. */
function findHallucinatedRecipes(content: string): string[] {
  // Common recipe-like patterns (Title Case phrases near food words)
  // We check if the response references recipe names by looking for title-cased phrases
  // that aren't in our collection. This is a heuristic, not perfect.
  const mentioned: string[] = [];
  for (const recipe of MOCK_RECIPES) {
    if (content.toLowerCase().includes(recipe.title.toLowerCase())) {
      mentioned.push(recipe.title);
    }
  }
  return mentioned;
}

const tests: TestCase[] = [
  {
    name: "Substitution question",
    prompt: "What can I substitute for eggs in pancakes?",
    validate(content) {
      const warnings: string[] = [];
      if (!content || content.length < 20) {
        return { pass: false, reason: "Response too short or empty" };
      }
      const relevant = hasAnyKeyword(content, [
        "substitute", "replace", "instead", "flax", "banana", "applesauce",
        "aquafaba", "yogurt", "buttermilk", "egg", "pancake",
      ]);
      if (!relevant) {
        return { pass: false, reason: "Response not relevant to egg substitution" };
      }
      // Should reference Classic Pancakes from collection
      if (content.toLowerCase().includes("classic pancakes")) {
        // Good - references the collection
      } else {
        warnings.push("Did not reference 'Classic Pancakes' from the collection");
      }
      return { pass: true, reason: "Relevant substitution advice provided", warnings };
    },
  },
  {
    name: "Recipe ideas from collection",
    prompt: "What should I make for dinner tonight?",
    validate(content) {
      if (!content || content.length < 20) {
        return { pass: false, reason: "Response too short or empty" };
      }
      // Should suggest dinner recipes from the collection
      const dinnerRecipes = ["chicken parmesan", "beef tacos", "vegetable stir fry",
        "spaghetti bolognese", "chicken tikka masala"];
      const mentionsDinner = dinnerRecipes.some((r) => content.toLowerCase().includes(r));
      if (!mentionsDinner) {
        return { pass: false, reason: "Did not suggest any dinner recipes from collection" };
      }
      // Should be aware that Chicken Parmesan is already planned for tonight
      const warnings: string[] = [];
      if (content.toLowerCase().includes("chicken parmesan") && !content.toLowerCase().includes("already")) {
        warnings.push("Suggested Chicken Parmesan without noting it is already planned for tonight");
      }
      return { pass: true, reason: "Suggested dinner recipes from collection", warnings };
    },
  },
  {
    name: "Dinner party planning",
    prompt: "I'm hosting 6 people this Saturday, help me plan a menu",
    validate(content) {
      if (!content || content.length < 50) {
        return { pass: false, reason: "Response too short for menu planning" };
      }
      const relevant = hasAnyKeyword(content, [
        "menu", "course", "appetizer", "main", "dessert", "serve",
        "dinner", "guests", "hosting", "saturday",
      ]);
      if (!relevant) {
        return { pass: false, reason: "Response not relevant to dinner party planning" };
      }
      // Should reference recipes from collection
      const mentionsCollection = MOCK_RECIPES.some(
        (r) => content.toLowerCase().includes(r.title.toLowerCase())
      );
      const warnings: string[] = [];
      if (!mentionsCollection) {
        warnings.push("Did not reference any recipes from the user's collection");
      }
      return { pass: true, reason: "Provided dinner party menu suggestions", warnings };
    },
  },
  {
    name: "Weekly meal planning",
    prompt: "Help me plan meals for the rest of the week",
    validate(content) {
      if (!content || content.length < 50) {
        return { pass: false, reason: "Response too short for weekly planning" };
      }
      const relevant = hasAnyKeyword(content, [
        "wednesday", "thursday", "friday", "saturday", "sunday",
        "week", "plan", "meal", "dinner", "lunch", "breakfast",
      ]);
      if (!relevant) {
        return { pass: false, reason: "Response not relevant to weekly planning" };
      }
      // Should be aware of existing plan entries
      const warnings: string[] = [];
      const acknowledgesExisting = hasAnyKeyword(content, [
        "already", "planned", "monday", "tuesday", "chicken parmesan", "beef tacos",
      ]);
      if (!acknowledgesExisting) {
        warnings.push("Did not acknowledge existing meal plan entries");
      }
      return { pass: true, reason: "Provided weekly meal plan suggestions", warnings };
    },
  },
  {
    name: "Ingredient-based suggestions",
    prompt: "I have chicken, rice, and broccoli. What can I make?",
    validate(content) {
      if (!content || content.length < 20) {
        return { pass: false, reason: "Response too short or empty" };
      }
      const relevant = hasAnyKeyword(content, [
        "chicken", "rice", "broccoli", "stir fry", "stir-fry",
        "bowl", "cook", "make",
      ]);
      if (!relevant) {
        return { pass: false, reason: "Response not relevant to the ingredients provided" };
      }
      return { pass: true, reason: "Provided ingredient-based suggestions" };
    },
  },
  {
    name: "Seasonal/holiday awareness",
    prompt: "What should I make for St. Patrick's Day?",
    validate(content) {
      if (!content || content.length < 20) {
        return { pass: false, reason: "Response too short or empty" };
      }
      const relevant = hasAnyKeyword(content, [
        "st. patrick", "saint patrick", "irish", "green", "corned beef",
        "cabbage", "soda bread", "stew", "shepherd", "colcannon", "march 17",
      ]);
      if (!relevant) {
        return { pass: false, reason: "Response not relevant to St. Patrick's Day" };
      }
      return { pass: true, reason: "Provided seasonally appropriate suggestions" };
    },
  },
  {
    name: "Shopping list help",
    prompt: "What do I still need to buy for the week?",
    validate(content) {
      if (!content || content.length < 20) {
        return { pass: false, reason: "Response too short or empty" };
      }
      const relevant = hasAnyKeyword(content, [
        "shopping", "list", "buy", "need", "chicken", "parmesan",
        "spaghetti", "lettuce", "tomato",
      ]);
      if (!relevant) {
        return { pass: false, reason: "Response not relevant to shopping list" };
      }
      // Should reference unchecked items
      const warnings: string[] = [];
      const mentionsUnchecked = hasAnyKeyword(content, [
        "chicken breast", "parmesan", "spaghetti", "lettuce", "tomato",
      ]);
      if (!mentionsUnchecked) {
        warnings.push("Did not reference specific unchecked shopping list items");
      }
      return { pass: true, reason: "Provided shopping list guidance", warnings };
    },
  },
  {
    name: "Off-topic rejection",
    prompt: "How do I fix my car's alternator?",
    validate(content) {
      if (!content || content.length < 10) {
        return { pass: false, reason: "Response too short or empty" };
      }
      // Should NOT provide car repair advice
      const givesCarAdvice = hasAnyKeyword(content, [
        "alternator", "battery", "mechanic", "voltage", "belt", "wiring",
        "serpentine", "amp", "charging system",
      ]);
      // Should redirect to food
      const redirectsToFood = hasAnyKeyword(content, [
        "food", "cook", "recipe", "meal", "kitchen", "help you with",
        "assist you with", "not something", "can't help", "unable",
        "outside", "scope", "focus on",
      ]);
      if (givesCarAdvice && !redirectsToFood) {
        return { pass: false, reason: "Provided car repair advice instead of staying in food scope" };
      }
      if (!redirectsToFood) {
        return { pass: false, reason: "Did not redirect to food-related topics" };
      }
      return { pass: true, reason: "Politely declined off-topic question and redirected to food" };
    },
  },
];

// ── Test runner ──────────────────────────────────────────────

interface TestOutcome {
  name: string;
  pass: boolean;
  reason: string;
  warnings: string[];
  durationMs: number;
  httpStatus: number;
}

async function runTests(): Promise<void> {
  console.log(`\n${BOLD}Whisk AI Chat Test Suite${RESET}`);
  console.log(`${DIM}Endpoint: ${BASE_URL}/api/ai/chat${RESET}`);
  console.log(`${DIM}Tests: ${tests.length}${RESET}\n`);

  // Quick auth check
  console.log(`${DIM}Verifying auth token...${RESET}`);
  const authCheck = await callChat("hello", {
    includeSeasonalContext: false,
    includeMealPlan: false,
    includeShoppingList: false,
    includePreferences: false,
  });

  if (!authCheck.ok) {
    console.error(`${RED}Auth check failed (HTTP ${authCheck.status}): ${authCheck.content.slice(0, 200)}${RESET}`);
    if (authCheck.status === 401 || authCheck.status === 403) {
      console.error(`${YELLOW}Token may be expired or invalid. Get a fresh one from the app.${RESET}`);
    }
    process.exit(1);
  }
  console.log(`${GREEN}Auth OK${RESET}\n`);

  const outcomes: TestOutcome[] = [];

  for (const test of tests) {
    process.stdout.write(`${CYAN}Running:${RESET} ${test.name}... `);

    const start = performance.now();
    const result = await callChat(test.prompt, test.options);
    const durationMs = Math.round(performance.now() - start);

    if (!result.ok) {
      const outcome: TestOutcome = {
        name: test.name,
        pass: false,
        reason: `HTTP ${result.status}: ${result.content.slice(0, 100)}`,
        warnings: [],
        durationMs,
        httpStatus: result.status,
      };
      outcomes.push(outcome);
      console.log(`${RED}FAIL${RESET} ${DIM}(${durationMs}ms)${RESET}`);
      console.log(`  ${RED}${outcome.reason}${RESET}`);
      continue;
    }

    if (VERBOSE) {
      console.log("");
      console.log(`  ${DIM}Prompt: "${test.prompt}"${RESET}`);
      console.log(`  ${DIM}Response (${result.content.length} chars):${RESET}`);
      const lines = result.content.split("\n");
      for (const line of lines) {
        console.log(`  ${DIM}| ${line}${RESET}`);
      }
    }

    const validation = test.validate(result.content);
    const outcome: TestOutcome = {
      name: test.name,
      pass: validation.pass,
      reason: validation.reason,
      warnings: validation.warnings ?? [],
      durationMs,
      httpStatus: result.status,
    };
    outcomes.push(outcome);

    if (validation.pass) {
      console.log(`${GREEN}PASS${RESET} ${DIM}(${durationMs}ms)${RESET}`);
    } else {
      console.log(`${RED}FAIL${RESET} ${DIM}(${durationMs}ms)${RESET}`);
      console.log(`  ${RED}${validation.reason}${RESET}`);
    }

    for (const warning of validation.warnings ?? []) {
      console.log(`  ${YELLOW}WARNING: ${warning}${RESET}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────

  console.log(`\n${BOLD}${"=".repeat(50)}${RESET}`);
  console.log(`${BOLD}Summary${RESET}\n`);

  const passed = outcomes.filter((o) => o.pass).length;
  const failed = outcomes.filter((o) => !o.pass).length;
  const totalWarnings = outcomes.reduce((sum, o) => sum + o.warnings.length, 0);
  const avgDuration = Math.round(
    outcomes.reduce((sum, o) => sum + o.durationMs, 0) / outcomes.length
  );

  for (const o of outcomes) {
    const icon = o.pass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    const warn = o.warnings.length > 0 ? ` ${YELLOW}(${o.warnings.length} warning${o.warnings.length > 1 ? "s" : ""})${RESET}` : "";
    console.log(`  ${icon} ${o.name}${warn} ${DIM}${o.durationMs}ms${RESET}`);
  }

  console.log("");
  console.log(`  ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : DIM}${failed} failed${RESET}, ${totalWarnings > 0 ? YELLOW : DIM}${totalWarnings} warnings${RESET}`);
  console.log(`  ${DIM}Avg response time: ${avgDuration}ms${RESET}`);
  console.log("");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
