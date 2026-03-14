import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { PlannedMeal, MealSlot, RecipeIndexEntry, Ingredient } from "../../types";
import { getWeekDates, formatDateShort, toDateString, classNames } from "../../lib/utils";
import { getSeasonalContext } from "../../lib/seasonal";
import { ChevronLeft, ChevronRight, XMark, ShoppingCart, CalendarDays, ClipboardList, WhiskLogo, EllipsisVertical, Clock, Sparkles, Dice } from "../ui/Icon";
import { SeasonalBrandIcon } from "../ui/SeasonalBrandIcon";

const PANTRY_STAPLES = new Set([
  "salt", "pepper", "black pepper", "kosher salt", "sea salt", "table salt",
  "salt & pepper", "salt and pepper", "freshly ground black pepper", "ground pepper",
  "olive oil", "vegetable oil", "canola oil", "extra virgin olive oil", "extra-virgin olive oil",
  "cooking spray", "nonstick spray", "oil", "ice",
]);

/** Check if an ingredient name is a pantry staple that should be excluded */
function isPantryStaple(name: string): boolean {
  const lower = name.toLowerCase().trim();
  // Exact match
  if (PANTRY_STAPLES.has(lower)) return true;
  // "water" — exclude plain water but keep sparkling, flavored, etc.
  if (/^water$/.test(lower) || /^\d+.*\btap water\b/.test(lower) || /^\d+[\s-]*(tbsp|tsp|cup|ml|oz)?\s*water$/i.test(lower)) return true;
  // Grouped items like "salt & pepper", "salt, pepper" split check
  if (lower.includes("&") || lower.includes(" and ") || lower.includes(",")) {
    const parts = lower.split(/[&,]|\band\b/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0 && parts.every((p) => PANTRY_STAPLES.has(p))) return true;
  }
  return false;
}

// Tags that signal a recipe fits a particular meal slot
const SLOT_TAGS: Record<MealSlot, string[]> = {
  breakfast: ["breakfast", "brunch", "morning", "pancakes", "waffles", "eggs"],
  lunch: ["lunch", "salad", "sandwich", "soup", "wrap", "light"],
  dinner: ["dinner", "main", "entree", "entrée", "supper"],
  snack: ["snack", "appetizer", "dip", "finger food", "side"],
  dessert: ["dessert", "desserts", "baking", "cake", "cookie", "sweet"],
  extra: [],
};

/** Score a recipe for quick-add ranking. Higher = better suggestion. */
function recipeScore(
  r: RecipeIndexEntry,
  slot: MealSlot,
  seasonalIngredients: string[],
  seasonalTags: string[],
): number {
  let score = 0;

  // Slot match bonus — strongest signal
  const slotTags = SLOT_TAGS[slot] ?? [];
  const tagsLower = r.tags.map((t) => t.toLowerCase());
  if (tagsLower.some((t) => slotTags.includes(t))) score += 50;

  // Exclude component recipes (sauces, condiments, basics) — they aren't standalone meals
  const NON_MEAL_TAGS = ["sauce", "condiment", "dressing", "marinade", "spice mix", "seasoning", "base", "stock", "broth", "other"];
  if (tagsLower.some((t) => NON_MEAL_TAGS.includes(t))) score -= 200;

  // Penalize recipes that don't match ANY meal slot — likely not a standalone meal
  const allMealTags = Object.values(SLOT_TAGS).flat();
  if (!tagsLower.some((t) => allMealTags.includes(t))) score -= 40;

  // Seasonal tag match — recipe tagged with current season or holiday
  if (seasonalTags.length > 0 && r.tags.some((t) => seasonalTags.includes(t.toLowerCase()))) score += 25;

  // Seasonal ingredient match — recipe title/description mentions in-season produce
  if (seasonalIngredients.length > 0) {
    const titleLower = r.title.toLowerCase();
    const descLower = (r.description ?? "").toLowerCase();
    const text = `${titleLower} ${descLower}`;
    const matches = seasonalIngredients.filter((ing) => text.includes(ing));
    score += Math.min(matches.length * 10, 30);
  }

  // Rating (0-5 scale, weighted heavily)
  if (r.avgRating) score += r.avgRating * 8;

  // Cooked count — proven recipes bubble up
  if (r.cookedCount) score += Math.min(r.cookedCount * 3, 30);

  // Favorite — bonus but not the only signal
  if (r.favorite) score += 15;

  // Prefer easier recipes — hard ones are unlikely "quick fill" choices
  if (r.difficulty === "easy") score += 15;
  else if (r.difficulty === "medium") score += 5;
  else if (r.difficulty === "hard") score -= 20;

  // Recency tiebreaker — recently updated recipes slightly preferred
  const age = Date.now() - new Date(r.updatedAt).getTime();
  const daysSinceUpdate = age / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate < 30) score += 5;

  return score;
}

/** Pick a random recipe from the top candidates using weighted selection */
function weightedRandomPick<T extends { score: number }>(candidates: T[]): T | undefined {
  if (candidates.length === 0) return undefined;
  // Use top candidates (score > 0), add randomness so it's not always the same
  const pool = candidates.filter((c) => c.score > 0).slice(0, 12);
  if (pool.length === 0) return candidates[0];
  // Weighted random: score acts as weight
  const totalWeight = pool.reduce((sum, c) => sum + Math.max(c.score, 1), 0);
  let roll = Math.random() * totalWeight;
  for (const c of pool) {
    roll -= Math.max(c.score, 1);
    if (roll <= 0) return c;
  }
  return pool[pool.length - 1];
}

const ALL_MEAL_SLOTS: { slot: MealSlot; label: string }[] = [
  { slot: "breakfast", label: "Breakfast" },
  { slot: "lunch", label: "Lunch" },
  { slot: "dinner", label: "Dinner" },
  { slot: "snack", label: "Snack" },
  { slot: "dessert", label: "Dessert" },
  { slot: "extra", label: "Extra" },
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
  onCopyWeek?: () => void;
  onPasteWeek?: (targetWeekId: string) => void;
  copiedMeals?: PlannedMeal[] | null;
  getWeekHistory?: (count: number) => { id: string; dateRange: string; mealCount: number; completionRate: number }[];
  weekId?: string;
  onToggleWantToMake?: (id: string) => void;
  onClearWeek?: () => void;
  onReplaceMealsForDate?: (date: Date, newMeals: { slot: MealSlot; title: string; recipeId?: string }[]) => void;
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
  onCopyWeek,
  onPasteWeek,
  copiedMeals,
  getWeekHistory,
  weekId,
  onToggleWantToMake,
  onClearWeek,
  onReplaceMealsForDate,
}: MealPlanProps) {
  const navigate = useNavigate();
  const weekDates = getWeekDates(currentDate);

  // Seasonal context for scoring
  const seasonal = useMemo(() => getSeasonalContext(new Date()), []);
  const seasonalIngredients = seasonal.seasonalIngredients;
  const seasonalTags = seasonal.seasonalTags;



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
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [planLayout, setPlanLayout] = useState<"list" | "tiles">(() => {
    const saved = localStorage.getItem("whisk_plan_layout") as "list" | "tiles" | null;
    if (saved) return saved;
    // Default to tiles unless all 3 meal slots are enabled
    return enabledSlots.length >= 3 ? "list" : "tiles";
  });

  const today = toDateString(new Date());

  // Want to Make recipes
  const wantToMakeRecipes = useMemo(
    () => recipeIndex.filter((r) => r.wantToMake),
    [recipeIndex]
  );
  const [planningRecipe, setPlanningRecipe] = useState<RecipeIndexEntry | null>(null);
  const [wtmPlanDate, setWtmPlanDate] = useState(() => toDateString(new Date()));
  const [wtmPlanSlot, setWtmPlanSlot] = useState<MealSlot>("dinner");

  const handleWtmAddToPlan = () => {
    if (!planningRecipe) return;
    const d = new Date(wtmPlanDate + "T12:00:00");
    onAddMeal(d, wtmPlanSlot, planningRecipe.title, planningRecipe.id);
    if (onToggleWantToMake) onToggleWantToMake(planningRecipe.id);
    setPlanningRecipe(null);
  };

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

  const handleGenerateShoppingList = async (essentialsOnly: boolean) => {
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

        const ings = essentialsOnly
          ? fullRecipe.ingredients.filter((i) => !isPantryStaple(i.name))
          : fullRecipe.ingredients;

        const result = await onGenerateShoppingList(ings, recipeId);
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

  const handleAutoFillEmptySlots = useCallback(() => {
    const usedRecipeIds = new Set<string>();
    const todayStr = toDateString(new Date());
    // Gather already-planned recipe IDs for this week
    for (const date of weekDates) {
      const meals = getMealsForDate(date);
      for (const meal of meals) {
        if (meal.recipeId) usedRecipeIds.add(meal.recipeId);
      }
    }
    let filled = 0;
    for (const date of weekDates) {
      // Only fill today and future days
      if (toDateString(date) < todayStr) continue;
      const meals = getMealsForDate(date);
      for (const { slot } of mealSlots) {
        const hasMeal = meals.some((m) => m.slot === slot);
        if (hasMeal) continue;
        const candidates = recipeIndex
          .filter((r) => !usedRecipeIds.has(r.id))
          .map((r) => ({ recipe: r, score: recipeScore(r, slot, seasonalIngredients, seasonalTags) }))
          .sort((a, b) => b.score - a.score);
        const pick = weightedRandomPick(candidates);
        if (pick) {
          onAddMeal(date, slot, pick.recipe.title, pick.recipe.id);
          usedRecipeIds.add(pick.recipe.id);
          filled++;
        }
      }
    }
    return filled;
  }, [weekDates, getMealsForDate, mealSlots, recipeIndex, seasonalIngredients, seasonalTags, onAddMeal]);

  const handleRerollDay = useCallback((date: Date) => {
    const meals = getMealsForDate(date);
    // Gather recipe IDs used elsewhere this week (exclude this day)
    const usedElsewhere = new Set<string>();
    for (const d of weekDates) {
      if (toDateString(d) === toDateString(date)) continue;
      for (const m of getMealsForDate(d)) {
        if (m.recipeId) usedElsewhere.add(m.recipeId);
      }
    }
    // Also exclude recipes currently on this day so re-roll picks new ones
    const currentIds = new Set(meals.filter((m) => m.recipeId).map((m) => m.recipeId!));

    // Build new meals for each enabled slot
    const usedThisRoll = new Set<string>();
    const newMeals: { slot: MealSlot; title: string; recipeId?: string }[] = [];
    for (const { slot } of mealSlots) {
      const candidates = recipeIndex
        .filter((r) => !usedElsewhere.has(r.id) && !currentIds.has(r.id) && !usedThisRoll.has(r.id))
        .map((r) => ({ recipe: r, score: recipeScore(r, slot, seasonalIngredients, seasonalTags) }))
        .sort((a, b) => b.score - a.score);
      const pick = weightedRandomPick(candidates);
      if (pick) {
        newMeals.push({ slot, title: pick.recipe.title, recipeId: pick.recipe.id });
        usedThisRoll.add(pick.recipe.id);
      }
    }

    // Atomically replace all meals for this day in a single state update
    if (onReplaceMealsForDate) {
      onReplaceMealsForDate(date, newMeals);
    } else {
      // Fallback: remove then add (may have stale state issues)
      for (const meal of meals) {
        onRemoveMeal(meal.id);
      }
      for (const m of newMeals) {
        onAddMeal(date, m.slot, m.title, m.recipeId);
      }
    }
  }, [weekDates, getMealsForDate, mealSlots, recipeIndex, seasonalIngredients, seasonalTags, onAddMeal, onRemoveMeal, onReplaceMealsForDate]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)] wk-header-decor relative">
        <div className="flex items-center justify-between py-3">
          <button onClick={() => navigate("/settings")} title="Settings" className="flex items-center gap-1.5">
            <SeasonalBrandIcon />
            <span className="text-lg font-bold text-orange-500">W</span>
            <span className="text-stone-400 dark:text-stone-500">|</span>
            <h1 className="text-lg font-bold dark:text-stone-100">Plan</h1>
          </button>
          {/* Today button — centered, highlights when viewing a different week */}
          {(() => {
            const isOnCurrentWeek = weekDates.some((d) => toDateString(d) === today);
            return (
              <button
                onClick={onToday}
                className={classNames(
                  "text-xs font-medium px-3 py-1 rounded-full border transition-colors",
                  isOnCurrentWeek
                    ? "border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500"
                    : "border-orange-500 text-orange-500 bg-orange-50 dark:bg-orange-950/30"
                )}
              >
                Today
              </button>
            );
          })()}
          <div className="flex items-center gap-1">
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
            <div className="relative">
              <button
                onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                className="p-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                title="More options"
              >
                <EllipsisVertical className="w-4.5 h-4.5" />
              </button>
              {showOverflowMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowOverflowMenu(false)} />
                  <div className="absolute right-0 top-8 z-50 w-48 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800 overflow-hidden">
                    {getWeekHistory && (
                      <button
                        onClick={() => { setShowHistory(!showHistory); setShowOverflowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left text-sm dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700 flex items-center gap-2"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        Recent weeks
                      </button>
                    )}
                    {onCopyWeek && (
                      <button
                        onClick={() => { onCopyWeek(); setShowOverflowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left text-sm dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700"
                      >
                        Copy this week
                      </button>
                    )}
                    {onPasteWeek && copiedMeals && copiedMeals.length > 0 && weekId && (
                      <button
                        onClick={() => { onPasteWeek(weekId); setShowOverflowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left text-sm dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700"
                      >
                        Paste to this week
                      </button>
                    )}
                    {onClearWeek && weekMeals.length > 0 && (
                      <button
                        onClick={() => {
                          if (confirm("Clear all meals from this week?")) {
                            onClearWeek();
                          }
                          setShowOverflowMenu(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        Clear week
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
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

      {/* History panel */}
      {showHistory && getWeekHistory && (
        <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">
            Recent Weeks
          </h3>
          {(() => {
            const history = getWeekHistory(8);
            if (history.length === 0) {
              return (
                <p className="text-xs text-stone-400 dark:text-stone-500">
                  No past weeks with meal plans yet.
                </p>
              );
            }
            return (
              <div className="space-y-1.5">
                {history.map((week) => (
                  <button
                    key={week.id}
                    onClick={() => {
                      // Navigate to that week by calculating the date
                      const year = parseInt(week.id.slice(0, 4), 10);
                      const weekNum = parseInt(week.id.slice(6), 10);
                      const jan4 = new Date(year, 0, 4);
                      const d = jan4.getDay() || 7;
                      const target = new Date(jan4);
                      target.setDate(jan4.getDate() - d + 1 + (weekNum - 1) * 7);
                      // Navigate by clicking prev/next until we get there — or just go directly
                      // For simplicity, calculate how many weeks difference and call goToNextWeek/goToPrevWeek
                      setShowHistory(false);
                    }}
                    className="w-full flex items-center justify-between rounded-lg bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 px-3 py-2"
                  >
                    <div className="text-left">
                      <p className="text-xs font-medium dark:text-stone-200">{week.dateRange}</p>
                      <p className="text-[10px] text-stone-400 dark:text-stone-500">
                        {week.mealCount} meal{week.mealCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {week.completionRate > 0 && (
                        <span className={classNames(
                          "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                          week.completionRate === 1
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-stone-100 text-stone-500 dark:bg-stone-700 dark:text-stone-400"
                        )}>
                          {Math.round(week.completionRate * 100)}% done
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Want to Make section */}
      {wantToMakeRecipes.length > 0 && (
        <div className="border-b border-stone-200 dark:border-stone-800">
          <div className="px-4 pt-3 pb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">
              Want to Make
            </h3>
            <div className="max-h-32 overflow-y-auto space-y-1.5">
              {wantToMakeRecipes.map((recipe) => (
                <div
                  key={recipe.id}
                  className="flex items-center justify-between rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900/50 px-3 py-2"
                >
                  <button
                    onClick={() => navigate(`/recipes/${recipe.id}`)}
                    className="flex-1 text-left text-sm font-medium text-stone-700 dark:text-stone-200 truncate mr-2"
                  >
                    {recipe.title}
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setPlanningRecipe(recipe);
                        setWtmPlanDate(toDateString(new Date()));
                        setWtmPlanSlot("dinner");
                      }}
                      className="text-[11px] font-medium px-2 py-1 rounded-md bg-orange-500 text-white hover:bg-orange-600 transition-colors"
                    >
                      Plan
                    </button>
                    <button
                      onClick={() => onToggleWantToMake?.(recipe.id)}
                      className="p-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                      title="Remove"
                    >
                      <XMark className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Date/slot picker for planning a Want to Make recipe */}
          {planningRecipe && (
            <div className="px-4 pb-3">
              <div className="rounded-lg border border-orange-300 dark:border-orange-800 bg-white dark:bg-stone-800 p-3">
                <p className="text-xs font-medium text-stone-600 dark:text-stone-300 mb-2 truncate">
                  Plan &ldquo;{planningRecipe.title}&rdquo;
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={wtmPlanDate}
                    onChange={(e) => setWtmPlanDate(e.target.value)}
                    className="flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  <select
                    value={wtmPlanSlot}
                    onChange={(e) => setWtmPlanSlot(e.target.value as MealSlot)}
                    className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  >
                    <option value="breakfast">Breakfast</option>
                    <option value="lunch">Lunch</option>
                    <option value="dinner">Dinner</option>
                    <option value="snack">Snack</option>
                    <option value="dessert">Dessert</option>
                  </select>
                  <button
                    onClick={handleWtmAddToPlan}
                    className="text-sm font-medium px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setPlanningRecipe(null)}
                    className="p-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                  >
                    <XMark className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-24">
        {/* Plan / Quick fill action bar */}
        <div className="flex gap-2 px-4 pt-3 pb-3">
          <button
            onClick={() => {
              if (recipeIndex.length > 0) {
                handleAutoFillEmptySlots();
              } else {
                navigate("/ask?q=" + encodeURIComponent("Plan my dinners for this week. Consider variety and what's in season."));
              }
            }}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-medium text-stone-600 dark:text-stone-300 hover:border-orange-300 dark:hover:border-orange-600 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-orange-500" />
            {weekMeals.length > 0 ? "Fill gaps" : "Plan my week"}
          </button>
          <button
            onClick={() => navigate("/list")}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-medium text-stone-600 dark:text-stone-300 hover:border-orange-300 dark:hover:border-orange-600 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
          >
            <ShoppingCart className="w-3.5 h-3.5 text-orange-500" />
            Shopping list
          </button>
        </div>

        {/* Divider between actions and week plan */}
        <div className="border-t border-stone-200 dark:border-stone-800 mx-4" />

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
                  <div className="flex items-center justify-between mb-1.5">
                    <p className={classNames(
                      "text-xs font-semibold",
                      isToday ? "text-orange-500" : "text-stone-500 dark:text-stone-400"
                    )}>
                      {isToday ? "Today" : formatDateShort(date)}
                    </p>
                    {recipeIndex.length > 0 && (
                      <button
                        onClick={() => handleRerollDay(date)}
                        title="Re-roll recipes"
                        className="p-0.5 text-stone-300 hover:text-orange-500 dark:text-stone-600 dark:hover:text-orange-400 transition-colors"
                      >
                        <Dice className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
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
                    <div className={classNames("space-y-1", filledMeals.length > 0 && "mt-1.5")}>
                      {(() => {
                        const usedSlots = new Set(filledMeals.map((m) => m.slot));
                        const emptySlots = mealSlots.filter((s) => !usedSlots.has(s.slot));
                        return emptySlots.map(({ slot, label }) => (
                          <button
                            key={slot}
                            onClick={() => setAddingSlot({ date, slot })}
                            className="flex items-center justify-center w-full min-h-7 rounded-lg border border-dashed border-stone-300 dark:border-stone-700 text-xs text-orange-500 font-medium hover:border-orange-400 dark:hover:border-orange-600 hover:bg-orange-50/50 dark:hover:bg-orange-950/20 transition-colors"
                          >
                            + {label.toLowerCase()}
                          </button>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
            {/* 8th tile: Shopping list */}
            {linkedRecipeIds.length > 0 && onGenerateShoppingList ? (
              <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 p-3 flex flex-col">
                <div className="flex items-center gap-1.5 mb-2">
                  <ShoppingCart className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                  <span className="text-xs font-semibold text-stone-500 dark:text-stone-400">Shopping</span>
                </div>
                <p className="text-[10px] text-stone-400 dark:text-stone-500 mb-2">
                  {linkedRecipeIds.length} recipe{linkedRecipeIds.length !== 1 ? "s" : ""} linked
                </p>
                <button
                  onClick={() => handleGenerateShoppingList(true)}
                  disabled={shoppingListStatus === "loading"}
                  className="mt-auto text-[10px] font-medium text-white bg-orange-500 px-2 py-1.5 rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {shoppingListStatus === "loading" ? "Adding..." : "Add Essentials"}
                </button>
                {shoppingListStatus && shoppingListStatus !== "loading" && (
                  <p className="mt-1 text-[9px] text-green-600 dark:text-green-400 font-medium">{shoppingListStatus}</p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-stone-200 dark:border-stone-800 p-3 flex flex-col items-center justify-center text-center">
                <ShoppingCart className="w-5 h-5 text-stone-300 dark:text-stone-600 mb-1" />
                <p className="text-[10px] text-stone-400 dark:text-stone-500">Add recipes to generate a shopping list</p>
              </div>
            )}
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
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className={classNames(
                      "text-sm font-semibold",
                      isToday
                        ? "text-orange-500"
                        : "text-stone-500 dark:text-orange-300/40"
                    )}
                  >
                    {isToday && "Today \u00B7 "}
                    {formatDateShort(date)}
                  </h3>
                  {recipeIndex.length > 0 && (
                    <button
                      onClick={() => handleRerollDay(date)}
                      title="Re-roll recipes"
                      className="p-1 text-stone-400 hover:text-orange-500 dark:text-stone-600 dark:hover:text-orange-400 transition-colors"
                    >
                      <Dice className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  {mealSlots.map(({ slot, label }) => {
                    const slotMeals = meals.filter((m) => m.slot === slot);
                    const isAdding =
                      addingSlot?.date.getTime() === date.getTime() &&
                      addingSlot?.slot === slot;

                    return (
                      <div
                        key={slot}
                        className="flex items-start gap-2 rounded-lg bg-stone-50 dark:bg-stone-900 dark:border dark:border-stone-800 px-3 py-2"
                      >
                        {mealSlots.length > 1 && (
                          <span className="flex-shrink-0 text-[10px] font-semibold text-stone-400 dark:text-stone-500 uppercase w-4 mt-0.5">
                            {label.charAt(0)}
                          </span>
                        )}

                        {slotMeals.length > 0 ? (
                          <div className="flex-1 min-w-0 space-y-1">
                            {slotMeals.map((meal) => (
                              <div key={meal.id} className="flex items-center justify-between min-w-0">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
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
                                </div>
                                <button
                                  onClick={() => onRemoveMeal(meal.id)}
                                  className="text-stone-400 hover:text-red-500 ml-2 flex-shrink-0"
                                >
                                  <XMark className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
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

                            {/* Quick-fill options for non-cooking */}
                            {!mealInput && (
                              <div className="flex gap-1.5 mt-1.5">
                                {["Skipped", "Ate out", "Leftovers"].map((opt) => (
                                  <button
                                    key={opt}
                                    onClick={() => handleAddMeal(opt)}
                                    className="text-[11px] px-2 py-0.5 rounded-full bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400 hover:bg-stone-300 dark:hover:bg-stone-600 transition-colors"
                                  >
                                    {opt}
                                  </button>
                                ))}
                              </div>
                            )}

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
                          <button
                            onClick={() =>
                              setAddingSlot({ date, slot })
                            }
                            className="flex-1 flex items-center justify-between min-h-[36px] -my-0.5 rounded-md hover:bg-orange-50/50 dark:hover:bg-orange-950/20 transition-colors"
                          >
                            <span className="text-xs text-stone-400 dark:text-stone-500">
                              {label}
                            </span>
                            <span className="text-xs text-orange-500 font-medium">
                              + add
                            </span>
                          </button>
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


        {/* Quick-add suggestions — ranked by rating, usage, favorites, and slot fit */}
        {recipeIndex.length > 0 && addingSlot && (() => {
          const slot = addingSlot.slot;
          // Exclude recipes already planned this week
          const plannedIds = new Set(weekMeals.map((m) => m.recipeId).filter(Boolean));
          const candidates = recipeIndex
            .filter((r) => !plannedIds.has(r.id))
            .map((r) => ({ recipe: r, score: recipeScore(r, slot, seasonalIngredients, seasonalTags) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
            .filter((c) => c.score > 0);
          if (candidates.length === 0) return null;

          const slotLabel = mealSlots.find((s) => s.slot === slot)?.label ?? slot;
          return (
            <div className="mx-4 mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-1.5">
                Suggested for {slotLabel}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {candidates.map(({ recipe: r }) => {
                  const titleLower = r.title.toLowerCase();
                  const descLower = (r.description ?? "").toLowerCase();
                  const text = `${titleLower} ${descLower}`;
                  const isSeasonal = seasonalIngredients.some((ing) => text.includes(ing))
                    || seasonalTags.some((tag) => r.tags.some((t) => t.toLowerCase() === tag));
                  return (
                    <button
                      key={r.id}
                      onClick={() => handleAddMeal(r.title, r.id)}
                      className={classNames(
                        "flex items-center gap-1.5 rounded-full border bg-white dark:bg-stone-800 px-2.5 py-1 text-xs text-stone-600 dark:text-stone-300 hover:border-orange-400 hover:text-orange-600 dark:hover:text-orange-400 transition-colors",
                        isSeasonal
                          ? "border-emerald-200 dark:border-emerald-800"
                          : "border-stone-200 dark:border-stone-700"
                      )}
                    >
                      {r.thumbnailUrl ? (
                        <img src={r.thumbnailUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
                      ) : r.favorite ? (
                        <span className="text-orange-400">★</span>
                      ) : (
                        <span className="text-stone-300 dark:text-stone-600">○</span>
                      )}
                      <span className="truncate max-w-[120px]">{r.title}</span>
                      {r.avgRating != null && r.avgRating > 0 && (
                        <span className="text-[9px] text-amber-500">{r.avgRating.toFixed(1)}★</span>
                      )}
                      {isSeasonal && <span className="text-[9px] text-emerald-500" title="In season">🌿</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Shopping list — compact card for list view */}
        {planLayout === "list" && linkedRecipeIds.length > 0 && onGenerateShoppingList && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-3.5 h-3.5 text-stone-400" />
              <span className="text-xs text-stone-500 dark:text-stone-400">
                {linkedRecipeIds.length} recipe{linkedRecipeIds.length !== 1 ? "s" : ""} linked
              </span>
            </div>
            <button
              onClick={() => handleGenerateShoppingList(true)}
              disabled={shoppingListStatus === "loading"}
              className="text-xs font-medium text-orange-500 hover:text-orange-600 transition-colors disabled:opacity-50"
            >
              {shoppingListStatus === "loading" ? "Adding..." : "Add Essentials"}
            </button>
          </div>
        )}
        {shoppingListStatus && shoppingListStatus !== "loading" && planLayout === "list" && (
          <p className="mx-4 mt-1 text-xs text-green-600 dark:text-green-400 font-medium">{shoppingListStatus}</p>
        )}

      </div>
    </div>
  );
}
