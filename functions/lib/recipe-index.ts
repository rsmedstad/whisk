/**
 * Recipe index integrity.
 *
 * `recipes:index` is a single KV value rewritten by read-modify-write, so
 * overlapping writes can undo each other: a delete can be undone by a stale
 * write (ghost entry: listed, record gone) and a create can be lost (orphan:
 * record exists, not listed). The `recipe:{id}` records are the source of
 * truth; the index is a derived cache that this module keeps honest.
 */

export const RECIPE_INDEX_KEY = "recipes:index";
const RECORD_PREFIX = "recipe:";
const RECONCILED_AT_KEY = "recipes:index:reconciled-at";

/** Entries or records newer than this are never judged: KV list/get are eventually consistent. */
export const RECONCILE_MIN_AGE_MS = 5 * 60 * 1000;
export const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;

export interface IndexEntryBase {
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

type KvLike = Pick<KVNamespace, "get" | "put" | "list">;

function computeDifficulty(totalMinutes: number, ingredientCount: number, stepCount: number): "easy" | "medium" | "hard" {
  const t = totalMinutes <= 0 ? 1 : totalMinutes <= 35 ? 0 : totalMinutes <= 60 ? 1 : 2;
  const i = ingredientCount <= 7 ? 0 : ingredientCount <= 12 ? 1 : 2;
  const s = stepCount <= 5 ? 0 : stepCount <= 10 ? 1 : 2;
  const score = t + i + s;
  return score <= 2 ? "easy" : score <= 4 ? "medium" : "hard";
}

/** Index entry for a stored recipe record (same shape scripts/rebuild-index.ts writes). */
export function buildIndexEntry(id: string, d: Record<string, unknown>): IndexEntryBase {
  const ingredients = Array.isArray(d.ingredients) ? (d.ingredients as { name?: string }[]) : [];
  const steps = Array.isArray(d.steps) ? d.steps : [];
  const totalMin = ((d.prepTime as number) ?? 0) + ((d.cookTime as number) ?? 0);
  const ratings = d.ratings as Record<string, number> | undefined;
  const ratingValues = ratings ? Object.values(ratings) : [];
  return {
    id,
    title: (d.title as string) ?? "Untitled",
    tags: (d.tags as string[]) ?? [],
    cuisine: d.cuisine,
    favorite: (d.favorite as boolean) ?? false,
    favoritedBy: d.favoritedBy,
    wantToMake: d.wantToMake,
    updatedAt: (d.updatedAt as string) ?? new Date().toISOString(),
    thumbnailUrl: d.thumbnailUrl,
    prepTime: d.prepTime,
    cookTime: d.cookTime,
    servings: d.servings,
    description: d.description,
    cookedCount: d.cookedCount,
    lastCookedAt: d.lastCookedAt,
    avgRating: ratingValues.length
      ? Math.round((ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length) * 10) / 10
      : undefined,
    ratingCount: ratingValues.length || undefined,
    spirits: d.spirits,
    ingredientCount: ingredients.length,
    stepCount: steps.length,
    difficulty: computeDifficulty(totalMin, ingredients.length, steps.length),
    ingredientNames: ingredients.map((i) => i.name).filter((n): n is string => !!n).slice(0, 30),
    sourceUrl: (d.source as { url?: string } | undefined)?.url,
    sourceRating: d.sourceRating,
    sourceRatingCount: d.sourceRatingCount,
  };
}

async function readIndex(kv: KvLike): Promise<IndexEntryBase[]> {
  return ((await kv.get(RECIPE_INDEX_KEY, "json")) as IndexEntryBase[] | null) ?? [];
}

async function listRecordIds(kv: KvLike): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: RECORD_PREFIX, cursor });
    for (const key of page.keys) {
      const id = key.name.slice(RECORD_PREFIX.length);
      if (id && !id.includes(":")) ids.add(id);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return ids;
}

function isOldEnough(updatedAt: string | undefined, now: number, minAgeMs: number): boolean {
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isNaN(t) || now - t >= minAgeMs;
}

export interface ReconcileResult {
  removed: string[];
  added: string[];
}

/**
 * Make the index match the records: drop entries whose record is verifiably
 * gone, add records missing from the index. Idempotent. Safe to run any time.
 */
export async function reconcileRecipeIndex(
  kv: KvLike,
  opts: { now?: number; minAgeMs?: number } = {}
): Promise<ReconcileResult> {
  const now = opts.now ?? Date.now();
  const minAgeMs = opts.minAgeMs ?? RECONCILE_MIN_AGE_MS;

  const recordIds = await listRecordIds(kv);
  const index = await readIndex(kv);
  const indexed = new Set(index.map((e) => e.id));

  const ghostIds: string[] = [];
  for (const entry of index) {
    if (recordIds.has(entry.id)) continue;
    if (!isOldEnough(entry.updatedAt, now, minAgeMs)) continue;
    // List can lag; confirm with a direct read before judging.
    if ((await kv.get(`${RECORD_PREFIX}${entry.id}`)) === null) ghostIds.push(entry.id);
  }

  const orphanEntries: IndexEntryBase[] = [];
  for (const id of recordIds) {
    if (indexed.has(id)) continue;
    const record = (await kv.get(`${RECORD_PREFIX}${id}`, "json")) as Record<string, unknown> | null;
    if (record && typeof record === "object") orphanEntries.push(buildIndexEntry(id, record));
  }

  if (ghostIds.length === 0 && orphanEntries.length === 0) return { removed: [], added: [] };

  // Apply to a fresh copy so changes made while we were checking are kept.
  const fresh = await readIndex(kv);
  const ghosts = new Set(ghostIds);
  const present = new Set(fresh.map((e) => e.id));
  const added = orphanEntries.filter((e) => !present.has(e.id));
  const next = [...added, ...fresh.filter((e) => !ghosts.has(e.id))];
  next.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  await kv.put(RECIPE_INDEX_KEY, JSON.stringify(next));
  return { removed: ghostIds, added: added.map((e) => e.id) };
}

/** Reconcile at most once per interval (shared across isolates via KV). Never throws. */
export async function maybeReconcileRecipeIndex(
  kv: KvLike,
  opts: { now?: number; intervalMs?: number } = {}
): Promise<ReconcileResult | null> {
  const now = opts.now ?? Date.now();
  const intervalMs = opts.intervalMs ?? RECONCILE_INTERVAL_MS;
  try {
    const last = Number(await kv.get(RECONCILED_AT_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < intervalMs) return null;
    await kv.put(RECONCILED_AT_KEY, String(now), { expirationTtl: 3600 });
    return await reconcileRecipeIndex(kv, { now });
  } catch {
    return null;
  }
}

/**
 * Read-modify-write the index, then confirm the change landed (re-read and
 * check). Retries a few times if a concurrent write clobbered it.
 */
export async function mutateRecipeIndex(
  kv: KvLike,
  mutate: (index: IndexEntryBase[]) => IndexEntryBase[],
  landed: (index: IndexEntryBase[]) => boolean,
  attempts = 3
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const next = mutate(await readIndex(kv));
    await kv.put(RECIPE_INDEX_KEY, JSON.stringify(next));
    if (landed(await readIndex(kv))) return true;
  }
  return false;
}
