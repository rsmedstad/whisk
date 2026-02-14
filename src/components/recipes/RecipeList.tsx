import { useState, useMemo } from "react";
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

type SortOption = "recent" | "alpha" | "cookTime" | "lastViewed";

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
  const [sort, setSort] = useState<SortOption>("recent");
  const [showSort, setShowSort] = useState(false);

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

  // Top tags: prioritize those actually used, max ~15
  const topTags = useMemo(() => {
    const usedTags = new Set(recipes.flatMap((r) => r.tags));
    return availableTags.filter((t) => usedTags.has(t)).slice(0, 15);
  }, [recipes, availableTags]);

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
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
        <div className="flex items-center justify-between py-3">
          <h1 className="text-xl font-bold dark:text-stone-100">Whisk</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate("/settings")}
              className="p-2 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
              title="Settings"
            >
              &#9881;
            </button>
            <button
              onClick={() => setShowSort(!showSort)}
              className="p-2 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
              title="Sort"
            >
              &#8693;
            </button>
            <button
              onClick={() => navigate("/recipes/new")}
              className="p-2 text-orange-500 hover:text-orange-600 text-xl font-bold"
              title="Add recipe"
            >
              +
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
            className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
          />
        </div>

        {/* Sort dropdown */}
        {showSort && (
          <div className="pb-2 flex gap-2 flex-wrap">
            {(
              [
                ["recent", "Recent"],
                ["alpha", "A-Z"],
                ["cookTime", "Cook time"],
                ["lastViewed", "Last viewed"],
              ] as [SortOption, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setSort(value);
                  setShowSort(false);
                }}
                className={classNames(
                  "px-3 py-1 rounded-full text-xs font-medium border",
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

        {/* Tag filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-3 no-scrollbar">
          <TagChip
            label="All"
            selected={!favoritesOnly && selectedTags.length === 0}
            onToggle={() => {
              setSelectedTags([]);
              setFavoritesOnly(false);
            }}
          />
          <TagChip
            label={"Favorites"}
            selected={favoritesOnly}
            onToggle={() => setFavoritesOnly(!favoritesOnly)}
          />
          {topTags.map((tag) => (
            <TagChip
              key={tag}
              label={tag}
              selected={selectedTags.includes(tag)}
              onToggle={() => toggleTag(tag)}
            />
          ))}
        </div>
      </div>

      {/* Install prompt */}
      <InstallPrompt />

      {/* Recipe cards */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-24">
        {filtered.length === 0 ? (
          <EmptyState
            icon={"&#x1F373;"}
            title="No recipes yet"
            description={
              search || selectedTags.length
                ? "Try a different search or filter"
                : "Tap + to add your first recipe"
            }
            action={
              !search &&
              !selectedTags.length && (
                <Button onClick={() => navigate("/recipes/new")}>
                  Add Recipe
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
      className="flex w-full gap-3 rounded-xl border border-stone-200 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md active:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:active:bg-stone-800"
    >
      {/* Thumbnail */}
      <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800">
        {recipe.thumbnailUrl ? (
          <img
            src={recipe.thumbnailUrl}
            alt={recipe.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl text-stone-300 dark:text-stone-600">
            &#x1F372;
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <h3 className="font-semibold text-sm truncate dark:text-stone-100">
            {recipe.title}
          </h3>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            className="flex-shrink-0 text-lg leading-none"
          >
            {recipe.favorite ? (
              <span className="text-red-500">&#9829;</span>
            ) : (
              <span className="text-stone-300 dark:text-stone-600">&#9825;</span>
            )}
          </button>
        </div>

        {recipe.tags.length > 0 && (
          <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">
            {recipe.tags.slice(0, 3).join(", ")}
          </p>
        )}

        <div className="flex items-center gap-3 mt-1.5 text-xs text-stone-400 dark:text-stone-500">
          {totalTime && <span>&#x1F552; {totalTime}</span>}
          {recipe.servings && <span>&#x1F37D; {recipe.servings} srv</span>}
        </div>
      </div>
    </button>
  );
}
