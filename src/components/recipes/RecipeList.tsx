import { useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { RecipeIndexEntry } from "../../types";
import { filterAndSortRecipes } from "../../hooks/useRecipes";
import { formatTotalTime } from "../../lib/utils";
import { classNames } from "../../lib/utils";
import { TagChip } from "../ui/TagChip";
import { EmptyState } from "../ui/EmptyState";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { Button } from "../ui/Button";
import { InstallPrompt } from "../InstallPrompt";
import { FirstRunGuide } from "./FirstRunGuide";
import { WhiskLogo, Cog, ArrowUpDown, Plus, Heart, HeartFilled, Clock, Users, Check } from "../ui/Icon";

type SortOption = "recent" | "alpha" | "cookTime" | "lastViewed" | "category";

/** Enables click-drag horizontal scrolling with momentum on desktop. */
function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef({ dragging: false, didDrag: false, startX: 0, scrollLeft: 0, lastX: 0, lastTime: 0, velocity: 0, animId: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(state.current.animId);
    const s = state.current;
    s.dragging = true;
    s.didDrag = false;
    s.startX = e.pageX;
    s.scrollLeft = el.scrollLeft;
    s.lastX = e.pageX;
    s.lastTime = Date.now();
    s.velocity = 0;
    el.style.cursor = "grabbing";
    el.style.userSelect = "none";
    el.style.scrollSnapType = "none";
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const s = state.current;
    if (!s.dragging) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    // Mark as a real drag if mouse moved more than 5px
    if (Math.abs(e.pageX - s.startX) > 5) s.didDrag = true;
    const now = Date.now();
    const dt = now - s.lastTime;
    const dx = e.pageX - s.lastX;
    if (dt > 0) s.velocity = dx / dt;
    s.lastX = e.pageX;
    s.lastTime = now;
    el.scrollLeft = s.scrollLeft - (e.pageX - s.startX);
  }, []);

  const onMouseUp = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const s = state.current;
    if (!s.dragging) return;
    s.dragging = false;
    el.style.cursor = "";
    el.style.userSelect = "";
    // Momentum coast
    let v = -s.velocity * 15;
    const coast = () => {
      if (Math.abs(v) < 0.5) {
        el.style.scrollSnapType = "";
        return;
      }
      el.scrollLeft += v;
      v *= 0.95;
      s.animId = requestAnimationFrame(coast);
    };
    s.animId = requestAnimationFrame(coast);
  }, []);

  // Suppress click events that follow a drag (prevents opening a recipe)
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (state.current.didDrag) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  return { ref, onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp, onClickCapture };
}

interface RecipeListProps {
  recipes: RecipeIndexEntry[];
  isLoading: boolean;
  onToggleFavorite: (id: string) => void;
  availableTags: string[];
}

export function RecipeList({
  recipes,
  isLoading,
  onToggleFavorite,
  availableTags,
}: RecipeListProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>("category");
  const [showSort, setShowSort] = useState(false);
  const [recipeLayout, setRecipeLayout] = useState<"horizontal" | "vertical">(() => {
    return (localStorage.getItem("whisk_recipe_layout") as "horizontal" | "vertical") ?? "horizontal";
  });

  const filtered = useMemo(
    () =>
      filterAndSortRecipes(recipes, {
        search,
        tags: selectedTags,
        favoritesOnly,
        sort,
      }),
    [recipes, search, selectedTags, favoritesOnly, sort]
  );

  const MEAL_TYPES = ["dinner", "lunch", "breakfast", "dessert", "appetizer", "snack", "side dish"];
  const CATEGORY_ORDER = ["breakfast", "brunch", "lunch", "dinner", "dessert", "appetizer", "snack", "side dish"];

  // Split tags into meal types and other tags
  const { mealTags, otherTags } = useMemo(() => {
    const usedTags = new Set(recipes.flatMap((r) => r.tags));
    const meal = MEAL_TYPES.filter((t) => usedTags.has(t));
    const other = availableTags
      .filter((t) => usedTags.has(t) && !MEAL_TYPES.includes(t))
      .slice(0, 12);
    return { mealTags: meal, otherTags: other };
  }, [recipes, availableTags]);

  // Group recipes by meal category for the "category" sort view
  const groupedRecipes = useMemo(() => {
    if (sort !== "category") return null;
    const groups = new Map<string, RecipeIndexEntry[]>();
    const favorites: RecipeIndexEntry[] = [];
    for (const recipe of filtered) {
      if (recipe.favorite) favorites.push(recipe);
      const mealTag = CATEGORY_ORDER.find((c) => recipe.tags.includes(c));
      const key = mealTag ?? "other";
      const list = groups.get(key);
      if (list) {
        list.push(recipe);
      } else {
        groups.set(key, [recipe]);
      }
    }
    // Sort alphabetically within each group
    for (const list of groups.values()) {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    favorites.sort((a, b) => a.title.localeCompare(b.title));
    // Favorites first, then category order, then "other"
    const ordered: { label: string; recipes: RecipeIndexEntry[] }[] = [];
    if (favorites.length > 0) ordered.push({ label: "Favorites", recipes: favorites });
    for (const cat of CATEGORY_ORDER) {
      const list = groups.get(cat);
      if (list) ordered.push({ label: cat, recipes: list });
    }
    const other = groups.get("other");
    if (other) ordered.push({ label: "Other", recipes: other });
    return ordered;
  }, [filtered, sort]);

  const toggleTag = (tag: string) => {
    const isMealType = MEAL_TYPES.includes(tag);
    setSelectedTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((t) => t !== tag);
      }
      if (isMealType) {
        // Single-select for meal types: deselect other meal types
        return [...prev.filter((t) => !MEAL_TYPES.includes(t)), tag];
      }
      return [...prev, tag];
    });
  };

  if (isLoading) {
    return <LoadingSpinner className="py-20" size="lg" />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-2">
            <WhiskLogo className="w-7 h-7 text-orange-500" />
            <h1 className="text-xl font-bold dark:text-stone-100">Whisk</h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate("/settings")}
              className="p-2 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
              title="Settings"
            >
              <Cog className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowSort(!showSort)}
              className="p-2 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
              title="Sort"
            >
              <ArrowUpDown className="w-5 h-5" />
            </button>
            <button
              onClick={() => navigate("/recipes/new")}
              className="p-2 text-orange-500 hover:text-orange-600"
              title="Add recipe"
            >
              <Plus className="w-6 h-6" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="pb-2">
          <input
            type="search"
            placeholder="Search recipes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[var(--wk-radius-input)] border-[length:var(--wk-border-input)] border-stone-300 bg-stone-50 px-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
          />
        </div>

        {/* Sort dropdown */}
        {showSort && (
          <div className="pb-2 flex gap-2 flex-wrap">
            {(
              [
                ["category", "Category"],
                ["recent", "Recent"],
                ["alpha", "A-Z"],
                ["cookTime", "Cook time"],
              ] as [SortOption, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setSort(value);
                  setShowSort(false);
                }}
                className={classNames(
                  "px-3 py-1 rounded-[var(--wk-radius-tag)] text-xs font-medium border",
                  sort === value
                    ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                    : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Meal-type quick filters */}
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          <TagChip
            label="All"
            selected={!favoritesOnly && selectedTags.length === 0}
            onToggle={() => {
              setSelectedTags([]);
              setFavoritesOnly(false);
            }}
          />
          <TagChip
            label="Favorites"
            selected={favoritesOnly}
            onToggle={() => setFavoritesOnly(!favoritesOnly)}
          />
          {mealTags.map((tag) => (
            <TagChip
              key={tag}
              label={tag}
              selected={selectedTags.includes(tag)}
              onToggle={() => toggleTag(tag)}
            />
          ))}
        </div>
        {/* Other tag filters */}
        {otherTags.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-3 no-scrollbar">
            {otherTags.map((tag) => (
              <TagChip
                key={tag}
                label={tag}
                selected={selectedTags.includes(tag)}
                onToggle={() => toggleTag(tag)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Install prompt */}
      <InstallPrompt />

      {/* Recipe cards */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-24">
        {recipes.length === 0 && !search && selectedTags.length === 0 ? (
          <FirstRunGuide />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<WhiskLogo className="w-12 h-12" />}
            title="No results"
            description="Try a different search or filter"
          />
        ) : groupedRecipes ? (
          <div className="space-y-6">
            {groupedRecipes.map((group) => (
              <section key={group.label}>
                <h2 className={classNames(
                  "text-sm font-semibold tracking-wide mb-2 capitalize",
                  group.label === "Favorites"
                    ? "text-red-500 dark:text-red-400 flex items-center gap-1"
                    : "text-stone-500 dark:text-orange-300/50"
                )}>
                  {group.label === "Favorites" && <HeartFilled className="w-3.5 h-3.5" />}
                  {group.label}
                  <span className="text-xs font-normal text-stone-400 dark:text-stone-500 ml-1.5">
                    {group.recipes.length}
                  </span>
                </h2>
                {recipeLayout === "horizontal" && !search && selectedTags.length === 0 && !favoritesOnly ? (
                  <CarouselRow>
                    {group.recipes.map((recipe) => (
                      <div key={recipe.id} className="snap-start shrink-0 w-[42vw] max-w-[200px]">
                        <RecipeCard
                          recipe={recipe}
                          onClick={() => navigate(`/recipes/${recipe.id}`)}
                          onToggleFavorite={() => onToggleFavorite(recipe.id)}
                        />
                      </div>
                    ))}
                    {/* Spacer for last card peek */}
                    <div className="shrink-0 w-1" aria-hidden />
                  </CarouselRow>
                ) : (
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                    {group.recipes.map((recipe) => (
                      <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        onClick={() => navigate(`/recipes/${recipe.id}`)}
                        onToggleFavorite={() => onToggleFavorite(recipe.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {filtered.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onClick={() => navigate(`/recipes/${recipe.id}`)}
                onToggleFavorite={() => onToggleFavorite(recipe.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CarouselRow({ children }: { children: React.ReactNode }) {
  const drag = useDragScroll();
  return (
    <div className="overflow-hidden -mx-4">
      <div
        ref={drag.ref}
        onMouseDown={drag.onMouseDown}
        onMouseMove={drag.onMouseMove}
        onMouseUp={drag.onMouseUp}
        onMouseLeave={drag.onMouseLeave}
        onClickCapture={drag.onClickCapture}
        className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-1 px-4 cursor-grab"
      >
        {children}
      </div>
    </div>
  );
}

function RecipeCard({
  recipe,
  onClick,
  onToggleFavorite,
}: {
  recipe: RecipeIndexEntry;
  onClick: () => void;
  onToggleFavorite: () => void;
}) {
  const totalTime = formatTotalTime(recipe.prepTime, recipe.cookTime);

  return (
    <button
      onClick={onClick}
      className="wk-card flex h-full w-full flex-col overflow-hidden rounded-[var(--wk-radius-card)] border-[length:var(--wk-border-card)] border-stone-200 bg-white text-left shadow-[var(--wk-shadow-card)] transition-all hover:shadow-[var(--wk-shadow-card-hover)] active:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:active:bg-stone-800 dark:hover:border-orange-500/30"
    >
      {/* Image */}
      <div className="relative aspect-3/2 w-full shrink-0 overflow-hidden bg-stone-100 dark:bg-stone-800">
        {recipe.thumbnailUrl ? (
          <img
            src={recipe.thumbnailUrl}
            alt={recipe.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-stone-300 dark:text-stone-600">
            <WhiskLogo className="w-10 h-10" />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/30 backdrop-blur-sm"
        >
          {recipe.favorite ? (
            <HeartFilled className="w-5 h-5 text-red-500" />
          ) : (
            <Heart className="w-5 h-5 text-white/80" />
          )}
        </button>
      </div>

      {/* Info — fixed height so cards align in carousel rows */}
      <div className="flex flex-col justify-between p-3 min-h-[5.5rem]">
        <div>
          <h3 className="font-semibold text-sm line-clamp-2 dark:text-stone-100">
            {recipe.title}
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5 min-h-[1rem]">
            {recipe.tags.length > 0 ? recipe.tags.slice(0, 3).join(", ") : "\u00A0"}
          </p>
        </div>

        <div className="flex items-center gap-3 mt-1.5 text-xs text-stone-400 dark:text-stone-500 min-h-[1rem]">
          {totalTime && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {totalTime}
            </span>
          )}
          {recipe.servings && (
            <span className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> {recipe.servings} srv
            </span>
          )}
          {recipe.cookedCount && recipe.cookedCount > 0 && (
            <span className="flex items-center gap-1 text-green-500" title={`Made ${recipe.cookedCount} time${recipe.cookedCount !== 1 ? "s" : ""}`}>
              <Check className="w-3.5 h-3.5" /> {recipe.cookedCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
