import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../lib/api";
import { getLocal, setLocal, CACHE_KEYS } from "../lib/cache";
import { nanoid } from "nanoid";
import type { ShoppingList, ShoppingItem, ShoppingCategory } from "../types";
import { categorizeIngredient } from "../lib/categories";

const VALID_CATEGORIES = new Set<ShoppingCategory>([
  "produce", "dairy", "meat", "pantry", "snacks", "frozen", "bakery", "beverages", "other",
]);

/** Clean ingredient name: strip trailing junk and annotations, keep amounts for display */
function cleanIngredientName(name: string): string {
  let cleaned = name;
  // Strip "(optional)", "(to taste)", "(divided)", etc.
  cleaned = cleaned.replace(/\(\s*(?:optional|to taste|divided|or more|adjusted?)\s*\)/gi, "");
  // Strip parenthetical amounts: "(15 oz)", "(about 2 cups)" — require at least one digit
  cleaned = cleaned.replace(/\(\s*(?:about\s+)?[\d\s.\/]+\s*(?:oz|lb|g|kg|ml|l|cups?|cans?|pts?|qts?|gal)?\.?\s*\)/gi, "");
  // Strip trailing junk: ", and", trailing commas, semicolons
  cleaned = cleaned.replace(/[,;]\s*(and\s*)?$/i, "");
  cleaned = cleaned.replace(/\s+and\s*$/i, "");
  // Clean underscores → spaces, collapse multiple spaces
  cleaned = cleaned.replace(/[_]+/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

const EMPTY_LIST: ShoppingList = {
  id: "current",
  items: [],
  updatedAt: new Date().toISOString(),
};

export function useShoppingList() {
  // Instant load from local cache
  const [list, setList] = useState<ShoppingList>(
    () => getLocal<ShoppingList>(CACHE_KEYS.SHOPPING_LIST) ?? EMPTY_LIST
  );
  const [isLoading, setIsLoading] = useState(
    () => !getLocal(CACHE_KEYS.SHOPPING_LIST)
  );
  const listRef = useRef(list);
  listRef.current = list;

  // Background sync on mount
  useEffect(() => {
    api
      .get<ShoppingList>("/shopping")
      .then((data) => {
        const result = data ?? EMPTY_LIST;
        setList(result);
        setLocal(CACHE_KEYS.SHOPPING_LIST, result);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  // Optimistic save: update local instantly, network in background
  const saveList = useCallback(async (updated: ShoppingList) => {
    const withTimestamp = { ...updated, updatedAt: new Date().toISOString() };
    listRef.current = withTimestamp; // Update ref immediately for callers in the same tick
    setList(withTimestamp);
    setLocal(CACHE_KEYS.SHOPPING_LIST, withTimestamp);
    api.put("/shopping", withTimestamp).catch(() => {});
  }, []);

  const addItem = useCallback(
    async (
      name: string,
      options?: {
        amount?: string;
        unit?: string;
        category?: ShoppingCategory;
        sourceRecipeId?: string;
        addedBy?: ShoppingItem["addedBy"];
      }
    ) => {
      const userName = localStorage.getItem("whisk_display_name") ?? undefined;
      const item: ShoppingItem = {
        id: nanoid(10),
        name,
        amount: options?.amount,
        unit: options?.unit,
        category: options?.category ?? categorizeIngredient(name),
        checked: false,
        sourceRecipeId: options?.sourceRecipeId,
        addedBy: options?.addedBy ?? "manual",
        addedByUser: userName,
      };
      // Use ref to get latest list state (avoids stale closure when called in a loop)
      const currentList = listRef.current;
      await saveList({ ...currentList, items: [...currentList.items, item] });
    },
    [saveList]
  );

  const toggleItem = useCallback(
    async (itemId: string) => {
      await saveList({
        ...list,
        items: list.items.map((item) =>
          item.id === itemId ? { ...item, checked: !item.checked } : item
        ),
      });
    },
    [list, saveList]
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      await saveList({
        ...list,
        items: list.items.filter((item) => item.id !== itemId),
      });
    },
    [list, saveList]
  );

  const clearChecked = useCallback(async () => {
    await saveList({
      ...list,
      items: list.items.filter((item) => !item.checked),
    });
  }, [list, saveList]);

  const clearAll = useCallback(async () => {
    await saveList(EMPTY_LIST);
  }, [saveList]);

  const addFromRecipe = useCallback(
    async (
      ingredients: { name: string; amount?: string; unit?: string; category?: string }[],
      recipeId: string
    ): Promise<{ added: number; skippedDuplicates: number }> => {
      // Use ref to get latest list state (avoids stale closure when called in a loop)
      const currentList = listRef.current;

      // Check against ALL existing items on the list (not just same recipe)
      // to avoid duplicating manually-added items or items from other recipes
      const existingNames = new Set(
        currentList.items.map((i) => i.name.toLowerCase().trim())
      );

      const userName = localStorage.getItem("whisk_display_name") ?? undefined;
      const newItems: ShoppingItem[] = ingredients
        .filter((ing) => !existingNames.has(cleanIngredientName(ing.name).toLowerCase()))
        .map((ing) => {
          const name = cleanIngredientName(ing.name);
          // Use recipe's category if it's a valid, meaningful ShoppingCategory;
          // "other" means uncategorized, so always re-categorize those
          const recipeCategory = ing.category?.toLowerCase() as ShoppingCategory | undefined;
          const category = (recipeCategory && recipeCategory !== "other" && VALID_CATEGORIES.has(recipeCategory))
            ? recipeCategory
            : categorizeIngredient(name);
          return {
            id: nanoid(10),
            name,
            amount: ing.amount,
            unit: ing.unit,
            category,
            checked: false,
            sourceRecipeId: recipeId,
            addedBy: "recipe" as const,
            addedByUser: userName,
          };
        });

      if (newItems.length > 0) {
        await saveList({ ...currentList, items: [...currentList.items, ...newItems] });
      }

      return {
        added: newItems.length,
        skippedDuplicates: ingredients.length - newItems.length,
      };
    },
    [saveList]
  );

  const removeFromRecipe = useCallback(
    async (recipeId: string) => {
      await saveList({
        ...list,
        items: list.items.filter((item) => item.sourceRecipeId !== recipeId),
      });
    },
    [list, saveList]
  );

  /** Remove recipe-sourced items whose sourceRecipeId is not in the current plan */
  const removeStaleRecipeItems = useCallback(
    async (currentPlanRecipeIds: string[]): Promise<{ removed: number; recipesAffected: number }> => {
      const planSet = new Set(currentPlanRecipeIds);
      const staleItems = list.items.filter(
        (item) => item.addedBy === "recipe" && item.sourceRecipeId && !planSet.has(item.sourceRecipeId)
      );
      if (staleItems.length === 0) return { removed: 0, recipesAffected: 0 };

      const staleIds = new Set(staleItems.map((i) => i.id));
      const recipesAffected = new Set(staleItems.map((i) => i.sourceRecipeId!)).size;
      await saveList({
        ...list,
        items: list.items.filter((item) => !staleIds.has(item.id)),
      });
      return { removed: staleItems.length, recipesAffected };
    },
    [list, saveList]
  );

  const updateItem = useCallback(
    async (itemId: string, updates: Partial<Pick<ShoppingItem, "category" | "name">>) => {
      await saveList({
        ...list,
        items: list.items.map((item) =>
          item.id === itemId ? { ...item, ...updates } : item
        ),
      });
    },
    [list, saveList]
  );

  const clearCategory = useCallback(
    async (category: ShoppingCategory) => {
      await saveList({
        ...list,
        items: list.items.filter((item) => item.category !== category),
      });
    },
    [list, saveList]
  );

  const classifyUncategorized = useCallback(async () => {
    // Send items that need classification: "other" category OR missing subcategory
    const needsClassification = list.items.filter(
      (i) => i.category === "other" || !i.subcategory
    );
    if (needsClassification.length === 0) return;

    // Build a map from item ID to its index in the needsClassification array
    const idToIndex = new Map<string, number>();
    needsClassification.forEach((item, idx) => idToIndex.set(item.id, idx));

    try {
      const result = await api.post<{ items: { name: string; category: string; subcategory?: string }[] }>(
        "/shopping/classify",
        { items: needsClassification.map((i) => i.name) }
      );

      if (result?.items) {
        const updatedItems = list.items.map((item) => {
          const idx = idToIndex.get(item.id);
          if (idx === undefined) return item;
          const classified = result.items[idx];
          if (!classified) return item;

          const updates: Partial<ShoppingItem> = {};
          // Only update category if it was "other"
          if (item.category === "other" && classified.category !== "other") {
            updates.category = classified.category as ShoppingCategory;
          }
          // Always update subcategory if we got one
          if (classified.subcategory && !item.subcategory) {
            updates.subcategory = classified.subcategory;
          }
          // Clean up stale names (trailing ", and", extra spaces, etc.)
          const cleanedName = cleanIngredientName(item.name);
          if (cleanedName !== item.name) {
            updates.name = cleanedName;
          }
          return Object.keys(updates).length > 0 ? { ...item, ...updates } : item;
        });

        await saveList({ ...list, items: updatedItems });
      }
    } catch {
      // AI classification failed silently
    }
  }, [list, saveList]);

  return {
    list,
    isLoading,
    addItem,
    toggleItem,
    removeItem,
    clearChecked,
    clearAll,
    addFromRecipe,
    removeFromRecipe,
    removeStaleRecipeItems,
    updateItem,
    clearCategory,
    classifyUncategorized,
  };
}
