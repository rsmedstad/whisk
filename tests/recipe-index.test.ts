import { describe, expect, test } from "bun:test";
import {
  buildIndexEntry,
  maybeReconcileRecipeIndex,
  mutateRecipeIndex,
  patchRecipeIndex,
  reconcileRecipeIndex,
  updateIndexEntry,
  RECIPE_INDEX_KEY,
} from "../functions/lib/recipe-index";

const OLD = "2026-01-01T00:00:00.000Z";
const NOW = Date.parse("2026-11-01T12:00:00.000Z");

function fakeKv(init: Record<string, string> = {}, opts: { hideFromList?: string[] } = {}) {
  const store = new Map(Object.entries(init));
  return {
    store,
    async get(key: string, type?: string) {
      const raw = store.get(key) ?? null;
      if (raw === null) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async list({ prefix }: { prefix?: string; cursor?: string }) {
      const hidden = new Set(opts.hideFromList ?? []);
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix ?? "") && !hidden.has(k))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

const record = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, title: `Recipe ${id}`, tags: [], ingredients: [{ name: "salt" }], steps: [{ text: "x" }], updatedAt: OLD, ...extra });
const entry = (id: string, updatedAt = OLD) => ({ id, title: `Recipe ${id}`, tags: [], favorite: false, updatedAt });

describe("reconcileRecipeIndex", () => {
  test("removes a ghost entry whose record is gone", async () => {
    const kv = fakeKv({
      "recipe:a": record("a"),
      [RECIPE_INDEX_KEY]: JSON.stringify([entry("a"), entry("ghost")]),
    });
    const res = await reconcileRecipeIndex(kv, { now: NOW });
    expect(res.removed).toEqual(["ghost"]);
    const index = JSON.parse(kv.store.get(RECIPE_INDEX_KEY)!) as { id: string }[];
    expect(index.map((e) => e.id)).toEqual(["a"]);
  });

  test("adds an orphan record missing from the index", async () => {
    const kv = fakeKv({
      "recipe:a": record("a"),
      "recipe:b": record("b", { title: "Orphan" }),
      [RECIPE_INDEX_KEY]: JSON.stringify([entry("a")]),
    });
    const res = await reconcileRecipeIndex(kv, { now: NOW });
    expect(res.added).toEqual(["b"]);
    const index = JSON.parse(kv.store.get(RECIPE_INDEX_KEY)!) as { id: string; title: string }[];
    expect(index.find((e) => e.id === "b")?.title).toBe("Orphan");
  });

  test("never judges a fresh entry (listing can lag)", async () => {
    const fresh = new Date(NOW - 30_000).toISOString();
    const kv = fakeKv({ [RECIPE_INDEX_KEY]: JSON.stringify([entry("new", fresh)]) });
    const res = await reconcileRecipeIndex(kv, { now: NOW });
    expect(res.removed).toEqual([]);
  });

  test("keeps an entry the list hides but a direct read finds", async () => {
    const kv = fakeKv(
      { "recipe:a": record("a"), [RECIPE_INDEX_KEY]: JSON.stringify([entry("a")]) },
      { hideFromList: ["recipe:a"] }
    );
    const res = await reconcileRecipeIndex(kv, { now: NOW });
    expect(res.removed).toEqual([]);
  });

  test("does not touch non-record keys", async () => {
    const kv = fakeKv({ "recipe:a:meta": "{}", [RECIPE_INDEX_KEY]: JSON.stringify([]) });
    const res = await reconcileRecipeIndex(kv, { now: NOW });
    expect(res.added).toEqual([]);
  });

  test("throttles reconcile runs", async () => {
    const kv = fakeKv({ [RECIPE_INDEX_KEY]: JSON.stringify([]) });
    expect(await maybeReconcileRecipeIndex(kv, { now: NOW })).not.toBeNull();
    expect(await maybeReconcileRecipeIndex(kv, { now: NOW + 60_000 })).toBeNull();
    expect(await maybeReconcileRecipeIndex(kv, { now: NOW + 11 * 60_000 })).not.toBeNull();
  });
});

describe("mutateRecipeIndex", () => {
  test("retries when a concurrent write clobbers the change", async () => {
    const kv = fakeKv({ [RECIPE_INDEX_KEY]: JSON.stringify([entry("a"), entry("b")]) });
    let clobbered = false;
    const realPut = kv.put.bind(kv);
    (kv as unknown as { put: typeof kv.put }).put = (async (key: string, value: string) => {
      await realPut(key, value);
      if (!clobbered && key === RECIPE_INDEX_KEY) {
        clobbered = true;
        // a stale writer restores the deleted entry
        await realPut(key, JSON.stringify([entry("a"), entry("b")]));
      }
    }) as typeof kv.put;
    const ok = await mutateRecipeIndex(
      kv,
      (idx) => idx.filter((e) => e.id !== "b"),
      (idx) => !idx.some((e) => e.id === "b")
    );
    expect(ok).toBe(true);
    expect((JSON.parse(kv.store.get(RECIPE_INDEX_KEY)!) as { id: string }[]).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("buildIndexEntry", () => {
  test("derives counts and difficulty from the record", () => {
    const e = buildIndexEntry("x", { title: "T", ingredients: [{ name: "a" }], steps: [{}], prepTime: 5, ratings: { u: 4, v: 5 } });
    expect(e.ingredientCount).toBe(1);
    expect(e.avgRating).toBe(4.5);
    expect(e.difficulty).toBe("easy");
  });
});

describe("patchRecipeIndex / updateIndexEntry", () => {
  test("patches apply to a fresh index and never resurrect a deleted entry", async () => {
    // The job loaded [a, b]; b was deleted while it ran, so the live index is [a].
    const kv = fakeKv({ [RECIPE_INDEX_KEY]: JSON.stringify([entry("a")]) });
    const ok = await patchRecipeIndex(kv, { a: { tags: ["x"] }, b: { tags: ["y"] } });
    expect(ok).toBe(true);
    const index = JSON.parse(kv.store.get(RECIPE_INDEX_KEY)!) as { id: string; tags: string[] }[];
    expect(index.map((e) => e.id)).toEqual(["a"]);
    expect(index[0]!.tags).toEqual(["x"]);
  });

  test("updateIndexEntry replaces one entry and leaves the rest", async () => {
    const kv = fakeKv({ [RECIPE_INDEX_KEY]: JSON.stringify([entry("a"), entry("b")]) });
    await updateIndexEntry(kv, "b", (e) => ({ ...e, title: "Renamed" }));
    const index = JSON.parse(kv.store.get(RECIPE_INDEX_KEY)!) as { id: string; title: string }[];
    expect(index.find((e) => e.id === "b")?.title).toBe("Renamed");
    expect(index.find((e) => e.id === "a")?.title).toBe("Recipe a");
  });

  test("updateIndexEntry on a missing id changes nothing", async () => {
    const kv = fakeKv({ [RECIPE_INDEX_KEY]: JSON.stringify([entry("a")]) });
    await updateIndexEntry(kv, "gone", (e) => ({ ...e, title: "x" }));
    expect((JSON.parse(kv.store.get(RECIPE_INDEX_KEY)!) as unknown[]).length).toBe(1);
  });
});
