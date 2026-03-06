import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { PlannedMeal, MealSlot, RecipeIndexEntry, Ingredient } from "../../types";
import { getWeekDates, formatDateShort, toDateString, classNames } from "../../lib/utils";
import { ChevronLeft, ChevronRight, XMark, ShoppingCart, CalendarDays, ClipboardList, WhiskLogo } from "../ui/Icon";

const ALL_MEAL_SLOTS: { slot: MealSlot; label: string }[] = [
  { slot: "breakfast", label: "Breakfast" },
  { slot: "lunch", label: "Lunch" },
  { slot: "dinner", label: "Dinner" },
];

function getEnabledSlots(): MealSlot[] {
  try {
    const raw = localStorage.getItem("whisk_meal_slots");
    if (raw) {
      const parsed = JSON.parse(raw) as MealSlot[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return ["dinner"];
}

interface MealPlanProps {
  currentDate: Date;
  getMealsForDate: (date: Date) => PlannedMeal[];
  onAddMeal: (date: Date, slot: MealSlot, title: string, recipeId?: string) => void;
  onRemoveMeal: (mealId: string) => void;
  onNextWeek: () => void;
  onPrevWeek: () => void;
  onToday: () => void;
  isLoading: boolean;
  recipeIndex?: RecipeIndexEntry[];
  onGenerateShoppingList?: (ingredients: Ingredient[], recipeId: string) => Promise<{ added: number; skippedDuplicates: number }>;
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
  recipeIndex = [],
  onGenerateShoppingList,
}: MealPlanProps) {
  const navigate = useNavigate();
  const weekDates = getWeekDates(currentDate);
  const enabledSlots = useMemo(() => getEnabledSlots(), []);
  const mealSlots = useMemo(
    () => ALL_MEAL_SLOTS.filter((s) => enabledSlots.includes(s.slot)),
    [enabledSlots]
  );
  const [addingSlot, setAddingSlot] = useState<{
    date: Date;
    slot: MealSlot;
  } | null>(null);
  const [mealInput, setMealInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [shoppingListStatus, setShoppingListStatus] = useState<string | null>(null);
  const [planLayout, setPlanLayout] = useState<"list" | "tiles">(() => {
    const saved = localStorage.getItem("whisk_plan_layout") as "list" | "tiles" | null;
    if (saved) return saved;
    // Default to tiles unless all 3 meal slots are enabled
    return enabledSlots.length >= 3 ? "list" : "tiles";
  });

  const today = toDateString(new Date());

  // Filter recipes based on input for autocomplete
  const suggestions = useMemo(() => {
    if (!mealInput.trim() || recipeIndex.length === 0) return [];
    const query = mealInput.toLowerCase();
    return recipeIndex
      .filter((r) => r.title.toLowerCase().includes(query))
      .slice(0, 6);
  }, [mealInput, recipeIndex]);

  // Reset suggestion index when suggestions change
  useEffect(() => {
    setSelectedSuggestionIndex(-1);
  }, [suggestions.length]);

  const handleAddMeal = (title?: string, recipeId?: string) => {
    if (!addingSlot) return;
    const mealTitle = title ?? mealInput.trim();
    if (!mealTitle) return;
    onAddMeal(addingSlot.date, addingSlot.slot, mealTitle, recipeId);
    setMealInput("");
    setAddingSlot(null);
    setShowSuggestions(false);
  };

  const handleSelectSuggestion = (recipe: RecipeIndexEntry) => {
    handleAddMeal(recipe.title, recipe.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === "Enter") handleAddMeal();
      if (e.key === "Escape") setAddingSlot(null);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) =>
        prev > 0 ? prev - 1 : suggestions.length - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = suggestions[selectedSuggestionIndex];
      if (selected) {
        handleSelectSuggestion(selected);
      } else {
        handleAddMeal();
      }
    } else if (e.key === "Escape") {
      if (showSuggestions) {
        setShowSuggestions(false);
      } else {
        setAddingSlot(null);
      }
    }
  };

  // Collect all planned meals for the week that have recipe IDs
  const weekMeals = useMemo(() => {
    const meals: PlannedMeal[] = [];
    for (const date of weekDates) {
      meals.push(...getMealsForDate(date));
    }
    return meals;
  }, [weekDates, getMealsForDate]);

  const linkedRecipeIds = useMemo(() => {
    return [...new Set(weekMeals.filter((m) => m.recipeId).map((m) => m.recipeId!))];
  }, [weekMeals]);

  const handleGenerateShoppingList = async () => {
    if (!onGenerateShoppingList || linkedRecipeIds.length === 0) return;

    setShoppingListStatus("loading");
    let totalAdded = 0;
    let totalSkipped = 0;

    try {
      // Fetch full recipe details for each linked recipe and add ingredients
      for (const recipeId of linkedRecipeIds) {
        const recipe = recipeIndex.find((r) => r.id === recipeId);
        if (!recipe) continue;

        // We need to fetch the full recipe to get ingredients
        const res = await fetch(`/api/recipes/${recipeId}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
          },
        });
        if (!res.ok) continue;
        const fullRecipe = (await res.json()) as { ingredients: Ingredient[] };
        if (!fullRecipe.ingredients?.length) continue;

        const result = await onGenerateShoppingList(fullRecipe.ingredients, recipeId);
        totalAdded += result.added;
        totalSkipped += result.skippedDuplicates;
      }

      if (totalAdded > 0) {
        setShoppingListStatus(`Added ${totalAdded} item${totalAdded !== 1 ? "s" : ""} to shopping list${totalSkipped > 0 ? ` (${totalSkipped} already on list)` : ""}`);
      } else if (totalSkipped > 0) {
        setShoppingListStatus("All ingredients already on your list");
      } else {
        setShoppingListStatus("No ingredients to add");
      }
      setTimeout(() => setShoppingListStatus(null), 4000);
    } catch {
      setShoppingListStatus("Failed to generate list");
      setTimeout(() => setShoppingListStatus(null), 3000);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
        <div className="flex items-center justify-between py-3">
          <button onClick={() => navigate("/settings")} title="Settings" className="flex items-center gap-1.5">
            <WhiskLogo className="w-5 h-5 text-orange-500" />
            <span className="text-lg font-bold text-orange-500">W</span>
            <span className="text-stone-300 dark:text-stone-600 font-light">|</span>
            <h1 className="text-lg font-bold dark:text-stone-100">Plan</h1>
          </button>
          <div className="flex items-center gap-2">
            {linkedRecipeIds.length > 0 && onGenerateShoppingList && (
              <button
                onClick={handleGenerateShoppingList}
                disabled={shoppingListStatus === "loading"}
                className="flex items-center gap-1.5 text-xs font-medium text-orange-500 border border-orange-500 px-2 py-1 rounded-md hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors disabled:opacity-50"
                title="Add ingredients from planned recipes to shopping list"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                Shop
              </button>
            )}
            <button
              onClick={() => {
                const next = planLayout === "list" ? "tiles" : "list";
                setPlanLayout(next);
                localStorage.setItem("whisk_plan_layout", next);
              }}
              className="p-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
              title={planLayout === "list" ? "Switch to tiles" : "Switch to list"}
            >
              {planLayout === "list" ? (
                <CalendarDays className="w-4.5 h-4.5" />
              ) : (
                <ClipboardList className="w-4.5 h-4.5" />
              )}
            </button>
            <button
              onClick={onToday}
              className="text-xs font-medium text-orange-500 border border-orange-500 px-2 py-1 rounded-md"
            >
              Today
            </button>
          </div>
        </div>

        {/* Shopping list status */}
        {shoppingListStatus && shoppingListStatus !== "loading" && (
          <div className="pb-2">
            <p className="text-xs text-green-600 dark:text-green-400 font-medium">{shoppingListStatus}</p>
          </div>
        )}

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

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-24">
        {planLayout === "tiles" ? (
          /* Tile view — compact grid */
          <div className="grid grid-cols-2 gap-2 px-4 py-3">
            {weekDates.map((date) => {
              const dateStr = toDateString(date);
              const isToday = dateStr === today;
              const meals = getMealsForDate(date);
              const filledMeals = meals.filter((m) => mealSlots.some((s) => s.slot === m.slot));
              const tileAdding = addingSlot?.date.getTime() === date.getTime();

              return (
                <div
                  key={dateStr}
                  className={classNames(
                    "rounded-xl border p-3",
                    isToday
                      ? "border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-950/20"
                      : "border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900"
                  )}
                >
                  <p className={classNames(
                    "text-xs font-semibold mb-1.5",
                    isToday ? "text-orange-500" : "text-stone-500 dark:text-stone-400"
                  )}>
                    {isToday ? "Today" : formatDateShort(date)}
                  </p>
                  {filledMeals.length > 0 && (
                    <div className="space-y-1">
                      {filledMeals.map((meal) => (
                        <div key={meal.id} className="flex items-center justify-between gap-1">
                          <button
                            onClick={() => { if (meal.recipeId) navigate(`/recipes/${meal.recipeId}`); }}
                            className={classNames(
                              "text-xs truncate flex-1 text-left",
                              meal.recipeId
                                ? "text-orange-600 dark:text-orange-400 font-medium"
                                : "text-stone-600 dark:text-stone-300"
                            )}
                          >
                            {meal.title}
                          </button>
                          <button
                            onClick={() => onRemoveMeal(meal.id)}
                            className="text-stone-300 hover:text-red-500 dark:text-stone-600 flex-shrink-0"
                          >
                            <XMark className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {tileAdding ? (
                    <div className="mt-1 relative">
                      <input
                        ref={inputRef}
                        className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                        placeholder="Search or type..."
                        value={mealInput}
                        onChange={(e) => {
                          setMealInput(e.target.value);
                          setShowSuggestions(e.target.value.trim().length > 0);
                        }}
                        onFocus={() => { if (mealInput.trim()) setShowSuggestions(true); }}
                        onBlur={() => { setTimeout(() => setShowSuggestions(false), 200); }}
                        onKeyDown={handleKeyDown}
                        autoFocus
                      />
                      {showSuggestions && suggestions.length > 0 && (
                        <div
                          ref={suggestionsRef}
                          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800 overflow-hidden max-h-36 overflow-y-auto"
                        >
                          {suggestions.map((recipe, i) => (
                            <button
                              key={recipe.id}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleSelectSuggestion(recipe)}
                              className={classNames(
                                "w-full px-2 py-1.5 text-left text-xs flex items-center gap-2",
                                i === selectedSuggestionIndex
                                  ? "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300"
                                  : "dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700"
                              )}
                            >
                              {recipe.thumbnailUrl ? (
                                <img src={recipe.thumbnailUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-6 h-6 rounded bg-stone-100 dark:bg-stone-700 flex-shrink-0" />
                              )}
                              <span className="truncate">{recipe.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingSlot({ date, slot: mealSlots[0]?.slot ?? "dinner" })}
                      className={classNames(
                        "text-[10px] text-orange-500 font-medium",
                        filledMeals.length > 0 && "mt-1"
                      )}
                    >
                      + add
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* List view — detailed day-by-day */
          <div className="px-4 py-3 space-y-4">
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
                  {mealSlots.map(({ slot, label }) => {
                    const meal = meals.find((m) => m.slot === slot);
                    const isAdding =
                      addingSlot?.date.getTime() === date.getTime() &&
                      addingSlot?.slot === slot;

                    return (
                      <div
                        key={slot}
                        className="flex items-center gap-2 rounded-lg bg-stone-50 dark:bg-stone-900 dark:border dark:border-stone-800 px-3 py-2"
                      >
                        {mealSlots.length > 1 && (
                          <span className="flex-shrink-0 text-[10px] font-semibold text-stone-400 dark:text-stone-500 uppercase w-4">
                            {label.charAt(0)}
                          </span>
                        )}

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
                          <div className="flex-1 relative">
                            <div className="flex gap-2">
                              <input
                                ref={inputRef}
                                className="flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-base sm:text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                                placeholder={recipeIndex.length > 0 ? "Search recipes or type..." : "What's for dinner?"}
                                value={mealInput}
                                onChange={(e) => {
                                  setMealInput(e.target.value);
                                  setShowSuggestions(e.target.value.trim().length > 0);
                                }}
                                onFocus={() => {
                                  if (mealInput.trim()) setShowSuggestions(true);
                                }}
                                onBlur={() => {
                                  setTimeout(() => setShowSuggestions(false), 200);
                                }}
                                onKeyDown={handleKeyDown}
                                autoFocus
                              />
                              <button
                                onClick={() => handleAddMeal()}
                                className="text-xs text-orange-500 font-medium"
                              >
                                Add
                              </button>
                            </div>

                            {/* Recipe suggestions dropdown */}
                            {showSuggestions && suggestions.length > 0 && (
                              <div
                                ref={suggestionsRef}
                                className="absolute left-0 right-8 top-full mt-1 z-50 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800 overflow-hidden max-h-48 overflow-y-auto"
                              >
                                {suggestions.map((recipe, i) => (
                                  <button
                                    key={recipe.id}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => handleSelectSuggestion(recipe)}
                                    className={classNames(
                                      "w-full px-3 py-2 text-left text-sm flex items-center gap-2",
                                      i === selectedSuggestionIndex
                                        ? "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300"
                                        : "dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700"
                                    )}
                                  >
                                    {recipe.thumbnailUrl ? (
                                      <img
                                        src={recipe.thumbnailUrl}
                                        alt=""
                                        className="w-8 h-8 rounded object-cover flex-shrink-0"
                                      />
                                    ) : (
                                      <div className="w-8 h-8 rounded bg-stone-100 dark:bg-stone-700 flex-shrink-0" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="font-medium truncate">{recipe.title}</p>
                                      {recipe.tags.length > 0 && (
                                        <p className="text-[10px] text-stone-400 dark:text-stone-500 truncate">
                                          {recipe.tags.slice(0, 3).join(", ")}
                                        </p>
                                      )}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
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
        )}
      </div>
    </div>
  );
}
