import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { getLocal, setLocal, CACHE_KEYS } from "../lib/cache";
import { nanoid } from "nanoid";
import type { MealPlan, PlannedMeal, MealSlot } from "../types";
import { getWeekId, toDateString } from "../lib/utils";

function emptyPlan(date: Date): MealPlan {
  return {
    id: getWeekId(date),
    meals: [],
    updatedAt: new Date().toISOString(),
  };
}

export function useMealPlan() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const weekId = getWeekId(currentDate);

  // Instant load from cache
  const [plan, setPlan] = useState<MealPlan>(
    () => getLocal<MealPlan>(CACHE_KEYS.MEAL_PLAN(weekId)) ?? emptyPlan(currentDate)
  );
  const [isLoading, setIsLoading] = useState(
    () => !getLocal(CACHE_KEYS.MEAL_PLAN(weekId))
  );

  // Background sync when week changes
  useEffect(() => {
    const cached = getLocal<MealPlan>(CACHE_KEYS.MEAL_PLAN(weekId));
    if (cached) {
      setPlan(cached);
      setIsLoading(false);
    }

    api
      .get<MealPlan>(`/plan?week=${weekId}`)
      .then((data) => {
        const result = data ?? emptyPlan(currentDate);
        setPlan(result);
        setLocal(CACHE_KEYS.MEAL_PLAN(weekId), result);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [weekId, currentDate]);

  // Optimistic save
  const savePlan = useCallback(
    async (updated: MealPlan) => {
      const withTimestamp = { ...updated, updatedAt: new Date().toISOString() };
      setPlan(withTimestamp);
      setLocal(CACHE_KEYS.MEAL_PLAN(updated.id), withTimestamp);
      api.put("/plan", withTimestamp).catch(() => {});
    },
    []
  );

  const addMeal = useCallback(
    async (date: Date, slot: MealSlot, title: string, recipeId?: string) => {
      const meal: PlannedMeal = {
        id: nanoid(10),
        date: toDateString(date),
        slot,
        title,
        recipeId,
      };
      await savePlan({ ...plan, meals: [...plan.meals, meal] });
    },
    [plan, savePlan]
  );

  const removeMeal = useCallback(
    async (mealId: string) => {
      await savePlan({
        ...plan,
        meals: plan.meals.filter((m) => m.id !== mealId),
      });
    },
    [plan, savePlan]
  );

  const clearWeek = useCallback(
    async () => {
      await savePlan({ ...plan, meals: [] });
    },
    [plan, savePlan]
  );

  const updateMeal = useCallback(
    async (mealId: string, changes: Partial<PlannedMeal>) => {
      await savePlan({
        ...plan,
        meals: plan.meals.map((m) =>
          m.id === mealId ? { ...m, ...changes } : m
        ),
      });
    },
    [plan, savePlan]
  );

  const replaceMealsForDate = useCallback(
    async (date: Date, newMeals: { slot: MealSlot; title: string; recipeId?: string }[]) => {
      const dateStr = toDateString(date);
      const kept = plan.meals.filter((m) => m.date !== dateStr);
      const added = newMeals.map((m) => ({
        id: nanoid(10),
        date: dateStr,
        slot: m.slot,
        title: m.title,
        recipeId: m.recipeId,
      }));
      await savePlan({ ...plan, meals: [...kept, ...added] });
    },
    [plan, savePlan]
  );

  const goToNextWeek = useCallback(() => {
    setCurrentDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + 7);
      return next;
    });
  }, []);

  const goToPrevWeek = useCallback(() => {
    setCurrentDate((d) => {
      const prev = new Date(d);
      prev.setDate(prev.getDate() - 7);
      return prev;
    });
  }, []);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const getMealsForDate = useCallback(
    (date: Date): PlannedMeal[] => {
      const dateStr = toDateString(date);
      return plan.meals.filter((m) => m.date === dateStr);
    },
    [plan]
  );

  const toggleCompleted = useCallback(
    async (mealId: string) => {
      await savePlan({
        ...plan,
        meals: plan.meals.map((m) =>
          m.id === mealId ? { ...m, completed: !m.completed } : m
        ),
      });
    },
    [plan, savePlan]
  );

  // Clipboard for copy/paste week
  const [copiedMeals, setCopiedMeals] = useState<PlannedMeal[] | null>(null);

  const copyWeek = useCallback(() => {
    setCopiedMeals(plan.meals);
  }, [plan.meals]);

  const pasteWeek = useCallback(
    async (targetWeekId: string) => {
      if (!copiedMeals || copiedMeals.length === 0) return;

      // Calculate date offset from source week to target week
      const sourceWeekDates = copiedMeals.map((m) => m.date).sort();
      const firstSourceDate = sourceWeekDates[0];
      if (!firstSourceDate) return;

      // Parse target week ID to get the Monday of that week
      const targetYear = parseInt(targetWeekId.slice(0, 4), 10);
      const targetWeekNum = parseInt(targetWeekId.slice(6), 10);
      // ISO week date: Jan 4 is always in week 1
      const jan4 = new Date(targetYear, 0, 4);
      const dayOfWeek = jan4.getDay() || 7; // Mon=1..Sun=7
      const targetMonday = new Date(jan4);
      targetMonday.setDate(jan4.getDate() - dayOfWeek + 1 + (targetWeekNum - 1) * 7);

      const sourceDate = new Date(firstSourceDate + "T00:00:00");
      const sourceDayOfWeek = sourceDate.getDay() || 7;
      const sourceMonday = new Date(sourceDate);
      sourceMonday.setDate(sourceDate.getDate() - sourceDayOfWeek + 1);

      const dayOffset = Math.round(
        (targetMonday.getTime() - sourceMonday.getTime()) / (1000 * 60 * 60 * 24)
      );

      const newMeals = copiedMeals.map((m) => {
        const d = new Date(m.date + "T00:00:00");
        d.setDate(d.getDate() + dayOffset);
        return {
          ...m,
          id: nanoid(10),
          date: toDateString(d),
          completed: false,
        };
      });

      // Load target week's plan from cache or create empty
      const cached = getLocal<MealPlan>(CACHE_KEYS.MEAL_PLAN(targetWeekId));
      const targetPlan = cached ?? { id: targetWeekId, meals: [], updatedAt: "" };
      await savePlan({
        ...targetPlan,
        meals: [...targetPlan.meals, ...newMeals],
      });
    },
    [copiedMeals, savePlan]
  );

  const getWeekHistory = useCallback(
    (count: number): { id: string; dateRange: string; mealCount: number; completionRate: number }[] => {
      const history: { id: string; dateRange: string; mealCount: number; completionRate: number }[] = [];
      const now = new Date();
      for (let i = 1; i <= count; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i * 7);
        const wId = getWeekId(d);
        const cached = getLocal<MealPlan>(CACHE_KEYS.MEAL_PLAN(wId));
        if (cached && cached.meals.length > 0) {
          const weekDates = cached.meals.map((m) => m.date).sort();
          const completed = cached.meals.filter((m) => m.completed).length;
          history.push({
            id: wId,
            dateRange: `${weekDates[0]} – ${weekDates[weekDates.length - 1]}`,
            mealCount: cached.meals.length,
            completionRate: cached.meals.length > 0 ? completed / cached.meals.length : 0,
          });
        }
      }
      return history;
    },
    []
  );

  return {
    plan,
    currentDate,
    isLoading,
    addMeal,
    removeMeal,
    replaceMealsForDate,
    clearWeek,
    updateMeal,
    goToNextWeek,
    goToPrevWeek,
    goToToday,
    getMealsForDate,
    toggleCompleted,
    copyWeek,
    pasteWeek,
    copiedMeals,
    getWeekHistory,
    fetchPlan: () => {},
  };
}
