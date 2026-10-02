// MCP tool implementations for Whisk (phase 1–2 reads + v2 write/destructive).
// Destructive tools require confirm===true AND matching confirmName or no-op 400.
// Attribution: household owner via resolveMcpActor (see mcp-actor.ts).

import { normalizeRecipeInput } from "./recipe-input";
import { resolveMcpActor, type McpActor } from "./mcp-actor";
import { onRequestPost as importUrlPost } from "../api/import/url";
import { queryRecipes } from "./embeddings";
import { DEFAULT_DISCOVER_CONFIG } from "./discover-config";

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolEnv = {
  WHISK_KV: KVNamespace;
  WHISK_R2?: R2Bucket;
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
  WHISK_MCP_TOKEN?: string;
  // Optional secrets used by import/url (never required for read tools)
  GROQ_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  CF_ACCOUNT_ID?: string;
  CF_BR_TOKEN?: string;
  APIFY_API_TOKEN?: string;
  UNSPLASH_ACCESS_KEY?: string;
};

type RecipeIndexEntry = {
  id: string;
  title: string;
  tags: string[];
  cuisine?: string;
  favorite: boolean;
  favoritedBy?: string[];
  wantToMake?: boolean;
  updatedAt: string;
  thumbnailUrl?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  description?: string;
  ingredientCount?: number;
  stepCount?: number;
  difficulty?: "easy" | "medium" | "hard";
  ingredientNames?: string[];
  sourceUrl?: string;
  sourceRating?: number;
  sourceRatingCount?: number;
};

type MealSlot = "breakfast" | "lunch" | "dinner" | "snack" | "dessert" | "extra";

type PlannedMeal = {
  id: string;
  date: string;
  slot: MealSlot;
  recipeId?: string;
  title: string;
  notes?: string;
  completed?: boolean;
  sourceRecipeServings?: number;
};

type MealPlan = {
  id: string;
  meals: PlannedMeal[];
  updatedAt: string;
};

const VALID_PLAN_ID = /^(current|\d{4}-W\d{2})$/;
const MEAL_SLOTS: MealSlot[] = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "dessert",
  "extra",
];

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "search_recipes",
    description:
      "Search recipes:index in WHISK_KV. Filters query against title, tags, ingredientNames, cuisine. Limit ~20.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search string (case-insensitive)" },
        limit: { type: "number", description: "Max results, default 20" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_recipe",
    description: "Load full recipe from KV key recipe:{id}.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_favorites",
    description:
      "Index entries where favoritedBy includes the MCP actor (household owner), or favorite===true when no per-user favoritedBy data.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_want_to_make",
    description: "Index entries with wantToMake true.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_meal_plan",
    description: "Load plan:{week} from KV. week defaults to current.",
    inputSchema: {
      type: "object",
      properties: {
        week: {
          type: "string",
          description: 'Plan id: "current" or YYYY-Www (e.g. 2026-W40). Default current.',
        },
      },
    },
  },
  {
    name: "list_shopping",
    description: "Load shopping:current from KV.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_recipe",
    description:
      "Add-only create a recipe (normalizeRecipeInput). Never deletes. createdBy = household owner.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        ingredients: { type: "array" },
        steps: { type: "array" },
        tags: { type: "array", items: { type: "string" } },
        cuisine: { type: "string" },
        prepTime: { type: "number" },
        cookTime: { type: "number" },
        servings: { type: "number" },
        notes: { type: "string" },
        favorite: { type: "boolean" },
        wantToMake: { type: "boolean" },
        source: { type: "object" },
        photos: { type: "array" },
        thumbnailUrl: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "add_to_favorites",
    description:
      "Add household-owner userId to favoritedBy and set favorite true. Never removes other users.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Recipe id" } },
      required: ["id"],
    },
  },
  {
    name: "add_to_meal_plan",
    description:
      "Append a PlannedMeal to plan:{week} for a date/slot. Does not clear existing meals.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "string", description: 'Default "current"' },
        date: { type: "string", description: "YYYY-MM-DD" },
        slot: {
          type: "string",
          enum: ["breakfast", "lunch", "dinner", "snack", "dessert", "extra"],
        },
        title: { type: "string" },
        recipeId: { type: "string" },
        notes: { type: "string" },
      },
      required: ["date", "slot", "title"],
    },
  },
  {
    name: "import_recipe_url",
    description:
      "Fetch+parse a recipe URL via existing import/url logic. Default dry-run (return parsed only). Persist only when save:true (then createdBy = household owner).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        save: {
          type: "boolean",
          description: "When true, persist as a new recipe. Default false (dry-run).",
        },
        downloadImage: { type: "boolean", description: "Passed to import/url. Default false." },
      },
      required: ["url"],
    },
  },
  {
    name: "list_tags",
    description:
      "Load tags:index from WHISK_KV (same shape as GET /api/tags). Returns { tags, updatedAt } or empty defaults.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_discover_feed",
    description:
      "Read-only discover feed from KV (discover_archive, fallback discover_feed). Returns compact items (no long descriptions). Optional source/category filters and limit.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Filter by source id (e.g. nyt)" },
        category: { type: "string", description: "Filter by category (e.g. dinner)" },
        limit: { type: "number", description: "Max items, default 40, max 100" },
        includeExpired: {
          type: "boolean",
          description: "When true, include expired items. Default false.",
        },
      },
    },
  },
  {
    name: "get_discover_item",
    description:
      "Load one discover archive item by url or id (id may be the stored url). Matches normalized url key.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Item id or url as stored" },
        url: { type: "string", description: "Item url (alternative to id)" },
      },
    },
  },
  {
    name: "search_semantic",
    description:
      "Semantic recipe search via Workers AI embeddings + Vectorize. Requires VECTORIZE + AI bindings; otherwise returns { error: \"vectorize_unavailable\" }.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query" },
        topK: { type: "number", description: "Max matches, default 10, max 30" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_settings_public",
    description:
      "Non-secret public settings only: capability flags, AI provider/model prefs (no keys), discover config flags/sources. Never returns APP_SECRET, WHISK_MCP_TOKEN, API keys, session or CF tokens.",
    inputSchema: { type: "object", properties: {} },
  },

  {
    name: "remove_from_favorites",
    description:
      "Remove household-owner userId from favoritedBy only (never wipe other users). Updates favorite flag + index.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Recipe id" } },
      required: ["id"],
    },
  },
  {
    name: "set_want_to_make",
    description: "Set wantToMake boolean on a recipe + update index.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Recipe id" },
        wantToMake: { type: "boolean" },
      },
      required: ["id", "wantToMake"],
    },
  },
  {
    name: "remove_from_meal_plan",
    description:
      "Remove one PlannedMeal by exact mealId from plan:{week}. week defaults to current. Refuses if meal not found.",
    inputSchema: {
      type: "object",
      properties: {
        mealId: { type: "string" },
        week: { type: "string", description: 'Default "current"' },
      },
      required: ["mealId"],
    },
  },
  {
    name: "clear_meal_plan",
    description:
      "DESTRUCTIVE: empty meals for plan:{week}. Requires confirm===true AND confirmName===week id (e.g. \"current\" or \"2026-W10\"). Else {error,status:400} isError with no mutation.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "string", description: 'Default "current"' },
        confirm: { type: "boolean", description: "Must be true" },
        confirmName: {
          type: "string",
          description: "Must exactly equal the week id being cleared",
        },
      },
      required: ["confirm", "confirmName"],
    },
  },
  {
    name: "delete_recipe",
    description:
      "DESTRUCTIVE: delete recipe by exact id (KV + index + Vectorize if available). Requires confirm===true AND confirmName===current title exactly. Else {error,status:400} isError with no mutation. Never deletes by title alone.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        confirm: { type: "boolean", description: "Must be true" },
        confirmName: {
          type: "string",
          description: "Must exactly equal the recipe's current title",
        },
      },
      required: ["id", "confirm", "confirmName"],
    },
  },
  {
    name: "shopping_add_item",
    description:
      "Append an item to shopping:current. Provide name or text; optional qty (→ amount) and notes.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        text: { type: "string", description: "Alias for name" },
        qty: { type: "string", description: "Optional quantity/amount" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "shopping_set_checked",
    description: "Set checked boolean on a shopping:current item by itemId.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        checked: { type: "boolean" },
      },
      required: ["itemId", "checked"],
    },
  },
  {
    name: "shopping_remove_item",
    description: "Remove one item from shopping:current by itemId.",
    inputSchema: {
      type: "object",
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
  },
  {
    name: "clear_shopping_list",
    description:
      "DESTRUCTIVE: clear all items on shopping:current. Requires confirm===true AND confirmName===\"current\". Else {error,status:400} isError with no mutation.",
    inputSchema: {
      type: "object",
      properties: {
        confirm: { type: "boolean", description: "Must be true" },
        confirmName: {
          type: "string",
          description: 'Must equal \"current\"',
        },
      },
      required: ["confirm", "confirmName"],
    },
  },
  {
    name: "update_recipe",
    description:
      "Partial update of safe recipe fields by exact id (title, description, ingredients, steps, tags, cuisine, prepTime, cookTime, servings, notes). Does not wipe favoritedBy or delete.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        ingredients: { type: "array" },
        steps: { type: "array" },
        tags: { type: "array", items: { type: "string" } },
        cuisine: { type: "string" },
        prepTime: { type: "number" },
        cookTime: { type: "number" },
        servings: { type: "number" },
        notes: { type: "string" },
      },
      required: ["id"],
    },
  },

];

function textResult(
  payload: unknown,
  isError = false
): { content: { type: "text"; text: string }[]; isError?: boolean } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function parsePositiveInt(raw: unknown, fallback: number, max?: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const v = Math.trunc(n);
  return max !== undefined ? Math.min(v, max) : v;
}

function computeDifficulty(
  totalMinutes: number,
  ingredientCount: number,
  stepCount: number
): "easy" | "medium" | "hard" {
  const t = totalMinutes <= 0 ? 1 : totalMinutes <= 35 ? 0 : totalMinutes <= 60 ? 1 : 2;
  const i = ingredientCount <= 7 ? 0 : ingredientCount <= 12 ? 1 : 2;
  const s = stepCount <= 5 ? 0 : stepCount <= 10 ? 1 : 2;
  const score = t + i + s;
  return score <= 2 ? "easy" : score <= 4 ? "medium" : "hard";
}

async function loadIndex(env: McpToolEnv): Promise<RecipeIndexEntry[]> {
  return (
    ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[] | null) ?? []
  );
}

function matchesQuery(entry: RecipeIndexEntry, q: string): boolean {
  if (!q) return true;
  const hay = [
    entry.title,
    entry.cuisine ?? "",
    ...(entry.tags ?? []),
    ...(entry.ingredientNames ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

async function persistNewRecipe(
  env: McpToolEnv,
  raw: unknown,
  actor: McpActor,
  favorite = false
): Promise<{ recipe: Record<string, unknown>; entry: RecipeIndexEntry }> {
  const normalized = normalizeRecipeInput({
    ...(typeof raw === "object" && raw && !Array.isArray(raw) ? raw : {}),
    favorite: favorite || Boolean((raw as { favorite?: boolean })?.favorite),
  });
  if (!normalized) throw new Error("Recipe title is required");

  const id = `r_${crypto.randomUUID().split("-")[0]}`;
  const now = new Date().toISOString();
  const favoritedBy: string[] =
    normalized.favorite || favorite ? [actor.userId] : [];

  const recipe: Record<string, unknown> = {
    ...normalized,
    id,
    favorite: favoritedBy.length > 0,
    favoritedBy,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.userId,
  };

  await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(recipe));

  const index = await loadIndex(env);
  const ingredientCount = normalized.ingredients.length;
  const stepCount = normalized.steps.length;
  const totalMinutes = (normalized.prepTime ?? 0) + (normalized.cookTime ?? 0);
  const entry: RecipeIndexEntry = {
    id,
    title: normalized.title,
    tags: normalized.tags,
    cuisine: normalized.cuisine,
    favorite: favoritedBy.length > 0,
    favoritedBy,
    wantToMake: normalized.wantToMake,
    updatedAt: now,
    thumbnailUrl: normalized.thumbnailUrl,
    prepTime: normalized.prepTime,
    cookTime: normalized.cookTime,
    servings: normalized.servings,
    description: normalized.description,
    ingredientCount,
    stepCount,
    difficulty: computeDifficulty(totalMinutes, ingredientCount, stepCount),
    ingredientNames: normalized.ingredients.map((i) => i.name).slice(0, 30),
    sourceUrl: (normalized.source as { url?: string } | undefined)?.url,
    sourceRating: normalized.sourceRating,
    sourceRatingCount: normalized.sourceRatingCount,
  };
  index.unshift(entry);
  await env.WHISK_KV.put("recipes:index", JSON.stringify(index));
  return { recipe, entry };
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  env: McpToolEnv
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const actor = await resolveMcpActor(env.WHISK_KV);
    switch (name) {
      case "search_recipes":
        return await toolSearchRecipes(args, env);
      case "get_recipe":
        return await toolGetRecipe(args, env);
      case "list_favorites":
        return await toolListFavorites(env, actor);
      case "list_want_to_make":
        return await toolListWantToMake(env);
      case "list_meal_plan":
        return await toolListMealPlan(args, env);
      case "list_shopping":
        return await toolListShopping(env);
      case "add_recipe":
        return await toolAddRecipe(args, env, actor);
      case "add_to_favorites":
        return await toolAddToFavorites(args, env, actor);
      case "add_to_meal_plan":
        return await toolAddToMealPlan(args, env, actor);
      case "import_recipe_url":
        return await toolImportRecipeUrl(args, env, actor);
      case "list_tags":
        return await toolListTags(env);
      case "list_discover_feed":
        return await toolListDiscoverFeed(args, env);
      case "get_discover_item":
        return await toolGetDiscoverItem(args, env);
      case "search_semantic":
        return await toolSearchSemantic(args, env);
      case "get_settings_public":
        return await toolGetSettingsPublic(env);
      case "remove_from_favorites":
        return await toolRemoveFromFavorites(args, env, actor);
      case "set_want_to_make":
        return await toolSetWantToMake(args, env, actor);
      case "remove_from_meal_plan":
        return await toolRemoveFromMealPlan(args, env, actor);
      case "clear_meal_plan":
        return await toolClearMealPlan(args, env, actor);
      case "delete_recipe":
        return await toolDeleteRecipe(args, env, actor);
      case "shopping_add_item":
        return await toolShoppingAddItem(args, env, actor);
      case "shopping_set_checked":
        return await toolShoppingSetChecked(args, env, actor);
      case "shopping_remove_item":
        return await toolShoppingRemoveItem(args, env, actor);
      case "clear_shopping_list":
        return await toolClearShoppingList(args, env, actor);
      case "update_recipe":
        return await toolUpdateRecipe(args, env, actor);
      default:
        return textResult({ error: `unknown tool: ${name}` }, true);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return textResult({ error: msg }, true);
  }
}

async function toolSearchRecipes(args: Record<string, unknown>, env: McpToolEnv) {
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  const limit = parsePositiveInt(args.limit, 20, 50);
  const index = await loadIndex(env);
  const items = index.filter((e) => matchesQuery(e, query)).slice(0, limit);
  return textResult({ query, count: items.length, items });
}

async function toolGetRecipe(args: Record<string, unknown>, env: McpToolEnv) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return textResult({ error: "id required" }, true);
  const recipe = await env.WHISK_KV.get(`recipe:${id}`, "json");
  if (!recipe) return textResult({ error: "Recipe not found", id }, true);
  return textResult({ recipe });
}

async function toolListFavorites(env: McpToolEnv, actor: McpActor) {
  const index = await loadIndex(env);
  const items = index.filter((e) => {
    const by = e.favoritedBy;
    if (Array.isArray(by) && by.length > 0) return by.includes(actor.userId);
    return e.favorite === true;
  });
  return textResult({
    actorUserId: actor.userId,
    actorSource: actor.source,
    count: items.length,
    items,
  });
}

async function toolListWantToMake(env: McpToolEnv) {
  const index = await loadIndex(env);
  const items = index.filter((e) => e.wantToMake === true);
  return textResult({ count: items.length, items });
}

async function toolListMealPlan(args: Record<string, unknown>, env: McpToolEnv) {
  const week = typeof args.week === "string" && args.week.trim() ? args.week.trim() : "current";
  if (!VALID_PLAN_ID.test(week)) {
    return textResult({ error: "Invalid week format", week }, true);
  }
  const plan =
    ((await env.WHISK_KV.get(`plan:${week}`, "json")) as MealPlan | null) ?? {
      id: week,
      meals: [],
      updatedAt: new Date().toISOString(),
    };
  return textResult({ week, plan });
}

async function toolListShopping(env: McpToolEnv) {
  const list =
    (await env.WHISK_KV.get("shopping:current", "json")) ?? {
      id: "current",
      items: [],
      updatedAt: new Date().toISOString(),
    };
  return textResult({ list });
}

async function toolAddRecipe(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const { recipe, entry } = await persistNewRecipe(env, args, actor);
  return textResult({
    ok: true,
    actorUserId: actor.userId,
    actorSource: actor.source,
    id: entry.id,
    recipe,
  });
}

async function toolAddToFavorites(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return textResult({ error: "id required" }, true);

  const existing = (await env.WHISK_KV.get(`recipe:${id}`, "json")) as Record<
    string,
    unknown
  > | null;
  if (!existing) return textResult({ error: "Recipe not found", id }, true);

  const prev = Array.isArray(existing.favoritedBy)
    ? (existing.favoritedBy as string[])
    : [];
  const favoritedBy = prev.includes(actor.userId) ? prev : [...prev, actor.userId];
  // Add-only: never remove other users from favoritedBy.
  const now = new Date().toISOString();
  const updated = {
    ...existing,
    favoritedBy,
    favorite: true,
    updatedAt: now,
  };
  await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(updated));

  const index = await loadIndex(env);
  const newIndex = index.map((e) =>
    e.id === id ? { ...e, favoritedBy, favorite: true, updatedAt: now } : e
  );
  await env.WHISK_KV.put("recipes:index", JSON.stringify(newIndex));

  return textResult({
    ok: true,
    id,
    actorUserId: actor.userId,
    actorSource: actor.source,
    already: prev.includes(actor.userId),
    favoritedBy,
  });
}

async function toolAddToMealPlan(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const week = typeof args.week === "string" && args.week.trim() ? args.week.trim() : "current";
  if (!VALID_PLAN_ID.test(week)) {
    return textResult({ error: "Invalid week format", week }, true);
  }
  const date = typeof args.date === "string" ? args.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return textResult({ error: "date required as YYYY-MM-DD" }, true);
  }
  const slotRaw = typeof args.slot === "string" ? args.slot : "";
  if (!MEAL_SLOTS.includes(slotRaw as MealSlot)) {
    return textResult({ error: "invalid slot", slot: slotRaw }, true);
  }
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (!title) return textResult({ error: "title required" }, true);

  const existing =
    ((await env.WHISK_KV.get(`plan:${week}`, "json")) as MealPlan | null) ?? {
      id: week,
      meals: [],
      updatedAt: new Date().toISOString(),
    };
  const beforeLen = existing.meals?.length ?? 0;
  const meal: PlannedMeal = {
    id: `m_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
    date,
    slot: slotRaw as MealSlot,
    title,
    recipeId: typeof args.recipeId === "string" ? args.recipeId : undefined,
    notes:
      typeof args.notes === "string"
        ? args.notes
        : `added via MCP (actor ${actor.userId})`,
  };
  const meals = [...(existing.meals ?? []), meal];
  if (meals.length < beforeLen) {
    return textResult({ error: "refusing to shrink meal plan" }, true);
  }
  const plan: MealPlan = {
    id: existing.id || week,
    meals,
    updatedAt: new Date().toISOString(),
  };
  await env.WHISK_KV.put(`plan:${week}`, JSON.stringify(plan));
  return textResult({
    ok: true,
    week,
    actorUserId: actor.userId,
    actorSource: actor.source,
    meal,
    mealCount: plan.meals.length,
  });
}

async function toolImportRecipeUrl(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) return textResult({ error: "url required" }, true);
  const save = args.save === true;
  const downloadImage = args.downloadImage === true;

  const fakeReq = new Request("https://whisk.local/api/import/url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, downloadImage }),
  });

  // Reuse existing import/url Pages Function (parse only; it never persists).
  const ctx = {
    request: fakeReq,
    env,
    params: {},
    data: {},
    waitUntil: (_p: Promise<unknown>) => {},
    next: async () => new Response(null, { status: 404 }),
    functionPath: "/api/import/url",
  } as unknown as Parameters<typeof importUrlPost>[0];

  const res = await importUrlPost(ctx);
  const bodyText = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return textResult(
      { error: "import returned non-JSON", status: res.status, body: bodyText.slice(0, 500) },
      true
    );
  }
  if (!res.ok) {
    return textResult({ error: "import failed", status: res.status, body: parsed }, true);
  }

  if (!save) {
    return textResult({
      dryRun: true,
      saved: false,
      actorUserId: actor.userId,
      actorSource: actor.source,
      recipe: parsed,
    });
  }

  // Map common import shapes (title vs name) into normalizeRecipeInput.
  const raw =
    parsed && typeof parsed === "object"
      ? {
          ...(parsed as Record<string, unknown>),
          title:
            (parsed as { title?: string; name?: string }).title ??
            (parsed as { name?: string }).name,
        }
      : parsed;

  const { recipe, entry } = await persistNewRecipe(env, raw, actor);
  return textResult({
    dryRun: false,
    saved: true,
    actorUserId: actor.userId,
    actorSource: actor.source,
    id: entry.id,
    recipe,
  });
}


// ── Phase 2 read tools ──────────────────────────────────

type DiscoverArchiveItem = {
  title: string;
  url: string;
  imageUrl?: string;
  description?: string;
  source?: string;
  category?: string;
  addedAt?: string;
  expiresAt?: string;
  tags?: string[];
  totalTime?: number;
};

type CompactDiscoverItem = {
  title: string;
  url: string;
  source?: string;
  category?: string;
  tags?: string[];
  imageUrl?: string;
  addedAt?: string;
  expiresAt?: string;
  totalTime?: number;
  description?: string;
};

function normalizeDiscoverUrl(url: string): string {
  return url.replace(/\/$/, "").replace(/^http:/, "https:");
}

function toCompactDiscover(item: DiscoverArchiveItem): CompactDiscoverItem {
  const desc =
    typeof item.description === "string" && item.description.trim()
      ? item.description.trim().slice(0, 160)
      : undefined;
  return {
    title: item.title,
    url: item.url,
    source: item.source,
    category: item.category,
    tags: item.tags,
    imageUrl: item.imageUrl,
    addedAt: item.addedAt,
    expiresAt: item.expiresAt,
    totalTime: item.totalTime,
    ...(desc ? { description: desc } : {}),
  };
}

function isDiscoverExpired(item: DiscoverArchiveItem, nowMs: number): boolean {
  if (!item.expiresAt) return false;
  const t = new Date(item.expiresAt).getTime();
  return Number.isFinite(t) && t <= nowMs;
}

async function loadDiscoverItems(env: McpToolEnv): Promise<{
  lastRefreshed: string | null;
  items: DiscoverArchiveItem[];
  source: "discover_archive" | "discover_feed" | "empty";
}> {
  const archive = (await env.WHISK_KV.get("discover_archive", "json")) as {
    lastRefreshed?: string;
    items?: DiscoverArchiveItem[];
  } | null;
  if (archive && Array.isArray(archive.items)) {
    return {
      lastRefreshed: archive.lastRefreshed ?? null,
      items: archive.items,
      source: "discover_archive",
    };
  }

  const legacy = (await env.WHISK_KV.get("discover_feed", "json")) as {
    lastRefreshed?: string;
    sources?: Record<string, DiscoverArchiveItem[]>;
    categories?: Record<string, DiscoverArchiveItem[]>;
  } | null;
  if (legacy) {
    const items: DiscoverArchiveItem[] = [];
    if (legacy.categories && typeof legacy.categories === "object") {
      for (const [cat, list] of Object.entries(legacy.categories)) {
        if (!Array.isArray(list)) continue;
        for (const it of list) {
          items.push({ ...it, category: it.category ?? cat });
        }
      }
    } else if (legacy.sources && typeof legacy.sources === "object") {
      for (const [src, list] of Object.entries(legacy.sources)) {
        if (!Array.isArray(list)) continue;
        for (const it of list) {
          items.push({ ...it, source: it.source ?? src });
        }
      }
    }
    return {
      lastRefreshed: legacy.lastRefreshed ?? null,
      items,
      source: "discover_feed",
    };
  }

  return { lastRefreshed: null, items: [], source: "empty" };
}

async function toolListTags(env: McpToolEnv) {
  const tags =
    ((await env.WHISK_KV.get("tags:index", "json")) as {
      tags?: unknown[];
      updatedAt?: string;
    } | null) ?? null;
  if (!tags) {
    return textResult({ tags: [], updatedAt: null });
  }
  return textResult({
    tags: Array.isArray(tags.tags) ? tags.tags : [],
    updatedAt: tags.updatedAt ?? null,
  });
}

async function toolListDiscoverFeed(args: Record<string, unknown>, env: McpToolEnv) {
  const { lastRefreshed, items, source } = await loadDiscoverItems(env);
  const sourceFilter =
    typeof args.source === "string" && args.source.trim()
      ? args.source.trim().toLowerCase()
      : "";
  const categoryFilter =
    typeof args.category === "string" && args.category.trim()
      ? args.category.trim().toLowerCase()
      : "";
  const includeExpired = args.includeExpired === true;
  const limit = parsePositiveInt(args.limit, 40, 100);
  const now = Date.now();

  const filtered = items.filter((it) => {
    if (!includeExpired && isDiscoverExpired(it, now)) return false;
    if (sourceFilter && (it.source ?? "").toLowerCase() !== sourceFilter) return false;
    if (categoryFilter && (it.category ?? "").toLowerCase() !== categoryFilter) return false;
    return Boolean(it.url && it.title);
  });

  const compact = filtered.slice(0, limit).map(toCompactDiscover);
  return textResult({
    lastRefreshed,
    kvSource: source,
    count: compact.length,
    totalMatching: filtered.length,
    items: compact,
  });
}

async function toolGetDiscoverItem(args: Record<string, unknown>, env: McpToolEnv) {
  const raw =
    (typeof args.url === "string" && args.url.trim()) ||
    (typeof args.id === "string" && args.id.trim()) ||
    "";
  if (!raw) return textResult({ error: "id or url required" }, true);

  const { items, source } = await loadDiscoverItems(env);
  const key = normalizeDiscoverUrl(raw);
  const found = items.find((it) => {
    if (!it.url) return false;
    return normalizeDiscoverUrl(it.url) === key || it.url === raw;
  });
  if (!found) {
    return textResult({ error: "Discover item not found", id: raw, kvSource: source }, true);
  }
  return textResult({ kvSource: source, item: found });
}

async function toolSearchSemantic(args: Record<string, unknown>, env: McpToolEnv) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return textResult({ error: "query required" }, true);

  if (!env.AI || !env.VECTORIZE) {
    return textResult({ error: "vectorize_unavailable" }, true);
  }

  const topK = parsePositiveInt(args.topK, 10, 30);
  const matches = await queryRecipes(env.AI, env.VECTORIZE, query, topK);
  const index = await loadIndex(env);
  const byId = new Map(index.map((e) => [e.id, e]));

  const items = matches.map((m) => {
    const entry = byId.get(m.id);
    const metaTitle =
      m.metadata && typeof (m.metadata as { title?: unknown }).title === "string"
        ? (m.metadata as { title: string }).title
        : undefined;
    return {
      id: m.id,
      score: m.score,
      title: entry?.title ?? metaTitle,
      tags: entry?.tags,
      cuisine: entry?.cuisine,
      thumbnailUrl: entry?.thumbnailUrl,
    };
  });

  return textResult({ query, count: items.length, items });
}

async function toolGetSettingsPublic(env: McpToolEnv) {
  // Capability flags only — never surface secret values or token strings.
  const aiConfig = (await env.WHISK_KV.get("ai_config", "json")) as Record<
    string,
    unknown
  > | null;
  const discoverRaw = (await env.WHISK_KV.get("discover_config", "json")) as {
    sources?: { id: string; label: string; url?: string; feedUrl?: string; enabled: boolean }[];
    autoRefreshEnabled?: boolean;
    expirationEnabled?: boolean;
    itemLifetimeDays?: number;
    refreshIntervalDays?: number;
  } | null;

  const discover = discoverRaw ?? DEFAULT_DISCOVER_CONFIG;
  const publicDiscover = {
    autoRefreshEnabled: discover.autoRefreshEnabled ?? DEFAULT_DISCOVER_CONFIG.autoRefreshEnabled,
    expirationEnabled: discover.expirationEnabled ?? DEFAULT_DISCOVER_CONFIG.expirationEnabled,
    itemLifetimeDays: discover.itemLifetimeDays ?? DEFAULT_DISCOVER_CONFIG.itemLifetimeDays,
    refreshIntervalDays:
      discover.refreshIntervalDays ?? DEFAULT_DISCOVER_CONFIG.refreshIntervalDays,
    sources: (discover.sources ?? DEFAULT_DISCOVER_CONFIG.sources).map((s) => ({
      id: s.id,
      label: s.label,
      enabled: s.enabled,
      // Public homepage URL is fine; omit feedUrl to reduce scrape-target surface.
      url: s.url,
    })),
  };

  // Strip any accidental secret-looking keys from ai_config (defense in depth).
  const safeAi =
    aiConfig && typeof aiConfig === "object" && !Array.isArray(aiConfig)
      ? sanitizePublicObject(aiConfig)
      : null;

  return textResult({
    capabilities: {
      vectorize: Boolean(env.AI && env.VECTORIZE),
      workersAi: Boolean(env.AI),
      r2: Boolean(env.WHISK_R2),
      // Presence flags only — never return the secret values.
      hasGroq: Boolean(env.GROQ_API_KEY),
      hasCerebras: Boolean(env.CEREBRAS_API_KEY),
      hasBrowserRendering: Boolean(env.CF_ACCOUNT_ID && env.CF_BR_TOKEN),
      hasApify: Boolean(env.APIFY_API_TOKEN),
    },
    aiConfig: safeAi,
    discover: publicDiscover,
    notes: [
      "Theme, units, and user preferences are client-local (not in KV).",
      "Secrets (APP_SECRET, WHISK_MCP_TOKEN, API keys, session/CF tokens) are never returned.",
    ],
  });
}

const SECRET_KEY_RE =
  /(secret|token|password|api[_-]?key|authorization|bearer|cookie|session|private[_-]?key|credential)/i;

function sanitizePublicObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_RE.test(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizePublicObject(v as Record<string, unknown>);
    } else if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      v === null ||
      Array.isArray(v)
    ) {
      if (Array.isArray(v)) {
        out[k] = v.map((item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? sanitizePublicObject(item as Record<string, unknown>)
            : item
        );
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}


// ── v2 write / destructive tools ────────────────────────

type ShoppingItem = {
  id: string;
  name: string;
  amount?: string;
  unit?: string;
  category: string;
  checked: boolean;
  notes?: string;
  addedBy?: string;
  addedByUser?: string;
};

type ShoppingList = {
  id: string;
  items: ShoppingItem[];
  updatedAt: string;
};

function actorMeta(actor: McpActor) {
  return { actorUserId: actor.userId, actorSource: actor.source };
}

function confirmGate(
  confirm: unknown,
  confirmName: unknown,
  expectedName: string,
  actor: McpActor
): { content: { type: "text"; text: string }[]; isError?: boolean } | null {
  const nameOk =
    typeof confirmName === "string" && confirmName === expectedName;
  if (confirm === true && nameOk) return null;
  return textResult(
    {
      error: "Confirmation required: confirm must be true and confirmName must match",
      status: 400,
      expectedConfirmName: expectedName,
      ...actorMeta(actor),
    },
    true
  );
}

async function loadShopping(env: McpToolEnv): Promise<ShoppingList> {
  return (
    ((await env.WHISK_KV.get("shopping:current", "json")) as ShoppingList | null) ?? {
      id: "current",
      items: [],
      updatedAt: new Date().toISOString(),
    }
  );
}

async function toolRemoveFromFavorites(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return textResult({ error: "id required", ...actorMeta(actor) }, true);

  const existing = (await env.WHISK_KV.get(`recipe:${id}`, "json")) as Record<
    string,
    unknown
  > | null;
  if (!existing) return textResult({ error: "Recipe not found", id, ...actorMeta(actor) }, true);

  const prev = Array.isArray(existing.favoritedBy)
    ? (existing.favoritedBy as string[])
    : [];
  const favoritedBy = prev.filter((uid) => uid !== actor.userId);
  const now = new Date().toISOString();
  const favorite = favoritedBy.length > 0;
  const updated = { ...existing, favoritedBy, favorite, updatedAt: now };
  await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(updated));

  const index = await loadIndex(env);
  const newIndex = index.map((e) =>
    e.id === id ? { ...e, favoritedBy, favorite, updatedAt: now } : e
  );
  await env.WHISK_KV.put("recipes:index", JSON.stringify(newIndex));

  return textResult({
    ok: true,
    id,
    ...actorMeta(actor),
    removed: prev.includes(actor.userId),
    favoritedBy,
    favorite,
  });
}

async function toolSetWantToMake(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return textResult({ error: "id required", ...actorMeta(actor) }, true);
  if (typeof args.wantToMake !== "boolean") {
    return textResult({ error: "wantToMake boolean required", ...actorMeta(actor) }, true);
  }
  const wantToMake = args.wantToMake;

  const existing = (await env.WHISK_KV.get(`recipe:${id}`, "json")) as Record<
    string,
    unknown
  > | null;
  if (!existing) return textResult({ error: "Recipe not found", id, ...actorMeta(actor) }, true);

  const now = new Date().toISOString();
  const updated = { ...existing, wantToMake, updatedAt: now };
  await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(updated));

  const index = await loadIndex(env);
  const newIndex = index.map((e) =>
    e.id === id ? { ...e, wantToMake, updatedAt: now } : e
  );
  await env.WHISK_KV.put("recipes:index", JSON.stringify(newIndex));

  return textResult({
    ok: true,
    id,
    wantToMake,
    ...actorMeta(actor),
  });
}

async function toolRemoveFromMealPlan(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const mealId = typeof args.mealId === "string" ? args.mealId.trim() : "";
  if (!mealId) return textResult({ error: "mealId required", ...actorMeta(actor) }, true);
  const week =
    typeof args.week === "string" && args.week.trim() ? args.week.trim() : "current";
  if (!VALID_PLAN_ID.test(week)) {
    return textResult({ error: "Invalid week format", week, ...actorMeta(actor) }, true);
  }

  const existing =
    ((await env.WHISK_KV.get(`plan:${week}`, "json")) as MealPlan | null) ?? {
      id: week,
      meals: [],
      updatedAt: new Date().toISOString(),
    };
  const before = existing.meals ?? [];
  const found = before.find((m) => m.id === mealId);
  if (!found) {
    return textResult(
      { error: "Meal not found", mealId, week, ...actorMeta(actor) },
      true
    );
  }
  const meals = before.filter((m) => m.id !== mealId);
  const plan: MealPlan = {
    id: existing.id || week,
    meals,
    updatedAt: new Date().toISOString(),
  };
  await env.WHISK_KV.put(`plan:${week}`, JSON.stringify(plan));
  return textResult({
    ok: true,
    week,
    removedMealId: mealId,
    mealCount: plan.meals.length,
    ...actorMeta(actor),
  });
}

async function toolClearMealPlan(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const week =
    typeof args.week === "string" && args.week.trim() ? args.week.trim() : "current";
  if (!VALID_PLAN_ID.test(week)) {
    return textResult({ error: "Invalid week format", week, status: 400, ...actorMeta(actor) }, true);
  }
  const gate = confirmGate(args.confirm, args.confirmName, week, actor);
  if (gate) return gate;

  const existing =
    ((await env.WHISK_KV.get(`plan:${week}`, "json")) as MealPlan | null) ?? {
      id: week,
      meals: [],
      updatedAt: new Date().toISOString(),
    };
  const clearedCount = existing.meals?.length ?? 0;
  const plan: MealPlan = {
    id: existing.id || week,
    meals: [],
    updatedAt: new Date().toISOString(),
  };
  await env.WHISK_KV.put(`plan:${week}`, JSON.stringify(plan));
  console.log(
    `[mcp] clear_meal_plan week=${week} cleared=${clearedCount} actorUserId=${actor.userId}`
  );
  return textResult({
    ok: true,
    week,
    clearedCount,
    plan,
    ...actorMeta(actor),
  });
}

async function toolDeleteRecipe(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return textResult({ error: "id required", status: 400, ...actorMeta(actor) }, true);

  const existing = (await env.WHISK_KV.get(`recipe:${id}`, "json")) as Record<
    string,
    unknown
  > | null;
  if (!existing) {
    return textResult({ error: "Recipe not found", id, status: 404, ...actorMeta(actor) }, true);
  }
  const title = typeof existing.title === "string" ? existing.title : "";
  const gate = confirmGate(args.confirm, args.confirmName, title, actor);
  if (gate) return gate;

  await env.WHISK_KV.delete(`recipe:${id}`);
  const index = await loadIndex(env);
  const newIndex = index.filter((e) => e.id !== id);
  await env.WHISK_KV.put("recipes:index", JSON.stringify(newIndex));

  if (env.VECTORIZE) {
    try {
      await env.VECTORIZE.deleteByIds([id]);
    } catch {
      // best-effort, mirror API waitUntil(...).catch
    }
  }

  console.log(
    `[mcp] delete_recipe id=${id} title=${JSON.stringify(title)} actorUserId=${actor.userId}`
  );
  return textResult({
    ok: true,
    id,
    title,
    ...actorMeta(actor),
  });
}

async function toolShoppingAddItem(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const nameRaw =
    (typeof args.name === "string" && args.name.trim()) ||
    (typeof args.text === "string" && args.text.trim()) ||
    "";
  if (!nameRaw) {
    return textResult({ error: "name or text required", ...actorMeta(actor) }, true);
  }
  const qty =
    typeof args.qty === "string" && args.qty.trim()
      ? args.qty.trim()
      : typeof args.qty === "number" && Number.isFinite(args.qty)
        ? String(args.qty)
        : undefined;
  const notes =
    typeof args.notes === "string" && args.notes.trim() ? args.notes.trim() : undefined;

  const list = await loadShopping(env);
  const item: ShoppingItem = {
    id: `s_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
    name: nameRaw,
    ...(qty ? { amount: qty } : {}),
    category: "other",
    checked: false,
    addedBy: "manual",
    addedByUser: actor.name,
    ...(notes ? { notes } : {}),
  };
  const updated: ShoppingList = {
    id: list.id || "current",
    items: [...(list.items ?? []), item],
    updatedAt: new Date().toISOString(),
  };
  await env.WHISK_KV.put("shopping:current", JSON.stringify(updated));
  return textResult({
    ok: true,
    item,
    itemCount: updated.items.length,
    ...actorMeta(actor),
  });
}

async function toolShoppingSetChecked(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const itemId = typeof args.itemId === "string" ? args.itemId.trim() : "";
  if (!itemId) return textResult({ error: "itemId required", ...actorMeta(actor) }, true);
  if (typeof args.checked !== "boolean") {
    return textResult({ error: "checked boolean required", ...actorMeta(actor) }, true);
  }
  const list = await loadShopping(env);
  const idx = (list.items ?? []).findIndex((i) => i.id === itemId);
  if (idx < 0) {
    return textResult({ error: "Item not found", itemId, ...actorMeta(actor) }, true);
  }
  const items = list.items.map((i) =>
    i.id === itemId ? { ...i, checked: args.checked as boolean } : i
  );
  const updated: ShoppingList = {
    id: list.id || "current",
    items,
    updatedAt: new Date().toISOString(),
  };
  await env.WHISK_KV.put("shopping:current", JSON.stringify(updated));
  return textResult({
    ok: true,
    itemId,
    checked: args.checked,
    ...actorMeta(actor),
  });
}

async function toolShoppingRemoveItem(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const itemId = typeof args.itemId === "string" ? args.itemId.trim() : "";
  if (!itemId) return textResult({ error: "itemId required", ...actorMeta(actor) }, true);
  const list = await loadShopping(env);
  const before = list.items ?? [];
  if (!before.some((i) => i.id === itemId)) {
    return textResult({ error: "Item not found", itemId, ...actorMeta(actor) }, true);
  }
  const updated: ShoppingList = {
    id: list.id || "current",
    items: before.filter((i) => i.id !== itemId),
    updatedAt: new Date().toISOString(),
  };
  await env.WHISK_KV.put("shopping:current", JSON.stringify(updated));
  return textResult({
    ok: true,
    itemId,
    itemCount: updated.items.length,
    ...actorMeta(actor),
  });
}

async function toolClearShoppingList(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const gate = confirmGate(args.confirm, args.confirmName, "current", actor);
  if (gate) return gate;

  const list = await loadShopping(env);
  const clearedCount = list.items?.length ?? 0;
  const updated: ShoppingList = {
    id: "current",
    items: [],
    updatedAt: new Date().toISOString(),
  };
  await env.WHISK_KV.put("shopping:current", JSON.stringify(updated));
  console.log(
    `[mcp] clear_shopping_list cleared=${clearedCount} actorUserId=${actor.userId}`
  );
  return textResult({
    ok: true,
    clearedCount,
    list: updated,
    ...actorMeta(actor),
  });
}

const UPDATE_SAFE_FIELDS = new Set([
  "title",
  "description",
  "ingredients",
  "steps",
  "tags",
  "cuisine",
  "prepTime",
  "cookTime",
  "servings",
  "notes",
]);

async function toolUpdateRecipe(
  args: Record<string, unknown>,
  env: McpToolEnv,
  actor: McpActor
) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return textResult({ error: "id required", ...actorMeta(actor) }, true);

  const existing = (await env.WHISK_KV.get(`recipe:${id}`, "json")) as Record<
    string,
    unknown
  > | null;
  if (!existing) return textResult({ error: "Recipe not found", id, ...actorMeta(actor) }, true);

  const patch: Record<string, unknown> = {};
  for (const key of UPDATE_SAFE_FIELDS) {
    if (!(key in args)) continue;
    const v = args[key];
    if (key === "title") {
      if (typeof v !== "string" || !v.trim()) {
        return textResult({ error: "title must be a non-empty string", ...actorMeta(actor) }, true);
      }
      patch.title = v.trim();
    } else if (key === "description" || key === "cuisine" || key === "notes") {
      if (v === null) {
        patch[key] = undefined;
      } else if (typeof v === "string") {
        patch[key] = v;
      } else {
        return textResult({ error: `${key} must be a string`, ...actorMeta(actor) }, true);
      }
    } else if (key === "prepTime" || key === "cookTime" || key === "servings") {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        return textResult({ error: `${key} must be a number`, ...actorMeta(actor) }, true);
      }
      patch[key] = v;
    } else if (key === "tags") {
      if (!Array.isArray(v)) {
        return textResult({ error: "tags must be an array", ...actorMeta(actor) }, true);
      }
      patch.tags = v.filter((t): t is string => typeof t === "string");
    } else if (key === "ingredients" || key === "steps") {
      if (!Array.isArray(v)) {
        return textResult({ error: `${key} must be an array`, ...actorMeta(actor) }, true);
      }
      patch[key] = v;
    }
  }

  if (Object.keys(patch).length === 0) {
    return textResult(
      { error: "No safe fields to update", id, ...actorMeta(actor) },
      true
    );
  }

  // Never allow favoritedBy wipe / delete via this path.
  const now = new Date().toISOString();
  const updated: Record<string, unknown> = {
    ...existing,
    ...patch,
    id: existing.id,
    favoritedBy: existing.favoritedBy,
    favorite: existing.favorite,
    updatedAt: now,
  };
  await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(updated));

  const index = await loadIndex(env);
  const ingCount = Array.isArray(updated.ingredients)
    ? (updated.ingredients as unknown[]).length
    : undefined;
  const stpCount = Array.isArray(updated.steps)
    ? (updated.steps as unknown[]).length
    : undefined;
  const totalMin =
    ((updated.prepTime as number) ?? 0) + ((updated.cookTime as number) ?? 0);
  const newIndex = index.map((entry) => {
    if (entry.id !== id) return entry;
    return {
      ...entry,
      title: (updated.title as string) ?? entry.title,
      tags: (updated.tags as string[]) ?? entry.tags,
      cuisine: updated.cuisine as string | undefined,
      wantToMake: (updated.wantToMake as boolean | undefined) ?? entry.wantToMake,
      updatedAt: now,
      prepTime: updated.prepTime as number | undefined,
      cookTime: updated.cookTime as number | undefined,
      servings: updated.servings as number | undefined,
      description: updated.description as string | undefined,
      ingredientCount: ingCount ?? entry.ingredientCount,
      stepCount: stpCount ?? entry.stepCount,
      difficulty:
        ingCount !== undefined && stpCount !== undefined
          ? computeDifficulty(totalMin, ingCount, stpCount)
          : entry.difficulty,
      ingredientNames: Array.isArray(updated.ingredients)
        ? (updated.ingredients as { name?: string }[])
            .map((i) => i.name)
            .filter((n): n is string => !!n)
            .slice(0, 30)
        : entry.ingredientNames,
    };
  });
  await env.WHISK_KV.put("recipes:index", JSON.stringify(newIndex));

  return textResult({
    ok: true,
    id,
    updatedFields: Object.keys(patch),
    recipe: updated,
    ...actorMeta(actor),
  });
}
