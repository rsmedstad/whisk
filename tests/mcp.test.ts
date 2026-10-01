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

  test("tools/list returns phase-1 tools", async () => {
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
        "get_recipe",
        "import_recipe_url",
        "list_favorites",
        "list_meal_plan",
        "list_shopping",
        "list_want_to_make",
        "search_recipes",
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
  test("phase 1 has 10 tools", () => {
    expect(TOOL_DEFS.length).toBe(10);
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
