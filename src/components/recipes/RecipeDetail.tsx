import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Recipe, Ingredient } from "../../types";
import { useRecipes } from "../../hooks/useRecipes";
import { getLocal, CACHE_KEYS } from "../../lib/cache";
import { useTags } from "../../hooks/useTags";
import {
  formatTime,
  scaleIngredient,
  classNames,
  parseTimerFromText,
} from "../../lib/utils";
import { categorizeIngredient, CATEGORY_LABELS, CATEGORY_ORDER } from "../../lib/categories";
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { TagChip } from "../ui/TagChip";
import { ChevronLeft, HeartFilled, Heart, Pencil, EllipsisVertical, PlayCircle, Clock, Users, Stopwatch, Check, Fire, Trash, Tag, XMark } from "../ui/Icon";

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
  const [isRefetching, setIsRefetching] = useState(false);

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
        <div className="flex items-center gap-3">
          <button onClick={handleFavorite}>
            {recipe.favorite ? (
              <HeartFilled className="w-5 h-5 text-red-500" />
            ) : (
              <Heart className="w-5 h-5 text-stone-400" />
            )}
          </button>
          <button
            onClick={() => navigate(`/recipes/${recipe.id}/edit`)}
            className="text-stone-500 dark:text-stone-400"
          >
            <Pencil className="w-5 h-5" />
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
                      navigate(`/recipes/${recipe.id}/cook`);
                      setShowOverflow(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-700 dark:text-stone-200"
                  >
                    Start Cooking
                  </button>
                  <button
                    onClick={() => {
                      handleAddToList(true);
                      setShowOverflow(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-700 dark:text-stone-200"
                  >
                    Add to Shopping List
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
        return (
        <div className="relative">
          <div
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
          {totalSlides > 1 && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
              {Array.from({ length: totalSlides }).map((_, i) => (
                <span
                  key={i}
                  className={classNames(
                    "h-2 w-2 rounded-full transition-colors",
                    i === photoIndex ? "bg-white" : "bg-white/50"
                  )}
                />
              ))}
            </div>
          )}
          {totalSlides > 1 && !isVideoSlide && (
            <div className="absolute top-3 right-3 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
              {photoIndex + 1}/{totalSlides}
            </div>
          )}
          {recipe.videoUrl && !isVideoSlide && (
            <div className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white flex items-center gap-1 pointer-events-none">
              <PlayCircle className="w-4 h-4" /> Video &rarr;
            </div>
          )}
        </div>
        );
      })()}

      <div className="px-4 py-4 space-y-6">
        {/* Title & meta */}
        <div>
          <h1 className="text-2xl font-bold dark:text-stone-100">
            {recipe.title}
          </h1>
          {recipe.description && (
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {recipe.description}
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
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (recipe && !justCooked) {
                  markCooked(recipe.id);
                  setRecipe((r) => r ? { ...r, cookedCount: (r.cookedCount ?? 0) + 1, lastCookedAt: new Date().toISOString() } : r);
                  setJustCooked(true);
                  setTimeout(() => setJustCooked(false), 2000);
                }
              }}
              className={classNames(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                justCooked
                  ? "border-green-500 bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400"
                  : "border-stone-300 dark:border-stone-600 text-stone-500 dark:text-stone-400 hover:border-green-500 hover:text-green-600 dark:hover:text-green-400"
              )}
            >
              <Check className="w-3.5 h-3.5" /> {justCooked ? "Logged!" : `Made This${recipe.cookedCount ? ` (${recipe.cookedCount})` : ""}`}
            </button>
            {recipe.lastCookedAt && (
              <span className="text-xs text-stone-400 dark:text-stone-500">
                Last made {new Date(recipe.lastCookedAt).toLocaleDateString()}
              </span>
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

            {/* Ingredient sort toggle */}
            <div className="flex gap-1.5 mb-3">
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
            </div>

            {ingredients.length > 0 ? (
              <GroupedIngredients ingredients={ingredients} sort={ingredientSort} />
            ) : (
              <p className="text-sm text-stone-400 dark:text-stone-500 py-4 text-center">
                No ingredients listed
              </p>
            )}

            <div className="flex gap-2 mt-4">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => handleAddToList(true)}
              >
                Add Essentials
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleAddToList(false)}
                className="shrink-0"
              >
                Add All
              </Button>
            </div>
          </section>
        )}

        {/* Steps tab */}
        {activeTab === "steps" && (
          <section>
            {recipe.steps.length > 0 ? (
              <>
                <ol className="space-y-4">
                  {recipe.steps.map((step, i) => {
                    const timerMin =
                      step.timerMinutes ?? parseTimerFromText(step.text);
                    return (
                      <li key={i} className="flex gap-3">
                        <span className="shrink-0 h-6 w-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex items-center justify-center dark:bg-orange-900 dark:text-orange-300">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-relaxed dark:text-stone-200">
                            {step.text}
                          </p>
                          {step.photoUrl && (
                            <img
                              src={step.photoUrl}
                              alt={`Step ${i + 1}`}
                              className="mt-2 rounded-lg max-h-48 object-cover"
                              loading="lazy"
                            />
                          )}
                          {timerMin && (
                            <button
                              onClick={() =>
                                onStartTimer(
                                  `Step ${i + 1}`,
                                  timerMin,
                                  recipe.id,
                                  i
                                )
                              }
                              className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-600 dark:bg-orange-950 dark:text-orange-400"
                            >
                              <Stopwatch className="w-3.5 h-3.5" /> {timerMin}:00
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>

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

        {/* Notes */}
        {recipe.notes && (
          <section>
            <h2 className="text-lg font-semibold mb-2 dark:text-orange-100/80">
              Notes
            </h2>
            <p className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-wrap">
              {recipe.notes}
            </p>
          </section>
        )}

        {/* Source */}
        {(recipe.source?.url || recipe.source?.attribution) && (
          <div className="text-sm text-stone-400 dark:text-stone-500 space-y-0.5">
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

        {/* Delete */}
        <div className="pt-4 border-t border-stone-200 dark:border-stone-800">
          <button
            onClick={handleDelete}
            className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-medium text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          >
            <Trash className="w-4 h-4" /> Delete Recipe
          </button>
        </div>
      </div>

      {/* Shopping list toast */}
      {shoppingToast && (
        <div className="fixed bottom-20 inset-x-0 z-50 max-w-2xl mx-auto px-4">
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

function GroupedIngredients({ ingredients, sort }: { ingredients: Ingredient[]; sort: "recipe" | "category" }) {
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
                  <IngredientRow key={i} ingredient={ing} hideGroup />
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
          <IngredientRow key={i} ingredient={ing} />
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
          <IngredientRow key={i} ingredient={ing} />
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
                <IngredientRow key={i} ingredient={ing} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function IngredientRow({ ingredient, hideGroup }: { ingredient: Ingredient; hideGroup?: boolean }) {
  const [checked, setChecked] = useState(false);

  const display = [ingredient.amount, ingredient.unit, ingredient.name]
    .filter(Boolean)
    .join(" ");

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
      </span>
    </li>
  );
}
