import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PlannedMeal, MealSlot } from "../../types";
import { getWeekDates, formatDateShort, toDateString, classNames } from "../../lib/utils";
import { EmptyState } from "../ui/EmptyState";
import { Button } from "../ui/Button";
import { ChevronLeft, ChevronRight, XMark, Sunrise, Sun, Moon } from "../ui/Icon";
import type { ReactNode } from "react";

const MEAL_SLOTS: { slot: MealSlot; icon: ReactNode; label: string }[] = [
  { slot: "breakfast", icon: <Sunrise className="w-4 h-4 text-amber-500" />, label: "Breakfast" },
  { slot: "lunch", icon: <Sun className="w-4 h-4 text-orange-500" />, label: "Lunch" },
  { slot: "dinner", icon: <Moon className="w-4 h-4 text-indigo-500" />, label: "Dinner" },
];

interface MealPlanProps {
  currentDate: Date;
  getMealsForDate: (date: Date) => PlannedMeal[];
  onAddMeal: (date: Date, slot: MealSlot, title: string, recipeId?: string) => void;
  onRemoveMeal: (mealId: string) => void;
  onNextWeek: () => void;
  onPrevWeek: () => void;
  onToday: () => void;
  isLoading: boolean;
}

export function MealPlan({
  currentDate,
  getMealsForDate,
  onAddMeal,
  onRemoveMeal,
  onNextWeek,
  onPrevWeek,
  onToday,
  isLoading,
}: MealPlanProps) {
  const navigate = useNavigate();
  const weekDates = getWeekDates(currentDate);
  const [addingSlot, setAddingSlot] = useState<{
    date: Date;
    slot: MealSlot;
  } | null>(null);
  const [mealInput, setMealInput] = useState("");

  const today = toDateString(new Date());

  const handleAddMeal = () => {
    if (!addingSlot || !mealInput.trim()) return;
    onAddMeal(addingSlot.date, addingSlot.slot, mealInput.trim());
    setMealInput("");
    setAddingSlot(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
        <div className="flex items-center justify-between py-3">
          <h1 className="text-xl font-bold dark:text-stone-100">Meal Plan</h1>
          <button
            onClick={onToday}
            className="text-xs font-medium text-orange-500 border border-orange-500 px-2 py-1 rounded-md"
          >
            Today
          </button>
        </div>
        <div className="flex items-center justify-between pb-3">
          <button
            onClick={onPrevWeek}
            className="p-1 text-stone-500 dark:text-stone-400"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium dark:text-stone-200">
            {formatDateShort(weekDates[0]!)} &ndash;{" "}
            {formatDateShort(weekDates[6]!)}
          </span>
          <button
            onClick={onNextWeek}
            className="p-1 text-stone-500 dark:text-stone-400"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Day-by-day */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-24 space-y-4">
        {weekDates.map((date) => {
          const dateStr = toDateString(date);
          const isToday = dateStr === today;
          const meals = getMealsForDate(date);

          return (
            <section key={dateStr}>
              <h3
                className={classNames(
                  "text-sm font-semibold mb-2",
                  isToday
                    ? "text-orange-500"
                    : "text-stone-500 dark:text-orange-300/40"
                )}
              >
                {isToday && "Today \u00B7 "}
                {formatDateShort(date)}
              </h3>

              <div className="space-y-1.5">
                {MEAL_SLOTS.map(({ slot, icon, label }) => {
                  const meal = meals.find((m) => m.slot === slot);
                  const isAdding =
                    addingSlot?.date.getTime() === date.getTime() &&
                    addingSlot?.slot === slot;

                  return (
                    <div
                      key={slot}
                      className="flex items-center gap-2 rounded-lg bg-stone-50 dark:bg-stone-900 dark:border dark:border-stone-800 px-3 py-2"
                    >
                      <span className="flex-shrink-0">{icon}</span>

                      {meal ? (
                        <div className="flex-1 flex items-center justify-between min-w-0">
                          <button
                            onClick={() => {
                              if (meal.recipeId)
                                navigate(`/recipes/${meal.recipeId}`);
                            }}
                            className={classNames(
                              "text-sm truncate",
                              meal.recipeId
                                ? "text-orange-600 dark:text-orange-400 font-medium"
                                : "text-stone-700 dark:text-stone-300"
                            )}
                          >
                            {meal.title}
                          </button>
                          <button
                            onClick={() => onRemoveMeal(meal.id)}
                            className="text-stone-400 hover:text-red-500 ml-2 flex-shrink-0"
                          >
                            <XMark className="w-4 h-4" />
                          </button>
                        </div>
                      ) : isAdding ? (
                        <div className="flex-1 flex gap-2">
                          <input
                            className="flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-base sm:text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                            placeholder="What's for dinner?"
                            value={mealInput}
                            onChange={(e) => setMealInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddMeal();
                              if (e.key === "Escape") setAddingSlot(null);
                            }}
                            autoFocus
                          />
                          <button
                            onClick={handleAddMeal}
                            className="text-xs text-orange-500 font-medium"
                          >
                            Add
                          </button>
                        </div>
                      ) : (
                        <div className="flex-1 flex items-center justify-between">
                          <span className="text-xs text-stone-400 dark:text-stone-500">
                            {label}
                          </span>
                          <button
                            onClick={() =>
                              setAddingSlot({ date, slot })
                            }
                            className="text-xs text-orange-500 font-medium"
                          >
                            + add
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
