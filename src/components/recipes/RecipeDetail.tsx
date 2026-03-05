import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Recipe, Ingredient, Step } from "../../types";
import { useRecipes } from "../../hooks/useRecipes";
import { getLocal, CACHE_KEYS } from "../../lib/cache";
import { useTags } from "../../hooks/useTags";
import {
  formatTime,
  scaleIngredient,
  classNames,
  parseTimerFromText,
  decodeEntities,
} from "../../lib/utils";
import { categorizeIngredient, CATEGORY_LABELS, CATEGORY_ORDER } from "../../lib/categories";
import { estimateGrams } from "../../lib/units";
import { parseFraction } from "../../lib/utils";
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { TagChip } from "../ui/TagChip";
import { ChevronLeft, HeartFilled, Heart, EllipsisVertical, PlayCircle, Clock, Users, Stopwatch, Check, Fire, Tag, XMark } from "../ui/Icon";

interface RecipeDetailProps {
  onStartTimer: (label: string, minutes: number, recipeId: string, stepIndex: number) => void;
  onAddToShoppingList: (ingredients: Ingredient[], recipeId: string) => Promise<{ added: number; skippedDuplicates: number }>;
  onUndoShoppingList: (recipeId: string) => Promise<void>;
}

// Common pantry staples to skip with "Add Essentials"
const PANTRY_STAPLES = new Set([
  "salt", "pepper", "black pepper", "olive oil", "vegetable oil", "canola oil",
  "cooking spray", "water", "ice", "nonstick spray", "oil",
]);

export function RecipeDetail({ onStartTimer, onAddToShoppingList, onUndoShoppingList }: RecipeDetailProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getRecipe, toggleFavorite, deleteRecipe, updateRecipe, markCooked } = useRecipes();
  const tags = useTags();
  // Initialize from cache synchronously — no spinner for cached recipes
  const cachedRecipe = id ? getLocal<Recipe>(CACHE_KEYS.RECIPE(id)) : null;
  const [recipe, setRecipe] = useState<Recipe | null>(cachedRecipe);
  const [isLoading, setIsLoading] = useState(!cachedRecipe);
  const [scaledServings, setScaledServings] = useState<number | null>(cachedRecipe?.servings ?? null);
  const [showOverflow, setShowOverflow] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<"ingredients" | "steps">("ingredients");
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [shoppingToast, setShoppingToast] = useState<{ message: string; recipeId: string } | null>(null);
  const [justCooked, setJustCooked] = useState(false);
  const [ingredientSort, setIngredientSort] = useState<"recipe" | "category">(
    () => (localStorage.getItem("whisk_ingredient_sort") as "recipe" | "category") ?? "recipe"
  );
  const [ingredientResetKey, setIngredientResetKey] = useState(0);
  const showGrams = localStorage.getItem("whisk_show_grams") === "true";
  const [isRefetching, setIsRefetching] = useState(false);
  const [isGroupingSteps, setIsGroupingSteps] = useState(false);
  const galleryRef = useRef<HTMLDivElement>(null);

  // Background refresh — updates from network silently
  useEffect(() => {
    if (!id) return;
    getRecipe(id)
      .then((r) => {
        setRecipe(r);
        if (!cachedRecipe) setScaledServings(r.servings ?? null);
      })
      .catch(() => { if (!cachedRecipe) navigate("/"); })
      .finally(() => setIsLoading(false));
  }, [id, getRecipe, navigate]);

  const handleDelete = useCallback(async () => {
    if (!recipe || !confirm("Delete this recipe?")) return;
    await deleteRecipe(recipe.id);
    navigate("/");
  }, [recipe, deleteRecipe, navigate]);

  const handleFavorite = useCallback(async () => {
    if (!recipe) return;
    await toggleFavorite(recipe.id);
    setRecipe((r) => (r ? { ...r, favorite: !r.favorite } : r));
  }, [recipe, toggleFavorite]);

  const handleToggleTag = useCallback(async (tag: string) => {
    if (!recipe) return;
    const newTags = recipe.tags.includes(tag)
      ? recipe.tags.filter((t) => t !== tag)
      : [...recipe.tags, tag];
    setRecipe((r) => (r ? { ...r, tags: newTags } : r));
    await updateRecipe(recipe.id, { tags: newTags });
  }, [recipe, updateRecipe]);

  const handleAddNewTag = useCallback(async () => {
    const name = newTag.trim().toLowerCase();
    if (!name || !recipe) return;
    if (!tags.allTagNames.includes(name)) {
      await tags.addCustomTag(name);
    }
    if (!recipe.tags.includes(name)) {
      await handleToggleTag(name);
    }
    setNewTag("");
  }, [newTag, recipe, tags, handleToggleTag]);

  const handleAddToList = useCallback(async (essentialsOnly: boolean) => {
    if (!recipe) return;
    const ings = essentialsOnly
      ? recipe.ingredients.filter((i) => !PANTRY_STAPLES.has(i.name.toLowerCase().trim()))
      : recipe.ingredients;
    const result = await onAddToShoppingList(ings, recipe.id);
    if (result.added > 0) {
      setShoppingToast({
        message: `Added ${result.added} item${result.added !== 1 ? "s" : ""} to list`,
        recipeId: recipe.id,
      });
      setTimeout(() => setShoppingToast(null), 5000);
    } else if (result.skippedDuplicates > 0) {
      setShoppingToast({
        message: "Already on your list",
        recipeId: "",
      });
      setTimeout(() => setShoppingToast(null), 3000);
    }
  }, [recipe, onAddToShoppingList]);

  const handleUndoAdd = useCallback(async () => {
    if (!shoppingToast?.recipeId) return;
    await onUndoShoppingList(shoppingToast.recipeId);
    setShoppingToast(null);
  }, [shoppingToast, onUndoShoppingList]);

  const handleRefetch = useCallback(async () => {
    if (!recipe?.source?.url || isRefetching) return;
    setIsRefetching(true);
    try {
      const res = await fetch("/api/import/url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
        },
        body: JSON.stringify({ url: recipe.source.url, downloadImage: true }),
      });
      if (!res.ok) throw new Error("Fetch failed");
      const data = (await res.json()) as Record<string, unknown>;

      const updates: Record<string, unknown> = { lastCrawledAt: new Date().toISOString() };
      if (data.title) updates.title = data.title;
      if (data.description) updates.description = data.description;
      if (Array.isArray(data.ingredients) && data.ingredients.length) updates.ingredients = data.ingredients;
      if (Array.isArray(data.steps) && data.steps.length) updates.steps = data.steps;
      if (data.prepTime) updates.prepTime = data.prepTime;
      if (data.cookTime) updates.cookTime = data.cookTime;
      if (data.servings) updates.servings = data.servings;
      if (data.videoUrl) updates.videoUrl = data.videoUrl;
      if (Array.isArray(data.photos) && data.photos.length) {
        updates.photos = data.photos;
        const primary = (data.photos as { url: string; isPrimary: boolean }[]).find((p) => p.isPrimary);
        if (primary) updates.thumbnailUrl = primary.url;
      }

      await updateRecipe(recipe.id, updates);
      setRecipe((r) => (r ? { ...r, ...updates } as Recipe : r));
    } catch {
      alert("Could not refresh from source. The site may block automated access.");
    } finally {
      setIsRefetching(false);
    }
  }, [recipe, isRefetching, updateRecipe]);

  const handleGroupSteps = useCallback(async () => {
    if (!recipe || isGroupingSteps) return;
    const hasGroups = recipe.steps.some((s) => s.group);
    if (hasGroups) {
      // Clear groups
      const clearedSteps = recipe.steps.map((s) => ({ ...s, group: undefined }));
      setRecipe((r) => r ? { ...r, steps: clearedSteps } : r);
      await updateRecipe(recipe.id, { steps: clearedSteps });
      return;
    }
    setIsGroupingSteps(true);
    try {
      const res = await fetch("/api/ai/group-steps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
        },
        body: JSON.stringify({
          title: recipe.title,
          steps: recipe.steps.map((s) => s.text),
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { groups: string[] };
      if (data.groups.length === recipe.steps.length) {
        const groupedSteps = recipe.steps.map((s, i) => ({ ...s, group: data.groups[i] }));
        setRecipe((r) => r ? { ...r, steps: groupedSteps } : r);
        await updateRecipe(recipe.id, { steps: groupedSteps });
      }
    } catch {
      // Silent fail
    } finally {
      setIsGroupingSteps(false);
    }
  }, [recipe, isGroupingSteps, updateRecipe]);

  const photos = useMemo(
    () => recipe?.photos?.length ? recipe.photos.filter((p, i, arr) => arr.findIndex((q) => q.url === p.url) === i) : [],
    [recipe?.photos]
  );

  if (isLoading || !recipe) {
    return <LoadingSpinner className="py-20" size="lg" />;
  }

  const originalServings = recipe.servings ?? 1;
  const servings = scaledServings ?? originalServings;
  const ingredients = recipe.ingredients.map((ing) =>
    scaleIngredient(ing, originalServings, servings)
  );

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 py-3 pt-[calc(var(--sat)+0.75rem)]">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-stone-600 dark:text-stone-400 font-medium text-sm"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          <HeaderStarRating
            ratings={recipe.ratings}
            onRate={(value) => {
              updateRecipe(recipe.id, { rating: value } as unknown as Partial<Recipe>);
              setRecipe((r) => {
                if (!r) return r;
                const dn = localStorage.getItem("whisk_display_name") ?? "User";
                const ratings = { ...(r.ratings ?? {}) };
                if (value === 0) { delete ratings[dn]; } else { ratings[dn] = value; }
                return { ...r, ratings };
              });
            }}
          />
          <button onClick={handleFavorite}>
            {recipe.favorite ? (
              <HeartFilled className="w-5 h-5 text-red-500" />
            ) : (
              <Heart className="w-5 h-5 text-stone-400" />
            )}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowOverflow(!showOverflow)}
              className="text-stone-500 dark:text-stone-400 px-1"
            >
              <EllipsisVertical className="w-5 h-5" />
            </button>
            {showOverflow && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowOverflow(false)}
                />
                <div className="absolute right-0 top-8 z-50 w-48 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800">
                  <button
                    onClick={() => {
                      navigate(`/recipes/${recipe.id}/edit`);
                      setShowOverflow(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-700 dark:text-stone-200"
                  >
                    Edit Recipe
                  </button>
                  {recipe.source?.url && (
                    <button
                      onClick={() => {
                        handleRefetch();
                        setShowOverflow(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-700 dark:text-stone-200"
                    >
                      {isRefetching ? "Updating..." : "Update from Source"}
                    </button>
                  )}
                  <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
                  <button
                    onClick={() => {
                      handleDelete();
                      setShowOverflow(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-stone-700"
                  >
                    Delete Recipe
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Hero photo gallery — horizontal scroll-snap carousel */}
      {(photos.length > 0 || recipe.videoUrl) && (() => {
        const totalSlides = photos.length + (recipe.videoUrl ? 1 : 0);
        const isVideoSlide = recipe.videoUrl && photoIndex === photos.length;
        const scrollToSlide = (idx: number) => {
          const el = galleryRef.current;
          if (!el) return;
          el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
        };
        return (
        <div className="relative group">
          <div
            ref={galleryRef}
            className="flex snap-x snap-mandatory overflow-x-auto no-scrollbar"
            onScroll={(e) => {
              const el = e.currentTarget;
              const idx = Math.round(el.scrollLeft / el.clientWidth);
              setPhotoIndex(idx);
            }}
          >
            {photos.map((photo, i) => (
              <div
                key={i}
                className="aspect-video w-full shrink-0 snap-center bg-stone-100 dark:bg-stone-800"
              >
                <img
                  src={photo.url}
                  alt={photo.caption ?? `${recipe.title} photo ${i + 1}`}
                  className="h-full w-full object-cover"
                  loading={i === 0 ? "eager" : "lazy"}
                />
              </div>
            ))}
            {recipe.videoUrl && (
              <div className="aspect-video w-full shrink-0 snap-center bg-stone-900 flex flex-col items-center justify-center">
                {recipe.videoUrl.includes("youtube.com") || recipe.videoUrl.includes("youtu.be") ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${recipe.videoUrl.match(/(?:v=|youtu\.be\/)([\w-]+)/)?.[1] ?? ""}`}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Recipe video"
                  />
                ) : (
                  <a
                    href={recipe.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-2 text-white"
                  >
                    <PlayCircle className="w-12 h-12" />
                    <span className="text-sm font-medium">Watch Recipe Video</span>
                  </a>
                )}
              </div>
            )}
          </div>
          {/* Desktop arrow buttons */}
          {totalSlides > 1 && photoIndex > 0 && (
            <button
              onClick={() => scrollToSlide(photoIndex - 1)}
              className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {totalSlides > 1 && photoIndex < totalSlides - 1 && (
            <button
              onClick={() => scrollToSlide(photoIndex + 1)}
              className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronLeft className="w-5 h-5 rotate-180" />
            </button>
          )}
          {totalSlides > 1 && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
              {Array.from({ length: totalSlides }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => scrollToSlide(i)}
                  className={classNames(
                    "h-2 w-2 rounded-full transition-colors",
                    i === photoIndex ? "bg-white" : "bg-white/50"
                  )}
                />
              ))}
            </div>
          )}
          {totalSlides > 1 && !isVideoSlide && (
            <div className="absolute top-3 right-3 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white pointer-events-none">
              {photoIndex + 1}/{totalSlides}
            </div>
          )}
          {recipe.videoUrl && !isVideoSlide && (
            <button
              onClick={() => scrollToSlide(photos.length)}
              className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white flex items-center gap-1"
            >
              <PlayCircle className="w-4 h-4" /> Video &rarr;
            </button>
          )}
        </div>
        );
      })()}

      <div className="px-4 py-4 space-y-6">
        {/* Title & meta */}
        <div>
          <h1 className="text-2xl font-bold dark:text-stone-100">
            {decodeEntities(recipe.title)}
          </h1>
          {recipe.description && (
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {decodeEntities(recipe.description)}
            </p>
          )}
          <div className="flex flex-wrap gap-3 mt-2 text-sm text-stone-500 dark:text-stone-400">
            {(recipe.prepTime || recipe.cookTime) && (
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {formatTime((recipe.prepTime ?? 0) + (recipe.cookTime ?? 0))}
              </span>
            )}
            {recipe.servings && (
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4" /> {recipe.servings} servings
              </span>
            )}
            {recipe.yield && <span>{recipe.yield}</span>}
            {recipe.difficulty && (
              <span className="capitalize">{recipe.difficulty}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2 items-center">
            {recipe.tags.map((tag) => (
              <TagChip
                key={tag}
                label={tag}
                size="sm"
                selected={showTagEditor}
                onToggle={() => showTagEditor ? handleToggleTag(tag) : navigate(`/?tag=${tag}`)}
              />
            ))}
            <button
              onClick={() => setShowTagEditor(!showTagEditor)}
              className={classNames(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
                showTagEditor
                  ? "border-orange-500 text-orange-600 dark:text-orange-400"
                  : "border-stone-300 text-stone-400 dark:border-stone-600 dark:text-stone-500"
              )}
            >
              <Tag className="w-3 h-3" /> {showTagEditor ? "Done" : "Edit"}
            </button>
          </div>
          {showTagEditor && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {tags.allTagNames
                  .filter((t) => !recipe.tags.includes(t))
                  .slice(0, 15)
                  .map((tag) => (
                    <TagChip
                      key={tag}
                      label={tag}
                      size="sm"
                      onToggle={() => handleToggleTag(tag)}
                    />
                  ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-base sm:text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                  placeholder="New tag..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddNewTag();
                    }
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAddNewTag}
                  disabled={!newTag.trim()}
                >
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-stone-200 dark:border-stone-700">
          <button
            onClick={() => setActiveTab("ingredients")}
            className={classNames(
              "flex-1 py-2.5 text-sm font-semibold text-center transition-colors relative",
              activeTab === "ingredients"
                ? "text-orange-600 dark:text-orange-400"
                : "text-stone-500 dark:text-stone-400"
            )}
          >
            Ingredients
            {activeTab === "ingredients" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("steps")}
            className={classNames(
              "flex-1 py-2.5 text-sm font-semibold text-center transition-colors relative",
              activeTab === "steps"
                ? "text-orange-600 dark:text-orange-400"
                : "text-stone-500 dark:text-stone-400"
            )}
          >
            Steps{recipe.steps.length > 0 && ` (${recipe.steps.length})`}
            {activeTab === "steps" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
            )}
          </button>
        </div>

        {/* Ingredients tab */}
        {activeTab === "ingredients" && (
          <section>
            {recipe.servings && (
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm text-stone-500 dark:text-stone-400 shrink-0">
                  Scale:
                </span>
                <div className="flex gap-1.5">
                  {[
                    { label: "½×", mult: 0.5 },
                    { label: "1×", mult: 1 },
                    { label: "2×", mult: 2 },
                    { label: "3×", mult: 3 },
                    { label: "4×", mult: 4 },
                  ].map(({ label, mult }) => {
                    const target = Math.round(originalServings * mult);
                    const isActive = servings === target;
                    return (
                      <button
                        key={mult}
                        onClick={() => setScaledServings(target)}
                        className={classNames(
                          "px-3 py-1 rounded-full text-sm font-medium transition-colors",
                          isActive
                            ? "bg-orange-500 text-white"
                            : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <span className="text-xs text-stone-400 dark:text-stone-500 shrink-0">
                  {servings} servings
                </span>
              </div>
            )}

            {/* Ingredient sort toggle + reset */}
            <div className="flex items-center gap-1.5 mb-3">
              {([
                { value: "recipe" as const, label: "Recipe order" },
                { value: "category" as const, label: "By category" },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => {
                    setIngredientSort(value);
                    localStorage.setItem("whisk_ingredient_sort", value);
                  }}
                  className={classNames(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    ingredientSort === value
                      ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                  )}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => setIngredientResetKey((k) => k + 1)}
                className="ml-auto text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
              >
                Clear checked
              </button>
            </div>

            {showGrams && ingredients.length > 0 && (
              <p className="text-[11px] text-stone-400 dark:text-stone-500 -mt-1 mb-3">
                Gram weights are estimates based on typical ingredient densities
              </p>
            )}

            {ingredients.length > 0 ? (
              <GroupedIngredients ingredients={ingredients} sort={ingredientSort} resetKey={ingredientResetKey} showGrams={showGrams} />
            ) : (
              <p className="text-sm text-stone-400 dark:text-stone-500 py-4 text-center">
                No ingredients listed
              </p>
            )}

          </section>
        )}

        {/* Steps tab */}
        {activeTab === "steps" && (
          <section>
            {recipe.steps.length > 0 ? (
              <>
                {recipe.steps.length >= 3 && (
                  <div className="mb-3">
                    <button
                      onClick={handleGroupSteps}
                      disabled={isGroupingSteps}
                      className={classNames(
                        "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                        recipe.steps.some((s) => s.group)
                          ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                          : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                      )}
                    >
                      {isGroupingSteps ? "Grouping..." : recipe.steps.some((s) => s.group) ? "Grouped by Section" : "Group Sections"}
                    </button>
                  </div>
                )}

                <StepsList steps={recipe.steps} recipeId={recipe.id} onStartTimer={onStartTimer} />

                <Button
                  fullWidth
                  className="mt-4"
                  onClick={() => navigate(`/recipes/${recipe.id}/cook`)}
                >
                  <span className="flex items-center justify-center gap-2">
                    <Fire className="w-5 h-5" /> Cook Mode
                  </span>
                </Button>
              </>
            ) : (
              <p className="text-sm text-stone-400 dark:text-stone-500 py-4 text-center">
                No steps listed
              </p>
            )}
          </section>
        )}

        {/* Planning — two columns on desktop */}
        <section className="border-t border-stone-200 dark:border-stone-700 pt-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Cooking Log */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Cooking Log
              </h3>
              <button
                onClick={() => {
                  if (recipe && !justCooked) {
                    markCooked(recipe.id);
                    setRecipe((r) => r ? { ...r, cookedCount: (r.cookedCount ?? 0) + 1, lastCookedAt: new Date().toISOString() } : r);
                    setJustCooked(true);
                    setTimeout(() => setJustCooked(false), 2000);
                  }
                }}
                className={classNames(
                  "w-full flex items-center justify-center gap-2 rounded-(--wk-radius-btn) border px-4 py-2.5 text-sm font-medium transition-colors",
                  justCooked
                    ? "border-green-500 bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400"
                    : "border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 hover:border-green-500 hover:text-green-600 dark:hover:text-green-400"
                )}
              >
                <Check className="w-4 h-4" />
                {justCooked ? "Logged!" : "Made This"}
              </button>
              {(recipe.cookedCount || recipe.lastCookedAt) && (
                <p className="text-xs text-stone-400 dark:text-stone-500 text-center">
                  {recipe.cookedCount ? `Cooked ${recipe.cookedCount} time${recipe.cookedCount !== 1 ? "s" : ""}` : ""}
                  {recipe.cookedCount && recipe.lastCookedAt ? " · " : ""}
                  {recipe.lastCookedAt ? `Last ${new Date(recipe.lastCookedAt).toLocaleDateString()}` : ""}
                </p>
              )}
            </div>

            {/* Shopping */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Shopping List
              </h3>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => handleAddToList(true)}
                >
                  Add Essentials
                </Button>
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => handleAddToList(false)}
                >
                  Add All
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Notes */}
        {recipe.notes && (
          <section className="border-t border-stone-200 dark:border-stone-700 pt-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500 mb-2">
              Notes
            </h2>
            <p className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-wrap">
              {decodeEntities(recipe.notes)}
            </p>
          </section>
        )}

        {/* Source */}
        {(recipe.source?.url || recipe.source?.attribution) && (
          <div className="border-t border-stone-200 dark:border-stone-700 pt-4 text-sm text-stone-400 dark:text-stone-500 space-y-0.5">
            <div>
              Source:{" "}
              {recipe.source.url ? (
                <a
                  href={recipe.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-500 hover:underline"
                >
                  {recipe.source.domain ?? recipe.source.url}
                </a>
              ) : (
                <span className="text-stone-600 dark:text-stone-300">{recipe.source.attribution}</span>
              )}
            </div>
            {recipe.lastCrawledAt && (
              <div className="text-xs">
                Last fetched {new Date(recipe.lastCrawledAt).toLocaleDateString()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Shopping list toast */}
      {shoppingToast && (
        <div className="fixed bottom-20 inset-x-0 z-50 max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between rounded-lg bg-stone-800 px-4 py-3 text-sm text-white shadow-lg dark:bg-stone-700">
            <span>{shoppingToast.message}</span>
            {shoppingToast.recipeId && (
              <button
                onClick={handleUndoAdd}
                className="ml-3 font-semibold text-orange-400 hover:text-orange-300"
              >
                Undo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupedIngredients({ ingredients, sort, resetKey, showGrams }: { ingredients: Ingredient[]; sort: "recipe" | "category"; resetKey: number; showGrams: boolean }) {
  // If any ingredient has an explicit group (e.g. "For the sauce"), use those
  const hasExplicitGroups = ingredients.some((i) => i.group);

  // Recipe order: use explicit groups if present, otherwise flat list
  if (sort === "recipe") {
    if (hasExplicitGroups) {
      const groups = new Map<string, Ingredient[]>();
      for (const ing of ingredients) {
        const key = ing.group ?? "";
        const list = groups.get(key);
        if (list) list.push(ing);
        else groups.set(key, [ing]);
      }
      return (
        <div className="space-y-4">
          {[...groups.entries()].map(([group, ings]) => (
            <div key={group}>
              {group && (
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">
                  {group}
                </h3>
              )}
              <ul className="space-y-2">
                {ings.map((ing, i) => (
                  <IngredientRow key={`${resetKey}-${i}`} ingredient={ing} hideGroup showGrams={showGrams} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    }

    return (
      <ul className="space-y-2">
        {ingredients.map((ing, i) => (
          <IngredientRow key={`${resetKey}-${i}`} ingredient={ing} showGrams={showGrams} />
        ))}
      </ul>
    );
  }

  // Category sort: auto-group by shopping category
  const grouped = new Map<string, Ingredient[]>();
  for (const ing of ingredients) {
    const cat = categorizeIngredient(ing.name);
    const list = grouped.get(cat);
    if (list) list.push(ing);
    else grouped.set(cat, [ing]);
  }

  // If everything falls into one category, skip headers
  if (grouped.size <= 1) {
    return (
      <ul className="space-y-2">
        {ingredients.map((ing, i) => (
          <IngredientRow key={`${resetKey}-${i}`} ingredient={ing} showGrams={showGrams} />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-4">
      {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => {
        const ings = grouped.get(cat)!;
        return (
          <div key={cat}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">
              {CATEGORY_LABELS[cat]}
            </h3>
            <ul className="space-y-2">
              {ings.map((ing, i) => (
                <IngredientRow key={`${resetKey}-${cat}-${i}`} ingredient={ing} showGrams={showGrams} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function StepRow({ step, index, recipeId, onStartTimer }: {
  step: Step;
  index: number;
  recipeId: string;
  onStartTimer: (label: string, minutes: number, recipeId: string, stepIndex: number) => void;
}) {
  const timerMin = step.timerMinutes ?? parseTimerFromText(step.text);
  return (
    <li className="flex gap-3">
      <span className="shrink-0 h-6 w-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex items-center justify-center dark:bg-orange-900 dark:text-orange-300">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-relaxed dark:text-stone-200">
          {decodeEntities(step.text)}
        </p>
        {step.photoUrl && (
          <img
            src={step.photoUrl}
            alt={`Step ${index + 1}`}
            className="mt-2 rounded-lg max-h-48 object-cover"
            loading="lazy"
          />
        )}
        {timerMin && (
          <button
            onClick={() => onStartTimer(`Step ${index + 1}`, timerMin, recipeId, index)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-600 dark:bg-orange-950 dark:text-orange-400"
          >
            <Stopwatch className="w-3.5 h-3.5" /> {timerMin}:00
          </button>
        )}
      </div>
    </li>
  );
}

function StepsList({ steps, recipeId, onStartTimer }: {
  steps: Step[];
  recipeId: string;
  onStartTimer: (label: string, minutes: number, recipeId: string, stepIndex: number) => void;
}) {
  const hasGroups = steps.some((s) => s.group);

  if (!hasGroups) {
    return (
      <ol className="space-y-4">
        {steps.map((step, i) => (
          <StepRow key={i} step={step} index={i} recipeId={recipeId} onStartTimer={onStartTimer} />
        ))}
      </ol>
    );
  }

  // Group steps by section, preserving order
  const sections: { name: string; steps: { step: Step; originalIndex: number }[] }[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const groupName = step.group ?? "";
    const last = sections[sections.length - 1];
    if (last && last.name === groupName) {
      last.steps.push({ step, originalIndex: i });
    } else {
      sections.push({ name: groupName, steps: [{ step, originalIndex: i }] });
    }
  }

  return (
    <div className="space-y-6">
      {sections.map((section, si) => (
        <div key={si}>
          {section.name && (
            <h3 className="text-xs font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-2">
              {section.name}
            </h3>
          )}
          <ol className="space-y-4">
            {section.steps.map(({ step, originalIndex }) => (
              <StepRow key={originalIndex} step={step} index={originalIndex} recipeId={recipeId} onStartTimer={onStartTimer} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function IngredientRow({ ingredient, hideGroup, showGrams }: { ingredient: Ingredient; hideGroup?: boolean; showGrams?: boolean }) {
  const [checked, setChecked] = useState(false);

  const display = decodeEntities(
    [ingredient.amount, ingredient.unit, ingredient.name].filter(Boolean).join(" ")
  );

  // Estimate gram weight for volume-based ingredients
  let gramDisplay: string | null = null;
  if (showGrams && ingredient.amount && ingredient.unit) {
    const parsed = parseFraction(ingredient.amount);
    if (parsed !== null) {
      const grams = estimateGrams(parsed, ingredient.unit, ingredient.name);
      if (grams !== null) {
        gramDisplay = `${grams}g`;
      }
    }
  }

  return (
    <li
      className={classNames(
        "flex items-center gap-2 text-sm cursor-pointer",
        checked && "line-through text-stone-400 dark:text-stone-500"
      )}
      onClick={() => setChecked(!checked)}
    >
      <span
        className={classNames(
          "h-4 w-4 rounded border shrink-0 flex items-center justify-center",
          checked
            ? "bg-orange-500 border-orange-500 text-white"
            : "border-stone-300 dark:border-stone-600"
        )}
      >
        {checked && <Check className="w-3 h-3" />}
      </span>
      <span className="dark:text-stone-200">
        {!hideGroup && ingredient.group && (
          <span className="font-medium text-stone-500 dark:text-stone-400">
            {ingredient.group}:{" "}
          </span>
        )}
        {display}
        {gramDisplay && (
          <span className="ml-1 text-xs text-stone-400 dark:text-stone-500 font-normal">
            ({gramDisplay})
          </span>
        )}
      </span>
    </li>
  );
}

const STAR_PATH = "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z";

function HeaderStarRating({ ratings, onRate }: { ratings?: Record<string, number>; onRate: (value: number) => void }) {
  const [open, setOpen] = useState(false);
  const displayName = localStorage.getItem("whisk_display_name") ?? "User";
  const myRating = ratings?.[displayName] ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-0.5 p-1"
      >
        <svg
          className={classNames(
            "w-5 h-5",
            myRating > 0 ? "text-amber-400 fill-amber-400" : "text-stone-400 dark:text-stone-500 fill-none"
          )}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={STAR_PATH} />
        </svg>
        {myRating > 0 && (
          <span className="text-xs font-semibold text-amber-500">{myRating}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-44 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800 py-1">
            {[5, 4, 3, 2, 1].map((star) => (
              <button
                key={star}
                onClick={() => { onRate(star === myRating ? 0 : star); setOpen(false); }}
                className={classNames(
                  "w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors",
                  star === myRating
                    ? "bg-amber-50 dark:bg-amber-950/30"
                    : "hover:bg-stone-50 dark:hover:bg-stone-700"
                )}
              >
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: star }).map((_, i) => (
                    <svg key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" viewBox="0 0 24 24">
                      <path d={STAR_PATH} />
                    </svg>
                  ))}
                </div>
                <span className={classNames(
                  "dark:text-stone-200",
                  star === myRating ? "font-semibold text-amber-600 dark:text-amber-400" : "text-stone-600"
                )}>
                  {star === 5 ? "Amazing" : star === 4 ? "Great" : star === 3 ? "Good" : star === 2 ? "OK" : "Meh"}
                </span>
                {star === myRating && <span className="ml-auto text-xs text-amber-500">yours</span>}
              </button>
            ))}
            {myRating > 0 && (
              <button
                onClick={() => { onRate(0); setOpen(false); }}
                className="w-full px-3 py-2 text-left text-xs text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-700 border-t border-stone-100 dark:border-stone-700"
              >
                Clear my rating
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
