// MCP tool implementations for Whisk (phase 1).
// Writes are add-only where applicable; never delete recipes or clear plans.
// Attribution: household owner via resolveMcpActor (see mcp-actor.ts).

import { normalizeRecipeInput } from "./recipe-input";
import { resolveMcpActor, type McpActor } from "./mcp-actor";
import { onRequestPost as importUrlPost } from "../api/import/url";

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
