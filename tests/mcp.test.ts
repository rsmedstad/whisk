import { describe, expect, test, beforeEach } from "bun:test";
import {
  authorizeMcp,
  resetMcpAuthLimiter,
  timingSafeEqualString,
} from "../functions/lib/mcp-auth";
import { handleMcp, type McpEnv } from "../functions/lib/mcp-handler";
import { resolveMcpActor } from "../functions/lib/mcp-actor";
import { callTool, TOOL_DEFS } from "../functions/lib/mcp-tools";

const TEST_TOKEN = "unit-test-whisk-mcp-token";

beforeEach(() => {
  resetMcpAuthLimiter();
});

function memoryKv(init: Record<string, string> = {}) {
  const store = new Map(Object.entries(init));
  return {
    store,
    async get(key: string, type?: string) {
      const raw = store.get(key) ?? null;
      if (raw === null) return null;
      if (type === "json") {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return raw;
    },
    async put(key: string, value: string, _opts?: { expirationTtl?: number }) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function env(overrides: Partial<McpEnv> = {}, kvInit?: Record<string, string>): McpEnv {
  const kv = memoryKv(kvInit);
  return {
    WHISK_KV: kv as unknown as KVNamespace,
    WHISK_MCP_TOKEN: TEST_TOKEN,
    ...overrides,
  };
}

function mcpPost(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://whisk.example/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("timingSafeEqualString", () => {
  test("equal strings", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
  });
  test("unequal strings", () => {
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
  });
  test("length mismatch", () => {
    expect(timingSafeEqualString("abc", "ab")).toBe(false);
  });
});

describe("authorizeMcp", () => {
  test("fails closed when token unset", async () => {
    const e = env({ WHISK_MCP_TOKEN: undefined });
    const res = await authorizeMcp(mcpPost({}), e);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  test("requires bearer", async () => {
    const res = await authorizeMcp(mcpPost({}), env());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.error).toContain("bearer");
    }
  });

  test("rejects wrong token", async () => {
    const res = await authorizeMcp(mcpPost({}, bearer("wrong")), env());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  test("accepts correct token", async () => {
    const res = await authorizeMcp(mcpPost({}, bearer(TEST_TOKEN)), env());
    expect(res.ok).toBe(true);
  });
});

describe("resolveMcpActor", () => {
  test("uses household owner", async () => {
    const kv = memoryKv({
      household: JSON.stringify({
        members: [
          { id: "u_erica", name: "Erica", isOwner: false },
          { id: "u_ryan", name: "Ryan", isOwner: true },
        ],
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
    const actor = await resolveMcpActor(kv as never);
    expect(actor.userId).toBe("u_ryan");
    expect(actor.source).toBe("household-owner");
  });

  test("falls back to mcp-bot when empty", async () => {
    const kv = memoryKv({});
    const actor = await resolveMcpActor(kv as never);
    expect(actor.userId).toBe("mcp-bot");
    expect(actor.source).toBe("fallback-mcp-bot");
  });
});

describe("handleMcp", () => {
  test("GET health with bearer", async () => {
    const res = await handleMcp(
      new Request("https://whisk.example/mcp", {
        method: "GET",
        headers: bearer(TEST_TOKEN),
      }),
      env()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; server: { name: string } };
    expect(body.ok).toBe(true);
    expect(body.server.name).toBe("whisk-mcp");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("POST without bearer → 401", async () => {
    const res = await handleMcp(
      mcpPost({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      env()
    );
    expect(res.status).toBe(401);
  });

  test("tools/list returns phase-1+2 tools", async () => {
    const res = await handleMcp(
      mcpPost({ jsonrpc: "2.0", id: 1, method: "tools/list" }, bearer(TEST_TOKEN)),
      env()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { tools: { name: string }[] };
    };
    const names = body.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "add_recipe",
        "add_to_favorites",
        "add_to_meal_plan",
        "clear_meal_plan",
        "clear_shopping_list",
        "delete_recipe",
        "get_discover_item",
        "get_recipe",
        "get_settings_public",
        "import_recipe_url",
        "list_discover_feed",
        "list_favorites",
        "list_meal_plan",
        "list_shopping",
        "list_tags",
        "list_want_to_make",
        "remove_from_favorites",
        "remove_from_meal_plan",
        "search_recipes",
        "search_semantic",
        "set_want_to_make",
        "shopping_add_item",
        "shopping_remove_item",
        "shopping_set_checked",
        "update_recipe",
      ].sort()
    );
  });

  test("ping", async () => {
    const res = await handleMcp(
      mcpPost({ jsonrpc: "2.0", id: 7, method: "ping" }, bearer(TEST_TOKEN)),
      env()
    );
    const body = (await res.json()) as { result: unknown };
    expect(body.result).toEqual({});
  });
});

describe("TOOL_DEFS", () => {
  test("phase 1+2+v2 has 25 tools", () => {
    expect(TOOL_DEFS.length).toBe(25);
  });
});

describe("callTool reads/writes", () => {
  const index = [
    {
      id: "r_aaa",
      title: "Garlic Pasta",
      tags: ["italian", "pasta"],
      cuisine: "Italian",
      favorite: true,
      favoritedBy: ["u_ryan"],
      wantToMake: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      ingredientNames: ["garlic", "pasta", "olive oil"],
    },
    {
      id: "r_bbb",
      title: "Tofu Stir Fry",
      tags: ["asian"],
      cuisine: "Chinese",
      favorite: false,
      favoritedBy: [],
      wantToMake: false,
      updatedAt: "2026-01-02T00:00:00.000Z",
      ingredientNames: ["tofu", "soy sauce"],
    },
  ];

  const household = {
    members: [{ id: "u_ryan", name: "Ryan", isOwner: true, joinedAt: "2026-01-01" }],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  function toolEnv() {
    return env(
      {},
      {
        "recipes:index": JSON.stringify(index),
        "recipe:r_aaa": JSON.stringify({
          id: "r_aaa",
          title: "Garlic Pasta",
          ingredients: [{ name: "garlic" }],
          steps: [{ text: "Cook" }],
          tags: ["italian"],
          favoritedBy: ["u_ryan"],
          favorite: true,
        }),
        household: JSON.stringify(household),
        "plan:current": JSON.stringify({
          id: "current",
          meals: [
            {
              id: "m_old",
              date: "2026-10-01",
              slot: "dinner",
              title: "Leftovers",
            },
          ],
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        "shopping:current": JSON.stringify({
          id: "current",
          items: [{ id: "s1", name: "milk", category: "dairy", checked: false }],
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      }
    );
  }

  test("search_recipes filters", async () => {
    const result = await callTool("search_recipes", { query: "pasta" }, toolEnv());
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.count).toBe(1);
    expect(payload.items[0].id).toBe("r_aaa");
  });

  test("get_recipe", async () => {
    const result = await callTool("get_recipe", { id: "r_aaa" }, toolEnv());
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.recipe.title).toBe("Garlic Pasta");
  });

  test("list_favorites uses owner", async () => {
    const result = await callTool("list_favorites", {}, toolEnv());
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.actorUserId).toBe("u_ryan");
    expect(payload.count).toBe(1);
  });

  test("list_want_to_make", async () => {
    const result = await callTool("list_want_to_make", {}, toolEnv());
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.count).toBe(1);
  });

  test("list_meal_plan and list_shopping", async () => {
    const plan = await callTool("list_meal_plan", {}, toolEnv());
    const shop = await callTool("list_shopping", {}, toolEnv());
    expect(JSON.parse(plan.content[0]!.text).plan.meals.length).toBe(1);
    expect(JSON.parse(shop.content[0]!.text).list.items.length).toBe(1);
  });

  test("add_recipe attributes createdBy to owner", async () => {
    const e = toolEnv();
    const result = await callTool(
      "add_recipe",
      { title: "MCP Soup", ingredients: [{ name: "water" }], steps: [{ text: "Boil" }] },
      e
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.actorUserId).toBe("u_ryan");
    expect(payload.recipe.createdBy).toBe("u_ryan");
  });

  test("add_to_favorites is add-only", async () => {
    const e = toolEnv();
    // Seed another favoriter on r_bbb then add owner
    const recipe = {
      id: "r_bbb",
      title: "Tofu Stir Fry",
      ingredients: [],
      steps: [],
      tags: [],
      favoritedBy: ["u_erica"],
      favorite: true,
    };
    await e.WHISK_KV.put("recipe:r_bbb", JSON.stringify(recipe));
    const result = await callTool("add_to_favorites", { id: "r_bbb" }, e);
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.favoritedBy).toContain("u_erica");
    expect(payload.favoritedBy).toContain("u_ryan");
  });

  test("add_to_meal_plan appends without clearing", async () => {
    const e = toolEnv();
    const result = await callTool(
      "add_to_meal_plan",
      {
        date: "2026-10-02",
        slot: "lunch",
        title: "MCP Salad",
        recipeId: "r_aaa",
      },
      e
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.mealCount).toBe(2);
    const stored = (await e.WHISK_KV.get("plan:current", "json")) as {
      meals: unknown[];
    };
    expect(stored.meals.length).toBe(2);
  });
});


describe("phase 2 read tools", () => {
  const tagsIndex = {
    tags: [
      { name: "dinner", type: "preset", group: "meal", usageCount: 3 },
      { name: "italian", type: "custom", group: "cuisine", usageCount: 1 },
    ],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const archive = {
    lastRefreshed: "2026-09-30T12:00:00.000Z",
    items: [
      {
        title: "Sheet Pan Chicken",
        url: "https://cooking.nytimes.com/recipes/123-chicken",
        source: "nyt",
        category: "dinner",
        tags: ["dinner", "chicken"],
        imageUrl: "https://example.com/chicken.jpg",
        description: "A long description that should be truncated in the compact feed listing for MCP clients that only need a short preview.",
        addedAt: "2026-09-29T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        totalTime: 45,
      },
      {
        title: "Expired Salad",
        url: "https://www.loveandlemons.com/expired-salad/",
        source: "loveandlemons",
        category: "salad",
        tags: ["salad"],
        addedAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-08T00:00:00.000Z",
      },
    ],
  };

  const aiConfig = {
    mode: "simple",
    defaultProvider: "groq",
    defaultTextModel: "llama-3.3-70b-versatile",
    apiKey: "should-never-leak",
    WHISK_MCP_TOKEN: "also-never",
  };

  function p2Env(overrides: Partial<McpEnv> = {}) {
    return env(overrides, {
      "tags:index": JSON.stringify(tagsIndex),
      discover_archive: JSON.stringify(archive),
      ai_config: JSON.stringify(aiConfig),
      discover_config: JSON.stringify({
        sources: [
          { id: "nyt", label: "NYT Cooking", url: "https://cooking.nytimes.com/", feedUrl: "https://secret.example/feed", enabled: true },
        ],
        autoRefreshEnabled: true,
        expirationEnabled: true,
        itemLifetimeDays: 7,
        refreshIntervalDays: 2,
      }),
      "recipes:index": JSON.stringify([
        {
          id: "r_aaa",
          title: "Garlic Pasta",
          tags: ["italian"],
          cuisine: "Italian",
          favorite: false,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
      household: JSON.stringify({
        members: [{ id: "u_ryan", name: "Ryan", isOwner: true }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
  }

  test("list_tags", async () => {
    const result = await callTool("list_tags", {}, p2Env());
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.tags.length).toBe(2);
    expect(payload.tags[0].name).toBe("dinner");
  });

  test("list_discover_feed compact + skips expired", async () => {
    const result = await callTool("list_discover_feed", { limit: 10 }, p2Env());
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.kvSource).toBe("discover_archive");
    expect(payload.count).toBe(1);
    expect(payload.items[0].title).toBe("Sheet Pan Chicken");
    expect(payload.items[0].description.length).toBeLessThanOrEqual(160);
    expect(payload.items[0].url).toContain("nytimes");
  });

  test("list_discover_feed includeExpired", async () => {
    const result = await callTool(
      "list_discover_feed",
      { includeExpired: true },
      p2Env()
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.totalMatching).toBe(2);
  });

  test("get_discover_item by url / id", async () => {
    const e = p2Env();
    const byUrl = await callTool(
      "get_discover_item",
      { url: "http://cooking.nytimes.com/recipes/123-chicken/" },
      e
    );
    const payload = JSON.parse(byUrl.content[0]!.text);
    expect(payload.item.title).toBe("Sheet Pan Chicken");

    const byId = await callTool(
      "get_discover_item",
      { id: "https://cooking.nytimes.com/recipes/123-chicken" },
      e
    );
    expect(JSON.parse(byId.content[0]!.text).item.url).toContain("123-chicken");

    const missing = await callTool("get_discover_item", { id: "nope" }, e);
    expect(missing.isError).toBe(true);
  });

  test("search_semantic unbound → vectorize_unavailable", async () => {
    const result = await callTool("search_semantic", { query: "pasta" }, p2Env());
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.error).toBe("vectorize_unavailable");
  });

  test("search_semantic with mocks", async () => {
    const fakeAi = {
      async run() {
        return { data: [new Array(10).fill(0.1)] };
      },
    };
    const fakeVectorize = {
      async query() {
        return {
          matches: [
            { id: "r_aaa", score: 0.91, metadata: { title: "Garlic Pasta" } },
          ],
        };
      },
    };
    const result = await callTool(
      "search_semantic",
      { query: "garlicky noodles", topK: 5 },
      p2Env({
        AI: fakeAi as unknown as Ai,
        VECTORIZE: fakeVectorize as unknown as VectorizeIndex,
      })
    );
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.count).toBe(1);
    expect(payload.items[0].id).toBe("r_aaa");
    expect(payload.items[0].title).toBe("Garlic Pasta");
  });

  test("get_settings_public never leaks secrets", async () => {
    const result = await callTool(
      "get_settings_public",
      {},
      p2Env({
        GROQ_API_KEY: "groq-secret-value",
        WHISK_MCP_TOKEN: TEST_TOKEN,
        CF_BR_TOKEN: "cf-br-secret",
        CF_ACCOUNT_ID: "acct",
      })
    );
    const text = result.content[0]!.text;
    expect(text).not.toContain("groq-secret-value");
    expect(text).not.toContain("cf-br-secret");
    expect(text).not.toContain("should-never-leak");
    expect(text).not.toContain("also-never");
    expect(text).not.toContain("https://secret.example/feed");
    expect(text).not.toContain(TEST_TOKEN);

    const payload = JSON.parse(text);
    expect(payload.capabilities.hasGroq).toBe(true);
    expect(payload.capabilities.hasBrowserRendering).toBe(true);
    expect(payload.capabilities.vectorize).toBe(false);
    expect(payload.aiConfig.mode).toBe("simple");
    expect(payload.aiConfig.apiKey).toBeUndefined();
    expect(payload.aiConfig.WHISK_MCP_TOKEN).toBeUndefined();
    expect(payload.discover.sources[0].feedUrl).toBeUndefined();
    expect(payload.discover.sources[0].id).toBe("nyt");
  });
});


describe("v2 write / destructive tools", () => {
  const index = [
    {
      id: "r_aaa",
      title: "Garlic Pasta",
      tags: ["italian", "pasta"],
      cuisine: "Italian",
      favorite: true,
      favoritedBy: ["u_ryan", "u_erica"],
      wantToMake: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      ingredientNames: ["garlic", "pasta"],
    },
    {
      id: "r_bbb",
      title: "Tofu Stir Fry",
      tags: ["asian"],
      cuisine: "Chinese",
      favorite: false,
      favoritedBy: [],
      wantToMake: false,
      updatedAt: "2026-01-02T00:00:00.000Z",
      ingredientNames: ["tofu"],
    },
  ];

  const household = {
    members: [{ id: "u_ryan", name: "Ryan", isOwner: true, joinedAt: "2026-01-01" }],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  function v2Env() {
    return env(
      {},
      {
        "recipes:index": JSON.stringify(index),
        "recipe:r_aaa": JSON.stringify({
          id: "r_aaa",
          title: "Garlic Pasta",
          ingredients: [{ name: "garlic" }],
          steps: [{ text: "Cook" }],
          tags: ["italian"],
          favoritedBy: ["u_ryan", "u_erica"],
          favorite: true,
          wantToMake: true,
          description: "Yummy",
          cuisine: "Italian",
          prepTime: 10,
          cookTime: 15,
          servings: 2,
          notes: "old notes",
        }),
        "recipe:r_bbb": JSON.stringify({
          id: "r_bbb",
          title: "Tofu Stir Fry",
          ingredients: [{ name: "tofu" }],
          steps: [{ text: "Fry" }],
          tags: ["asian"],
          favoritedBy: [],
          favorite: false,
          wantToMake: false,
        }),
        household: JSON.stringify(household),
        "plan:current": JSON.stringify({
          id: "current",
          meals: [
            {
              id: "m_old",
              date: "2026-10-01",
              slot: "dinner",
              title: "Leftovers",
            },
            {
              id: "m_keep",
              date: "2026-10-02",
              slot: "lunch",
              title: "Salad",
            },
          ],
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        "shopping:current": JSON.stringify({
          id: "current",
          items: [
            { id: "s1", name: "milk", category: "dairy", checked: false },
            { id: "s2", name: "eggs", category: "dairy", checked: true },
          ],
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      }
    );
  }

  test("remove_from_favorites removes only actor", async () => {
    const e = v2Env();
    const result = await callTool("remove_from_favorites", { id: "r_aaa" }, e);
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.actorUserId).toBe("u_ryan");
    expect(payload.favoritedBy).toEqual(["u_erica"]);
    expect(payload.favoritedBy).not.toContain("u_ryan");
    const stored = (await e.WHISK_KV.get("recipe:r_aaa", "json")) as {
      favoritedBy: string[];
      favorite: boolean;
    };
    expect(stored.favoritedBy).toEqual(["u_erica"]);
    expect(stored.favorite).toBe(true);
  });

  test("set_want_to_make updates recipe + index", async () => {
    const e = v2Env();
    const result = await callTool(
      "set_want_to_make",
      { id: "r_aaa", wantToMake: false },
      e
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.wantToMake).toBe(false);
    expect(payload.actorUserId).toBe("u_ryan");
    const stored = (await e.WHISK_KV.get("recipe:r_aaa", "json")) as {
      wantToMake: boolean;
    };
    expect(stored.wantToMake).toBe(false);
    const idx = (await e.WHISK_KV.get("recipes:index", "json")) as {
      id: string;
      wantToMake?: boolean;
    }[];
    expect(idx.find((x) => x.id === "r_aaa")!.wantToMake).toBe(false);
  });

  test("remove_from_meal_plan removes exact meal", async () => {
    const e = v2Env();
    const result = await callTool(
      "remove_from_meal_plan",
      { mealId: "m_old" },
      e
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.mealCount).toBe(1);
    expect(payload.actorUserId).toBe("u_ryan");
    const plan = (await e.WHISK_KV.get("plan:current", "json")) as {
      meals: { id: string }[];
    };
    expect(plan.meals.map((m) => m.id)).toEqual(["m_keep"]);
  });

  test("remove_from_meal_plan refuses missing meal", async () => {
    const e = v2Env();
    const result = await callTool(
      "remove_from_meal_plan",
      { mealId: "m_missing" },
      e
    );
    expect(result.isError).toBe(true);
    const plan = (await e.WHISK_KV.get("plan:current", "json")) as {
      meals: unknown[];
    };
    expect(plan.meals.length).toBe(2);
  });

  test("clear_meal_plan rejects without confirm", async () => {
    const e = v2Env();
    const result = await callTool(
      "clear_meal_plan",
      { confirm: false, confirmName: "current" },
      e
    );
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.status).toBe(400);
    expect(payload.actorUserId).toBe("u_ryan");
    const plan = (await e.WHISK_KV.get("plan:current", "json")) as {
      meals: unknown[];
    };
    expect(plan.meals.length).toBe(2);
  });

  test("clear_meal_plan rejects wrong confirmName", async () => {
    const e = v2Env();
    const result = await callTool(
      "clear_meal_plan",
      { confirm: true, confirmName: "wrong" },
      e
    );
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.status).toBe(400);
    const plan = (await e.WHISK_KV.get("plan:current", "json")) as {
      meals: unknown[];
    };
    expect(plan.meals.length).toBe(2);
  });

  test("clear_meal_plan succeeds with confirm", async () => {
    const e = v2Env();
    const result = await callTool(
      "clear_meal_plan",
      { confirm: true, confirmName: "current" },
      e
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.clearedCount).toBe(2);
    expect(payload.plan.meals).toEqual([]);
    expect(payload.actorUserId).toBe("u_ryan");
  });

  test("delete_recipe rejects without confirm / wrong title", async () => {
    const e = v2Env();
    const noConfirm = await callTool(
      "delete_recipe",
      { id: "r_bbb", confirm: false, confirmName: "Tofu Stir Fry" },
      e
    );
    expect(noConfirm.isError).toBe(true);
    expect(JSON.parse(noConfirm.content[0]!.text).status).toBe(400);
    expect(await e.WHISK_KV.get("recipe:r_bbb", "json")).not.toBeNull();

    const wrongTitle = await callTool(
      "delete_recipe",
      { id: "r_bbb", confirm: true, confirmName: "Wrong Title" },
      e
    );
    expect(wrongTitle.isError).toBe(true);
    expect(JSON.parse(wrongTitle.content[0]!.text).status).toBe(400);
    expect(await e.WHISK_KV.get("recipe:r_bbb", "json")).not.toBeNull();
  });

  test("delete_recipe succeeds with matching title", async () => {
    const e = v2Env();
    const result = await callTool(
      "delete_recipe",
      { id: "r_bbb", confirm: true, confirmName: "Tofu Stir Fry" },
      e
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.actorUserId).toBe("u_ryan");
    expect(await e.WHISK_KV.get("recipe:r_bbb", "json")).toBeNull();
    const idx = (await e.WHISK_KV.get("recipes:index", "json")) as { id: string }[];
    expect(idx.find((x) => x.id === "r_bbb")).toBeUndefined();
  });

  test("shopping_add_item / set_checked / remove_item", async () => {
    const e = v2Env();
    const add = await callTool(
      "shopping_add_item",
      { name: "butter", qty: "1 stick", notes: "salted" },
      e
    );
    const addPayload = JSON.parse(add.content[0]!.text);
    expect(addPayload.ok).toBe(true);
    expect(addPayload.item.name).toBe("butter");
    expect(addPayload.item.amount).toBe("1 stick");
    expect(addPayload.item.notes).toBe("salted");
    expect(addPayload.actorUserId).toBe("u_ryan");
    expect(addPayload.itemCount).toBe(3);

    const set = await callTool(
      "shopping_set_checked",
      { itemId: "s1", checked: true },
      e
    );
    expect(JSON.parse(set.content[0]!.text).ok).toBe(true);
    const list1 = (await e.WHISK_KV.get("shopping:current", "json")) as {
      items: { id: string; checked: boolean }[];
    };
    expect(list1.items.find((i) => i.id === "s1")!.checked).toBe(true);

    const rem = await callTool("shopping_remove_item", { itemId: "s2" }, e);
    expect(JSON.parse(rem.content[0]!.text).ok).toBe(true);
    const list2 = (await e.WHISK_KV.get("shopping:current", "json")) as {
      items: { id: string }[];
    };
    expect(list2.items.find((i) => i.id === "s2")).toBeUndefined();
    expect(list2.items.length).toBe(2);
  });

  test("clear_shopping_list rejects without confirm / wrong name", async () => {
    const e = v2Env();
    const a = await callTool(
      "clear_shopping_list",
      { confirm: true, confirmName: "shopping:current" },
      e
    );
    expect(a.isError).toBe(true);
    expect(JSON.parse(a.content[0]!.text).status).toBe(400);
    const list = (await e.WHISK_KV.get("shopping:current", "json")) as {
      items: unknown[];
    };
    expect(list.items.length).toBe(2);

    const b = await callTool(
      "clear_shopping_list",
      { confirm: false, confirmName: "current" },
      e
    );
    expect(b.isError).toBe(true);
    expect(
      ((await e.WHISK_KV.get("shopping:current", "json")) as { items: unknown[] })
        .items.length
    ).toBe(2);
  });

  test("clear_shopping_list succeeds with confirmName current", async () => {
    const e = v2Env();
    const result = await callTool(
      "clear_shopping_list",
      { confirm: true, confirmName: "current" },
      e
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.clearedCount).toBe(2);
    expect(payload.list.items).toEqual([]);
    expect(payload.actorUserId).toBe("u_ryan");
  });

  test("update_recipe partial safe fields", async () => {
    const e = v2Env();
    const result = await callTool(
      "update_recipe",
      {
        id: "r_aaa",
        title: "Garlic Pasta Deluxe",
        notes: "extra garlic",
        prepTime: 12,
      },
      e
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.actorUserId).toBe("u_ryan");
    expect(payload.updatedFields).toContain("title");
    expect(payload.recipe.title).toBe("Garlic Pasta Deluxe");
    expect(payload.recipe.notes).toBe("extra garlic");
    expect(payload.recipe.favoritedBy).toEqual(["u_ryan", "u_erica"]);
    const idx = (await e.WHISK_KV.get("recipes:index", "json")) as {
      id: string;
      title: string;
    }[];
    expect(idx.find((x) => x.id === "r_aaa")!.title).toBe("Garlic Pasta Deluxe");
  });
});

