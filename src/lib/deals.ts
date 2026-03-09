import type { ShoppingItem, Deal } from "../types";

/** Normalize an item name for fuzzy matching. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple stem: strip common suffixes. */
function stem(word: string): string {
  return word
    .replace(/(es|s|ed|ing)$/, "")
    .replace(/ies$/, "y");
}

/** Check if two normalized names are a fuzzy match. */
function fuzzyMatch(itemName: string, dealName: string): boolean {
  const a = normalize(itemName);
  const b = normalize(dealName);

  // Exact match
  if (a === b) return true;

  // Substring match
  if (a.includes(b) || b.includes(a)) return true;

  // Word-level matching: if most words in the shorter string appear in the longer
  const aWords = a.split(" ").map(stem);
  const bWords = b.split(" ").map(stem);

  const [shorter, longer] = aWords.length <= bWords.length
    ? [aWords, bWords]
    : [bWords, aWords];

  if (shorter.length === 0) return false;

  const matchCount = shorter.filter((w) =>
    longer.some((lw) => lw.includes(w) || w.includes(lw))
  ).length;

  // Require at least 60% word overlap
  return matchCount / shorter.length >= 0.6;
}

/**
 * Match deals to shopping list items.
 * Returns a map of item ID → matching deals (sorted by best price).
 */
export function matchDealsToList(
  items: ShoppingItem[],
  deals: Deal[]
): Map<string, Deal[]> {
  const result = new Map<string, Deal[]>();

  for (const item of items) {
    const matches: Deal[] = [];
    for (const deal of deals) {
      if (fuzzyMatch(item.name, deal.item)) {
        matches.push(deal);
      }
    }
    if (matches.length > 0) {
      // Sort by lowest price first
      matches.sort((a, b) => a.price - b.price);
      result.set(item.id, matches);
    }
  }

  return result;
}

/**
 * Find the best store for a shopping trip based on deal matches.
 * Returns store with the most matching deals.
 */
export function getBestStore(
  items: ShoppingItem[],
  deals: Deal[]
): { storeId: string; storeName: string; matchCount: number; estimatedSavings: number } | null {
  const storeScores = new Map<string, { name: string; matches: number; savings: number }>();

  for (const item of items) {
    for (const deal of deals) {
      if (fuzzyMatch(item.name, deal.item)) {
        const existing = storeScores.get(deal.storeId) ?? { name: deal.storeName, matches: 0, savings: 0 };
        existing.matches++;
        if (deal.originalPrice) {
          existing.savings += deal.originalPrice - deal.price;
        }
        storeScores.set(deal.storeId, existing);
      }
    }
  }

  if (storeScores.size === 0) return null;

  let best: { storeId: string; storeName: string; matchCount: number; estimatedSavings: number } | null = null;

  for (const [storeId, score] of storeScores) {
    if (!best || score.matches > best.matchCount) {
      best = {
        storeId,
        storeName: score.name,
        matchCount: score.matches,
        estimatedSavings: score.savings,
      };
    }
  }

  return best;
}
