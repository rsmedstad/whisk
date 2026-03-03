import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { getLocal, setLocal, CACHE_KEYS } from "../lib/cache";
import { nanoid } from "nanoid";
import type { ShoppingList, ShoppingItem, ShoppingCategory } from "../types";
import { categorizeIngredient } from "../lib/categories";

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
      await saveList({ ...list, items: [...list.items, item] });
    },
    [list, saveList]
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
      // Check if any items from this recipe are already on the list
      const existingFromRecipe = new Set(
        list.items
          .filter((i) => i.sourceRecipeId === recipeId)
          .map((i) => i.name.toLowerCase())
      );

      const userName = localStorage.getItem("whisk_display_name") ?? undefined;
      const newItems: ShoppingItem[] = ingredients
        .filter((ing) => !existingFromRecipe.has(ing.name.toLowerCase()))
        .map((ing) => ({
          id: nanoid(10),
          name: ing.name,
          amount: ing.amount,
          unit: ing.unit,
          category: (ing.category as ShoppingCategory) ?? categorizeIngredient(ing.name),
          checked: false,
          sourceRecipeId: recipeId,
          addedBy: "recipe" as const,
          addedByUser: userName,
        }));

      if (newItems.length > 0) {
        await saveList({ ...list, items: [...list.items, ...newItems] });
      }

      return {
        added: newItems.length,
        skippedDuplicates: ingredients.length - newItems.length,
      };
    },
    [list, saveList]
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
  };
}
