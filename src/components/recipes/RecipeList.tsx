import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { RecipeIndexEntry } from "../../types";
import { filterAndSortRecipes } from "../../hooks/useRecipes";
import { formatTotalTime } from "../../lib/utils";
import { classNames } from "../../lib/utils";
import { PRESET_TAGS, TIME_RANGES } from "../../lib/tags";
import { EmptyState } from "../ui/EmptyState";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { Button } from "../ui/Button";

import { FirstRunGuide } from "./FirstRunGuide";
import { WhiskLogo, Cog, ArrowUpDown, Plus, Heart, HeartFilled, Clock, Check, XMark, ChevronDown, MagnifyingGlass, CalendarDays } from "../ui/Icon";
import { SeasonalBrandIcon } from "../ui/SeasonalBrandIcon";

type SortOption = "recent" | "alpha" | "cookTime" | "lastViewed" | "category" | "mostCooked" | "simple";


interface RecipeListProps {
  recipes: RecipeIndexEntry[];
  isLoading: boolean;
  onToggleFavorite: (id: string) => void;
  onToggleWantToMake: (id: string) => void;
  availableTags: string[];
}

export function RecipeList({
  recipes,
  isLoading,
  onToggleFavorite,
  onToggleWantToMake,
  availableTags,
}: RecipeListProps) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore filter/sort state from sessionStorage on mount
  const saved = useRef(() => {
    try {
      const raw = sessionStorage.getItem("whisk_recipe_view");
      if (raw) return JSON.parse(raw) as { search?: string; tags?: string[]; fav?: boolean; sort?: SortOption; maxTime?: number };
    } catch { /* ignore */ }
    return null;
  });
  const restored = saved.current();

  const [search, setSearch] = useState(restored?.search ?? "");
  const [selectedTags, setSelectedTags] = useState<string[]>(restored?.tags ?? []);
  const [favoritesOnly, setFavoritesOnly] = useState(restored?.fav ?? false);
  const [sort, setSort] = useState<SortOption>(restored?.sort ?? "category");
  const [maxTime, setMaxTime] = useState<number | null>(restored?.maxTime ?? null);
  const [recipeLayout, setRecipeLayout] = useState<"horizontal" | "vertical">(() => {
    return (localStorage.getItem("whisk_recipe_layout") as "horizontal" | "vertical") ?? "horizontal";
  });

  // Save filter state to sessionStorage whenever it changes
  useEffect(() => {
    sessionStorage.setItem("whisk_recipe_view", JSON.stringify({ search, tags: selectedTags, fav: favoritesOnly, sort, maxTime }));
  }, [search, selectedTags, favoritesOnly, sort, maxTime]);

  // Restore scroll position after recipes render
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const pos = sessionStorage.getItem("whisk_recipe_scroll");
    if (el && pos) {
      el.scrollTop = parseInt(pos, 10);
      sessionStorage.removeItem("whisk_recipe_scroll");
    }
    // Restore horizontal carousel scroll positions
    const carouselJson = sessionStorage.getItem("whisk_recipe_carousel");
    if (el && carouselJson) {
      try {
        const positions = JSON.parse(carouselJson) as Record<string, number>;
        // Use requestAnimationFrame to ensure carousels are rendered
        requestAnimationFrame(() => {
          const carousels = el.querySelectorAll<HTMLDivElement>("[data-carousel]");
          carousels.forEach((carousel) => {
            const key = carousel.dataset.carousel;
            if (key && positions[key]) {
              carousel.scrollLeft = positions[key];
            }
          });
        });
      } catch { /* ignore */ }
      sessionStorage.removeItem("whisk_recipe_carousel");
    }
  }, [recipes]);

  const filtered = useMemo(
    () =>
      filterAndSortRecipes(recipes, {
        search,
        tags: selectedTags,
        favoritesOnly,
        sort,
        maxTime: maxTime ?? undefined,
      }),
    [recipes, search, selectedTags, favoritesOnly, sort, maxTime]
  );

  const CATEGORY_ORDER = ["breakfast", "brunch", "dinner", "salad", "soup", "dessert", "appetizer", "snack", "side dish"];
  const [searchOpen, setSearchOpen] = useState(() => !!(restored?.search));
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; right?: number } | null>(null);

  // Group available tags by category for dropdown filters
  const filterGroups = useMemo(() => {
    const usedTags = new Set(recipes.flatMap((r) => r.tags));
    const presetByGroup = new Map<string, string[]>();
    const presetNames = new Set<string>();
    for (const t of PRESET_TAGS) {
      presetNames.add(t.name);
      if (!usedTags.has(t.name)) continue;
      const group = t.group ?? "custom";
      const list = presetByGroup.get(group) ?? [];
      list.push(t.name);
      presetByGroup.set(group, list);
    }
    // Custom tags = used tags not in presets
    const custom = availableTags.filter((t) => usedTags.has(t) && !presetNames.has(t));
    if (custom.length > 0) presetByGroup.set("custom", custom);

    const groups: { key: string; label: string; tags: string[] }[] = [];
    const ORDER: [string, string][] = [
      ["meal", "Type"],
      ["cuisine", "Cuisine"],
      ["diet", "Diet"],
      ["season", "Season"],
      ["custom", "Other"],
    ];
    for (const [key, label] of ORDER) {
      const tags = presetByGroup.get(key);
      if (tags && tags.length > 0) groups.push({ key, label, tags });
    }
    return groups;
  }, [recipes, availableTags]);


  // Group recipes by meal category for the "category" sort view
  const groupedRecipes = useMemo(() => {
    if (sort !== "category") return null;
    const groups = new Map<string, RecipeIndexEntry[]>();
    const favorites: RecipeIndexEntry[] = [];
    for (const recipe of filtered) {
      if (recipe.favorite) favorites.push(recipe);
      const matchingCats = CATEGORY_ORDER.filter((c) => recipe.tags.includes(c));
      const isDrinks = recipe.tags.includes("drinks");
      if (isDrinks) matchingCats.push("drinks");
      if (matchingCats.length === 0) matchingCats.push("other");
      for (const key of matchingCats) {
        const list = groups.get(key);
        if (list) {
          list.push(recipe);
        } else {
          groups.set(key, [recipe]);
        }
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
    const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
    for (const cat of CATEGORY_ORDER) {
      const list = groups.get(cat);
      if (list && list.length > 0) ordered.push({ label: cap(cat), recipes: list });
    }
    const other = groups.get("other");
    if (other) ordered.push({ label: "Other", recipes: other });
    const drinks = groups.get("drinks");
    if (drinks && drinks.length > 0) ordered.push({ label: "Drinks", recipes: drinks });
    return ordered;
  }, [filtered, sort]);

  const goToRecipe = (id: string) => {
    if (scrollRef.current) {
      sessionStorage.setItem("whisk_recipe_scroll", String(scrollRef.current.scrollTop));
    }
    // Save horizontal carousel scroll positions per category
    const carousels = scrollRef.current?.querySelectorAll<HTMLDivElement>("[data-carousel]");
    if (carousels && carousels.length > 0) {
      const positions: Record<string, number> = {};
      carousels.forEach((el) => {
        const key = el.dataset.carousel;
        if (key && el.scrollLeft > 0) positions[key] = el.scrollLeft;
      });
      if (Object.keys(positions).length > 0) {
        sessionStorage.setItem("whisk_recipe_carousel", JSON.stringify(positions));
      }
    }
    navigate(`/recipes/${id}`);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  if (isLoading) {
    return <LoadingSpinner className="py-20" size="lg" />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)] wk-header-decor relative">
        <div className="flex items-center justify-between py-3">
          <button onClick={() => navigate("/settings")} title="Settings" className="flex items-center gap-1.5">
            <SeasonalBrandIcon />
            <span className="text-lg font-bold text-orange-500">W</span>
            <span className="text-stone-400 dark:text-stone-500">|</span>
            <h1 className="text-lg font-bold dark:text-stone-100">Recipes</h1>
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setSearchOpen(!searchOpen);
                if (!searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
                else setSearch("");
              }}
              className={classNames(
                "p-2 rounded-lg transition-all",
                searchOpen || search
                  ? "text-orange-500 ring-1 ring-orange-300 dark:ring-orange-700"
                  : "text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
              )}
              title="Search recipes"
            >
              {searchOpen ? <XMark className="w-5 h-5" /> : <MagnifyingGlass className="w-5 h-5" />}
            </button>
            <button
              onClick={() => navigate("/recipes/new")}
              className="p-1.5 rounded-lg text-stone-400 hover:text-orange-500 active:bg-orange-100 active:text-orange-600 active:ring-1 active:ring-orange-300 dark:text-stone-500 dark:hover:text-orange-400 dark:active:bg-orange-950 dark:active:text-orange-400 dark:active:ring-orange-700 transition-all"
              title="Add recipe"
            >
              <Plus className="w-6 h-6" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Search — collapsible */}
        {searchOpen && (
          <div className="pb-2">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="search"
                enterKeyHint="search"
                placeholder="Search recipes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLElement).blur(); }}
                className="w-full rounded-[var(--wk-radius-input)] border-[length:var(--wk-border-input)] border-stone-300 bg-stone-50 px-3 py-2 pr-8 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                >
                  <XMark className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="flex items-center gap-2 pb-2 overflow-x-auto no-scrollbar">
          {/* Favorites toggle + Sort — grouped together */}
          <button
            onClick={() => { setFavoritesOnly(!favoritesOnly); setOpenDropdown(null); }}
            className={classNames(
              "shrink-0 p-1.5 rounded-full transition-colors",
              favoritesOnly
                ? "text-red-500 bg-red-50 dark:bg-red-950/50"
                : "text-stone-400 hover:text-red-400 dark:text-stone-500 dark:hover:text-red-400"
            )}
            title={favoritesOnly ? "Show all recipes" : "Show favorites only"}
          >
            {favoritesOnly ? <HeartFilled className="w-5 h-5" /> : <Heart className="w-5 h-5" />}
          </button>
          <div className="shrink-0">
            <button
              onClick={(e) => {
                if (openDropdown === "sort") {
                  setOpenDropdown(null);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const left = Math.max(8, rect.left);
                  setDropdownPos({ top: rect.bottom + 4, left });
                  setOpenDropdown("sort");
                }
              }}
              className="p-1.5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 transition-colors"
              title={`Sort: ${({ category: "Category", recent: "Recent", alpha: "A-Z", cookTime: "Cook time", mostCooked: "Most cooked", lastViewed: "Last viewed", simple: "Simple first" } as Record<SortOption, string>)[sort]}`}
            >
              <ArrowUpDown className="w-4.5 h-4.5" />
            </button>
          </div>
          <span className="text-stone-300 dark:text-stone-600 text-sm select-none">|</span>
          {filterGroups.filter((g) => g.key === "meal" || g.key === "cuisine").map((group) => {
            const activeCount = group.tags.filter((t) => selectedTags.includes(t)).length;
            return (
              <div key={group.key} className="relative shrink-0">
                <button
                  onClick={(e) => {
                    if (openDropdown === group.key) {
                      setOpenDropdown(null);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const minDropdownWidth = 140;
                      const wouldOverflow = rect.left + minDropdownWidth > window.innerWidth;
                      if (wouldOverflow) {
                        const right = Math.max(8, window.innerWidth - rect.right);
                        setDropdownPos({ top: rect.bottom + 4, left: 0, right });
                      } else {
                        setDropdownPos({ top: rect.bottom + 4, left: rect.left });
                      }
                      setOpenDropdown(group.key);
                    }
                  }}
                  className={classNames(
                    "wk-pill inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    activeCount > 0
                      ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : openDropdown === group.key
                        ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                        : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                  )}
                >
                  {group.label}{activeCount > 0 && ` (${activeCount})`}
                  <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === group.key && "rotate-180")} />
                </button>
              </div>
            );
          })}
          {/* Time filter */}
          <div className="shrink-0">
            <button
              onClick={(e) => {
                if (openDropdown === "time") {
                  setOpenDropdown(null);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const minDropdownWidth = 140;
                  const wouldOverflow = rect.left + minDropdownWidth > window.innerWidth;
                  if (wouldOverflow) {
                    const right = Math.max(8, window.innerWidth - rect.right);
                    setDropdownPos({ top: rect.bottom + 4, left: 0, right });
                  } else {
                    setDropdownPos({ top: rect.bottom + 4, left: rect.left });
                  }
                  setOpenDropdown("time");
                }
              }}
              className={classNames(
                "wk-pill inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                maxTime != null
                  ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                  : openDropdown === "time"
                    ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                    : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
              )}
            >
              <Clock className="w-3 h-3" />
              {maxTime != null
                ? TIME_RANGES.find((r) => r.maxMinutes === maxTime)?.label ?? "Time"
                : "Time"}
              <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === "time" && "rotate-180")} />
            </button>
          </div>
          {filterGroups.filter((g) => g.key !== "meal" && g.key !== "cuisine").map((group) => {
            const activeCount = group.tags.filter((t) => selectedTags.includes(t)).length;
            return (
              <div key={group.key} className="relative shrink-0">
                <button
                  onClick={(e) => {
                    if (openDropdown === group.key) {
                      setOpenDropdown(null);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const minDropdownWidth = 140;
                      const wouldOverflow = rect.left + minDropdownWidth > window.innerWidth;
                      if (wouldOverflow) {
                        const right = Math.max(8, window.innerWidth - rect.right);
                        setDropdownPos({ top: rect.bottom + 4, left: 0, right });
                      } else {
                        setDropdownPos({ top: rect.bottom + 4, left: rect.left });
                      }
                      setOpenDropdown(group.key);
                    }
                  }}
                  className={classNames(
                    "wk-pill inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    activeCount > 0
                      ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : openDropdown === group.key
                        ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                        : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                  )}
                >
                  {group.label}{activeCount > 0 && ` (${activeCount})`}
                  <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === group.key && "rotate-180")} />
                </button>
              </div>
            );
          })}
        </div>
        {/* Dropdown panel — portaled to body to escape backdrop-blur containing block */}
        {openDropdown && dropdownPos && createPortal((() => {
          const sortOptions: [SortOption, string][] = [
            ["category", "Category"],
            ["recent", "Recent"],
            ["alpha", "A-Z"],
            ["simple", "Simple first"],
            ["cookTime", "Cook time"],
            ["mostCooked", "Most cooked"],
          ];
          const isSort = openDropdown === "sort";
          const isTime = openDropdown === "time";
          const group = !isSort && !isTime ? filterGroups.find((g) => g.key === openDropdown) : null;
          if (!isSort && !isTime && !group) return null;
          return (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
              <div
                className="wk-dropdown fixed z-50 min-w-35 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800 py-1"
                style={{
                  top: dropdownPos.top,
                  ...(dropdownPos.right != null
                    ? { right: dropdownPos.right }
                    : { left: dropdownPos.left }),
                }}
              >
                {isSort
                  ? sortOptions.map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => { setSort(value); setOpenDropdown(null); }}
                        className={classNames(
                          "w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors",
                          sort === value
                            ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                            : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                        )}
                      >
                        {label}
                        {sort === value && <Check className="w-4 h-4 text-orange-500" />}
                      </button>
                    ))
                  : isTime
                    ? <>
                        {TIME_RANGES.map((range) => {
                          const isActive = maxTime === range.maxMinutes;
                          return (
                            <button
                              key={range.maxMinutes}
                              onClick={() => {
                                setMaxTime(isActive ? null : range.maxMinutes);
                                setOpenDropdown(null);
                              }}
                              className={classNames(
                                "w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors",
                                isActive
                                  ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                                  : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                              )}
                            >
                              {range.label}
                              {isActive && <Check className="w-4 h-4 text-orange-500" />}
                            </button>
                          );
                        })}
                      </>
                    : group!.tags.map((tag) => {
                        const isActive = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            onClick={() => { toggleTag(tag); setOpenDropdown(null); }}
                            className={classNames(
                              "w-full px-3 py-2 text-left text-sm capitalize flex items-center justify-between gap-2 transition-colors",
                              isActive
                                ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                                : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                            )}
                          >
                            {tag}
                            {isActive && <Check className="w-4 h-4 text-orange-500" />}
                          </button>
                        );
                      })}
              </div>
            </>
          );
        })(), document.body)}

        {/* Active filter chips */}
        {selectedTags.length > 0 && (
          <div className="flex items-center gap-1.5 pb-2">
            <div className="flex flex-wrap gap-1.5 flex-1">
              {selectedTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className="wk-pill inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300 capitalize"
                >
                  {tag}
                  <XMark className="w-3 h-3" />
                </button>
              ))}
            </div>
            <button
              onClick={() => setSelectedTags([])}
              className="wk-pill inline-flex items-center rounded-full border border-stone-300 px-2.5 py-0.5 text-xs font-medium text-stone-500 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-400 dark:hover:bg-stone-800 shrink-0 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Recipe cards */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3 pb-24">
        {recipes.length === 0 && !search && selectedTags.length === 0 ? (
          <div className="px-4"><FirstRunGuide /></div>
        ) : filtered.length === 0 ? (
          <div className="px-4">
            <EmptyState
              icon={<WhiskLogo className="w-12 h-12" />}
              title="No results"
              description="Try a different search or filter"
            />
          </div>
        ) : groupedRecipes ? (
          <div className="space-y-6">
            {groupedRecipes.map((group) => (
              <section key={group.label}>
                <h2 className={classNames(
                  "px-4 text-sm font-semibold tracking-wide mb-2 flex items-center gap-1",
                  group.label === "Favorites"
                    ? "text-red-500 dark:text-red-400"
                    : "text-stone-500 dark:text-orange-300/50"
                )}>
                  {group.label === "Favorites" && <HeartFilled className="w-3.5 h-3.5" />}
                  {group.label}
                  <span className="text-xs font-normal text-stone-400 dark:text-stone-500 ml-1.5">
                    {group.recipes.length}
                  </span>
                </h2>
                {recipeLayout === "horizontal" && !search && selectedTags.length === 0 && !favoritesOnly ? (
                  <CarouselRow category={group.label}>
                    {group.recipes.map((recipe) => (
                      <div key={recipe.id} className="snap-start shrink-0 w-[42vw] max-w-[200px]">
                        <RecipeCard
                          recipe={recipe}
                          onClick={() => goToRecipe(recipe.id)}
                          onToggleFavorite={() => onToggleFavorite(recipe.id)}
                          onToggleWantToMake={() => onToggleWantToMake(recipe.id)}
                        />
                      </div>
                    ))}
                    {/* Spacer for last card peek */}
                    <div className="shrink-0 w-1" aria-hidden />
                  </CarouselRow>
                ) : (
                  <div className="px-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {group.recipes.map((recipe) => (
                      <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        onClick={() => goToRecipe(recipe.id)}
                        onToggleFavorite={() => onToggleFavorite(recipe.id)}
                        onToggleWantToMake={() => onToggleWantToMake(recipe.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="px-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onClick={() => goToRecipe(recipe.id)}
                onToggleFavorite={() => onToggleFavorite(recipe.id)}
                onToggleWantToMake={() => onToggleWantToMake(recipe.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CarouselRow({ children, category }: { children: React.ReactNode; category?: string }) {
  return (
    <div className="overflow-hidden">
      <div data-carousel={category} className="flex gap-3 overflow-x-auto carousel-scroll snap-x snap-mandatory pb-1 scroll-pl-4 pl-4">
        {children}
      </div>
    </div>
  );
}

// Tags to exclude from card preview — meal types are redundant with the category section
// header, and time/speed tags are redundant with the cook time shown on each card
const CARD_HIDDEN_TAGS = new Set([
  // Meal types (shown as section headers)
  "breakfast", "brunch", "dinner", "salad", "soup", "dessert", "appetizer", "snack", "side dish", "drinks",
  // Time/speed (shown as cook time on card)
  "quick", "under 30 min", "under 30 minutes", "30 min", "meal prep",
]);

// Additional tags to hide for drink recipes — food-oriented labels that don't apply
const DRINK_HIDDEN_TAGS = new Set([
  "weeknight", "quick", "under 30 min", "under 30 minutes", "30 min",
  "meal prep", "one-pot", "sheet pan", "healthy", "low-carb", "keto",
  "grilling", "baking", "slow cook", "instant pot", "air fryer", "stir-fry",
]);

const ALCOHOLIC_KEYWORDS = /\b(?:cocktail|margarita|sangria|spritz|mojito|martini|daiquiri|whiskey|whisky|bourbon|vodka|rum|gin|tequila|mezcal|wine|champagne|prosecco|beer|ale|stout|aperol|negroni|mimosa|bellini|paloma|old fashioned|manhattan|cosmopolitan|sour|highball|julep|toddy|mule|collins|fizz|sling|punch|eggnog|grog|amaretto|kahlua|baileys|vermouth|bitters|liqueur|amaro|pisco|sake|soju|hard (?:cider|seltzer|lemonade))\b/i;

/** Image that handles hotlink-blocked external URLs (e.g. Serious Eats / Dotdash Meredith) */
function RecipeImage({ src, alt }: { src: string; alt: string }) {
  const [useFallback, setUseFallback] = useState(false);
  const isExternal = src.startsWith("http");

  const displayUrl = !isExternal
    ? src
    : useFallback
      ? `/api/image-proxy?url=${encodeURIComponent(src)}`
      : src;

  return (
    <img
      src={displayUrl}
      alt={alt}
      className="h-full w-full object-cover"
      loading="lazy"
      referrerPolicy={isExternal && !useFallback ? "no-referrer" : undefined}
      onError={() => {
        if (isExternal && !useFallback) {
          setUseFallback(true);
        }
      }}
    />
  );
}

function RecipeCard({
  recipe,
  onClick,
  onToggleFavorite,
  onToggleWantToMake,
}: {
  recipe: RecipeIndexEntry;
  onClick: () => void;
  onToggleFavorite: () => void;
  onToggleWantToMake: () => void;
}) {
  const isDrinks = recipe.tags.includes("drinks");
  const totalTime = isDrinks ? null : formatTotalTime(recipe.prepTime, recipe.cookTime);
  // Show cuisine, diet, method, season tags — skip meal type (already in section header)
  // For drinks, also hide food-oriented tags (weeknight, cooking methods, etc.)
  const displayTags = recipe.tags.filter((t) =>
    !CARD_HIDDEN_TAGS.has(t) && (!isDrinks || !DRINK_HIDDEN_TAGS.has(t))
  );
  const isAlcoholic = isDrinks && (ALCOHOLIC_KEYWORDS.test(recipe.title) || (recipe.spirits && recipe.spirits.length > 0));
  // For drinks, prepend Alcoholic/Non-Alcoholic as a display tag instead of badge
  const finalTags = isDrinks
    ? [isAlcoholic ? "Alcoholic" : "Non-Alcoholic", ...displayTags]
    : displayTags;

  return (
    <button
      onClick={onClick}
      className="wk-card flex h-full w-full flex-col overflow-hidden rounded-[var(--wk-radius-card)] border-[length:var(--wk-border-card)] border-stone-200 bg-white text-left shadow-[var(--wk-shadow-card)] transition-all hover:shadow-[var(--wk-shadow-card-hover)] active:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:active:bg-stone-800 dark:hover:border-orange-500/30"
    >
      {/* Image */}
      <div className="relative aspect-3/2 w-full shrink-0 overflow-hidden bg-stone-100 dark:bg-stone-800">
        {recipe.thumbnailUrl ? (
          <RecipeImage src={recipe.thumbnailUrl} alt={recipe.title} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-stone-300 dark:text-stone-600">
            <WhiskLogo className="w-10 h-10" />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleWantToMake();
          }}
          className="absolute top-1.5 left-1.5 p-1.5 rounded-full bg-black/30 backdrop-blur-sm"
          title={recipe.wantToMake ? "Remove from Want to Make" : "Want to Make"}
        >
          <CalendarDays className={classNames("w-5 h-5", recipe.wantToMake ? "text-orange-400" : "text-white/80")} />
        </button>
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

      {/* Info — flex-grow fills remaining card height, justify-between pins metadata to bottom */}
      <div className="flex flex-1 flex-col justify-between p-3">
        <div>
          <h3 className="font-semibold text-sm line-clamp-2 min-h-10 dark:text-stone-100">
            {recipe.title}
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">
            {finalTags.length > 0 ? finalTags.slice(0, 3).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(", ") : "\u00A0"}
          </p>
        </div>

        <div className="flex items-center gap-3 mt-1.5 text-xs text-stone-500 dark:text-stone-400">
          {isDrinks && recipe.spirits && recipe.spirits.length > 0 ? (
            <span className="truncate">{recipe.spirits.join(", ")}</span>
          ) : totalTime ? (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {totalTime}
            </span>
          ) : null}
          {recipe.avgRating && (
            <span className="flex items-center gap-1 text-amber-500">
              <svg className="w-3.5 h-3.5 fill-amber-400" viewBox="0 0 24 24"><path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
              {recipe.avgRating}
            </span>
          )}
          {recipe.cookedCount != null && recipe.cookedCount > 0 && (
            <span className="flex items-center gap-1 text-green-500" title={`Made ${recipe.cookedCount} time${recipe.cookedCount !== 1 ? "s" : ""}`}>
              <Check className="w-3.5 h-3.5" /> {recipe.cookedCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
