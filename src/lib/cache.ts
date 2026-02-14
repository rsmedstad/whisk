/**
 * Local-first cache layer.
 *
 * Every read hits localStorage first (sub-millisecond), then syncs from
 * the network in the background. Writes are optimistic: the UI updates
 * instantly and the network call happens async.
 *
 * This makes the app feel native-fast even on slow connections.
 */

const PREFIX = "whisk_cache_";
const TIMESTAMP_SUFFIX = "_ts";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// ── Read ────────────────────────────────────────────────

/** Get data from local cache. Returns null if not cached. */
export function getLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return entry.data;
  } catch {
    return null;
  }
}

/** Get cache age in seconds. Returns Infinity if not cached. */
export function getCacheAge(key: string): number {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return Infinity;
    const entry = JSON.parse(raw) as CacheEntry<unknown>;
    return (Date.now() - entry.timestamp) / 1000;
  } catch {
    return Infinity;
  }
}

// ── Write ───────────────────────────────────────────────

/** Save data to local cache. */
export function setLocal<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage full — evict oldest entries
    evictOldest();
    try {
      const entry: CacheEntry<T> = { data, timestamp: Date.now() };
      localStorage.setItem(PREFIX + key, JSON.stringify(entry));
    } catch {
      // Still full, give up silently
    }
  }
}

/** Remove a cached key. */
export function removeLocal(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

// ── Stale-While-Revalidate pattern ──────────────────────

/**
 * Returns cached data immediately, then fetches fresh data in the background.
 *
 * @param key - Cache key
 * @param fetcher - Async function that returns fresh data
 * @param onFresh - Called when fresh data arrives (use to update state)
 * @param maxAge - Max cache age in seconds before forcing a fetch (default: 300 = 5 min)
 */
export async function staleWhileRevalidate<T>(
  key: string,
  fetcher: () => Promise<T>,
  onFresh: (data: T) => void,
  maxAge = 300
): Promise<T | null> {
  const cached = getLocal<T>(key);
  const age = getCacheAge(key);

  // If cache is fresh enough, just return it
  if (cached !== null && age < maxAge) {
    // Still revalidate in background (fire and forget)
    fetcher()
      .then((fresh) => {
        setLocal(key, fresh);
        onFresh(fresh);
      })
      .catch(() => {});
    return cached;
  }

  // Cache is stale or missing — try network first
  if (cached !== null) {
    // Return stale immediately, fetch in background
    fetcher()
      .then((fresh) => {
        setLocal(key, fresh);
        onFresh(fresh);
      })
      .catch(() => {});
    return cached;
  }

  // Nothing cached — must wait for network
  try {
    const fresh = await fetcher();
    setLocal(key, fresh);
    return fresh;
  } catch {
    return null;
  }
}

// ── Cache management ────────────────────────────────────

/** Evict oldest cache entries to free space. */
function evictOldest(): void {
  const entries: { key: string; timestamp: number }[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const entry = JSON.parse(raw) as CacheEntry<unknown>;
      entries.push({ key, timestamp: entry.timestamp });
    } catch {
      // Corrupt entry, remove it
      if (key) localStorage.removeItem(key);
    }
  }

  // Sort oldest first, remove bottom 25%
  entries.sort((a, b) => a.timestamp - b.timestamp);
  const toRemove = Math.max(1, Math.floor(entries.length / 4));
  for (let i = 0; i < toRemove; i++) {
    const entry = entries[i];
    if (entry) localStorage.removeItem(entry.key);
  }
}

/** Clear all Whisk cache entries. */
export function clearCache(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) toRemove.push(key);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

// ── Specific cache keys ─────────────────────────────────

export const CACHE_KEYS = {
  RECIPE_INDEX: "recipes_index",
  RECIPE: (id: string) => `recipe_${id}`,
  SHOPPING_LIST: "shopping_list",
  MEAL_PLAN: (weekId: string) => `meal_plan_${weekId}`,
  TAG_INDEX: "tag_index",
} as const;
