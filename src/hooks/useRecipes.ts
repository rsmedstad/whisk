import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { getLocal, setLocal, CACHE_KEYS } from "../lib/cache";
import type { Recipe, RecipeIndexEntry } from "../types";
import { normalizeSearch } from "../lib/utils";

type SortOption = "recent" | "alpha" | "cookTime" | "lastViewed" | "category" | "mostCooked";

export function useRecipes() {
  // Initialize from local cache immediately — zero latency
  const [recipes, setRecipes] = useState<RecipeIndexEntry[]>(
    () => getLocal<RecipeIndexEntry[]>(CACHE_KEYS.RECIPE_INDEX) ?? []
  );
  const [isLoading, setIsLoading] = useState(() => {
    // Only show loading if cache is empty
    return !getLocal(CACHE_KEYS.RECIPE_INDEX);
  });
  const [error, setError] = useState<string | null>(null);

  // Background sync — updates UI when fresh data arrives
  const fetchRecipes = useCallback(async () => {
    try {
      const data = await api.get<RecipeIndexEntry[]>("/recipes");
      setRecipes(data);
      setLocal(CACHE_KEYS.RECIPE_INDEX, data);
      setError(null);
    } catch (err) {
      // Only set error if we have no cached data
      if (!getLocal(CACHE_KEYS.RECIPE_INDEX)) {
        setError(err instanceof Error ? err.message : "Failed to load recipes");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecipes();
  }, [fetchRecipes]);

  const getRecipe = useCallback(async (id: string): Promise<Recipe> => {
    // Try local cache first
    const cached = getLocal<Recipe>(CACHE_KEYS.RECIPE(id));
    if (cached) {
      // Background refresh
      api.get<Recipe>(`/recipes/${id}`)
        .then((fresh) => setLocal(CACHE_KEYS.RECIPE(id), fresh))
        .catch(() => {});
      return cached;
    }
    const recipe = await api.get<Recipe>(`/recipes/${id}`);
    setLocal(CACHE_KEYS.RECIPE(id), recipe);
    return recipe;
  }, []);

  const createRecipe = useCallback(
    async (recipe: Omit<Recipe, "id" | "createdAt" | "updatedAt">) => {
      const created = await api.post<Recipe>("/recipes", recipe);
      // Optimistic: add to local index immediately
      setRecipes((prev) => {
        const entry: RecipeIndexEntry = {
          id: created.id,
          title: created.title,
          tags: created.tags,
          cuisine: created.cuisine,
          favorite: created.favorite,
          updatedAt: created.updatedAt,
          thumbnailUrl: created.thumbnailUrl,
          prepTime: created.prepTime,
          cookTime: created.cookTime,
          servings: created.servings,
          description: created.description,
        };
        const updated = [entry, ...prev];
        setLocal(CACHE_KEYS.RECIPE_INDEX, updated);
        return updated;
      });
      setLocal(CACHE_KEYS.RECIPE(created.id), created);
      return created;
    },
    []
  );

  const updateRecipe = useCallback(
    async (id: string, updates: Partial<Recipe>) => {
      // Optimistic: update local state immediately
      setRecipes((prev) => {
        const updated = prev.map((r) =>
          r.id === id ? { ...r, ...updates, updatedAt: new Date().toISOString() } as RecipeIndexEntry : r
        );
        setLocal(CACHE_KEYS.RECIPE_INDEX, updated);
        return updated;
      });

      // Update cached full recipe
      const cachedFull = getLocal<Recipe>(CACHE_KEYS.RECIPE(id));
      if (cachedFull) {
        setLocal(CACHE_KEYS.RECIPE(id), { ...cachedFull, ...updates, updatedAt: new Date().toISOString() });
      }

      // Network sync in background
      const result = await api.put<Recipe>(`/recipes/${id}`, updates);
      setLocal(CACHE_KEYS.RECIPE(id), result);
      return result;
    },
    []
  );

  const deleteRecipe = useCallback(
    async (id: string) => {
      // Optimistic: remove from local immediately
      setRecipes((prev) => {
        const updated = prev.filter((r) => r.id !== id);
        setLocal(CACHE_KEYS.RECIPE_INDEX, updated);
        return updated;
      });

      // Network sync
      await api.delete(`/recipes/${id}`);
    },
    []
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      // Optimistic: toggle immediately, no waiting
      setRecipes((prev) => {
        const updated = prev.map((r) =>
          r.id === id ? { ...r, favorite: !r.favorite } : r
        );
        setLocal(CACHE_KEYS.RECIPE_INDEX, updated);
        return updated;
      });

      const recipe = recipes.find((r) => r.id === id);
      if (!recipe) return;

      // Background sync
      api.put(`/recipes/${id}`, { favorite: !recipe.favorite }).catch(() => {
        // Revert on failure
        setRecipes((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, favorite: recipe.favorite } : r
          )
        );
      });
    },
    [recipes]
  );

  const toggleWantToMake = useCallback(
    async (id: string) => {
      // Optimistic: toggle immediately
      setRecipes((prev) => {
        const updated = prev.map((r) =>
          r.id === id ? { ...r, wantToMake: !r.wantToMake } : r
        );
        setLocal(CACHE_KEYS.RECIPE_INDEX, updated);
        return updated;
      });

      const recipe = recipes.find((r) => r.id === id);
      if (!recipe) return;

      // Background sync
      api.put(`/recipes/${id}`, { wantToMake: !recipe.wantToMake }).catch(() => {
        // Revert on failure
        setRecipes((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, wantToMake: recipe.wantToMake } : r
          )
        );
      });
    },
    [recipes]
  );

  const markCooked = useCallback(
    async (id: string) => {
      const now = new Date().toISOString();
      const recipe = recipes.find((r) => r.id === id);
      const newCount = (recipe?.cookedCount ?? 0) + 1;

      // Optimistic: update local state immediately
      setRecipes((prev) => {
        const updated = prev.map((r) =>
          r.id === id ? { ...r, cookedCount: newCount, lastCookedAt: now } : r
        );
        setLocal(CACHE_KEYS.RECIPE_INDEX, updated);
        return updated;
      });

      // Update cached full recipe
      const cachedFull = getLocal<Recipe>(CACHE_KEYS.RECIPE(id));
      if (cachedFull) {
        setLocal(CACHE_KEYS.RECIPE(id), { ...cachedFull, cookedCount: newCount, lastCookedAt: now });
      }

      // Background sync
      api.put(`/recipes/${id}`, { cookedCount: newCount, lastCookedAt: now }).catch(() => {});
    },
    [recipes]
  );

  return {
    recipes,
    isLoading,
    error,
    fetchRecipes,
    getRecipe,
    createRecipe,
    updateRecipe,
    deleteRecipe,
    toggleFavorite,
    toggleWantToMake,
    markCooked,
  };
}

// Filtering + sorting as a separate pure function for the UI
export function filterAndSortRecipes(
  recipes: RecipeIndexEntry[],
  options: {
    search?: string;
    tags?: string[];
    favoritesOnly?: boolean;
    sort?: SortOption;
    maxTime?: number;
  }
): RecipeIndexEntry[] {
  let filtered = [...recipes];

  if (options.search) {
    const q = normalizeSearch(options.search);
    filtered = filtered.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)) ||
        r.cuisine?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
    );
  }

  if (options.tags?.length) {
    filtered = filtered.filter((r) =>
      options.tags!.every((t) => r.tags.includes(t))
    );
  }

  if (options.favoritesOnly) {
    filtered = filtered.filter((r) => r.favorite);
  }

  if (options.maxTime != null) {
    if (options.maxTime === Infinity) {
      // 60+ min: show recipes with total time > 60 or no time data
      filtered = filtered.filter((r) => {
        const total = (r.prepTime ?? 0) + (r.cookTime ?? 0);
        return total > 60 || total === 0;
      });
    } else {
      filtered = filtered.filter((r) => {
        const total = (r.prepTime ?? 0) + (r.cookTime ?? 0);
        return total > 0 && total <= options.maxTime!;
      });
    }
  }

  switch (options.sort) {
    case "category":
    case "alpha":
      filtered.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "cookTime":
      filtered.sort(
        (a, b) =>
          ((a.prepTime ?? 0) + (a.cookTime ?? 0)) -
          ((b.prepTime ?? 0) + (b.cookTime ?? 0))
      );
      break;
    case "mostCooked":
      filtered.sort(
        (a, b) => (b.cookedCount ?? 0) - (a.cookedCount ?? 0)
      );
      break;
    case "lastViewed":
    case "recent":
    default:
      filtered.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      break;
  }

  return filtered;
}
