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

  return {
    plan,
    currentDate,
    isLoading,
    addMeal,
    removeMeal,
    updateMeal,
    goToNextWeek,
    goToPrevWeek,
    goToToday,
    getMealsForDate,
    fetchPlan: () => {},
  };
}
