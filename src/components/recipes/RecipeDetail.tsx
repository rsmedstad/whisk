import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Recipe, Ingredient, Step, MealSlot } from "../../types";
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
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { TagChip } from "../ui/TagChip";
import { ChevronLeft, HeartFilled, Heart, EllipsisVertical, PlayCircle, Clock, Users, Check, Fire, Tag, XMark, Share, PencilSquare, CalendarPlus, Sun } from "../ui/Icon";
import { useWakeLock } from "../../hooks/useWakeLock";
import { GroupedIngredients, StepsList } from "./RecipeComponents";

interface RecipeDetailProps {
  onStartTimer: (label: string, minutes: number, recipeId: string, stepIndex: number) => void;
  onAddToShoppingList: (ingredients: Ingredient[], recipeId: string) => Promise<{ added: number; skippedDuplicates: number }>;
  onUndoShoppingList: (recipeId: string) => Promise<void>;
  onAddMeal?: (date: Date, slot: MealSlot, title: string, recipeId?: string) => Promise<void>;
}

// Common pantry staples to skip with "Add Essentials"
const PANTRY_STAPLES = new Set([
  "salt", "pepper", "black pepper", "olive oil", "vegetable oil", "canola oil",
  "cooking spray", "water", "ice", "nonstick spray", "oil",
]);

export function RecipeDetail({ onStartTimer, onAddToShoppingList, onUndoShoppingList, onAddMeal }: RecipeDetailProps) {
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
  const [hasCheckedIngredients, setHasCheckedIngredients] = useState(false);
  const showGrams = localStorage.getItem("whisk_show_grams") === "true";
  const [isRefetching, setIsRefetching] = useState(false);
  const [isGroupingSteps, setIsGroupingSteps] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const wakeLock = useWakeLock();
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [justPlanned, setJustPlanned] = useState(false);
  const [showMadeDate, setShowMadeDate] = useState(false);
  const [madeDate, setMadeDate] = useState(() => new Date().toISOString().split("T")[0]!);
  const [showPlanDate, setShowPlanDate] = useState(false);
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().split("T")[0]!);
  const [planSlot, setPlanSlot] = useState<MealSlot>("dinner");
  const galleryRef = useRef<HTMLDivElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

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

  const handleAddNote = useCallback(async () => {
    const text = noteText.trim();
    if (!text || !recipe) return;
    const existing = recipe.notes ?? "";
    const updated = existing ? `${existing}\n${text}` : text;
    setRecipe((r) => r ? { ...r, notes: updated } : r);
    await updateRecipe(recipe.id, { notes: updated });
    setNoteText("");
    setShowNoteInput(false);
  }, [recipe, noteText, updateRecipe]);

  const handlePlanThis = useCallback(async (date: string, slot: MealSlot) => {
    if (!recipe || !onAddMeal || justPlanned) return;
    const d = new Date(date + "T12:00:00");
    await onAddMeal(d, slot, recipe.title, recipe.id);
    setJustPlanned(true);
    setShowPlanDate(false);
    setTimeout(() => setJustPlanned(false), 2000);
  }, [recipe, onAddMeal, justPlanned]);

  const handleShare = useCallback(async () => {
    if (!recipe) return;
    const shareUrl = recipe.source?.url;
    const shareData: ShareData = {
      title: recipe.title,
      text: recipe.description ?? recipe.title,
      ...(shareUrl ? { url: shareUrl } : {}),
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch { /* user cancelled */ }
    } else {
      // Fallback: copy to clipboard
      const text = shareUrl
        ? `${recipe.title}\n${shareUrl}`
        : `${recipe.title}${recipe.description ? `\n${recipe.description}` : ""}`;
      await navigator.clipboard.writeText(text);
      setShoppingToast({ message: "Copied to clipboard", recipeId: "" });
      setTimeout(() => setShoppingToast(null), 2000);
    }
  }, [recipe]);

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

  const photos = useMemo(() => {
    const isDrinks = recipe?.tags.includes("drinks");
    if (recipe?.photos?.length) {
      // Normalize CDN image URLs for dedup — strips fingerprints, dimensions, filters
      const normalizeImageKey = (url: string): string => {
        let u = url.split("?")[0]?.replace(/\/$/, "").replace(/^https?:\/\//, "") ?? url;
        // Strip Dotdash /thmb/FINGERPRINT/DIMENSIONs/filters:.../ path segments
        u = u.replace(/\/thmb\/[^/]+\/[^/]*\d+x\d+[^/]*\/(?:filters:[^/]*\/)?/i, "/thmb/");
        // Strip generic CDN size/crop segments like /750x422/, /4x3/, /1500x0/
        u = u.replace(/\/\d+x\d+\//g, "/");
        return u.toLowerCase();
      };
      // Filter out entries with missing URLs, then deduplicate by normalized key + filename
      const seenKeys = new Set<string>();
      const seenFilenames = new Set<string>();
      let deduped = recipe.photos
        .filter((p) => p.url)
        .filter((p) => {
          const key = normalizeImageKey(p.url);
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          const filename = key.split("/").pop() ?? "";
          if (filename.length > 8 && /\.(jpg|jpeg|png|webp|avif)$/.test(filename)) {
            if (seenFilenames.has(filename)) return false;
            seenFilenames.add(filename);
          }
          return true;
        });
      // If we have local R2 photos, filter out external URLs (likely duplicates from import)
      const hasLocal = deduped.some((p) => p.url.startsWith("/"));
      if (hasLocal) {
        deduped = deduped.filter((p) => p.url.startsWith("/"));
      }
      // For drink recipes, only show the primary photo (step photos aren't useful)
      if (isDrinks && deduped.length > 1) {
        const primary = deduped.find((p) => p.isPrimary);
        if (primary) deduped = [primary];
      }
      // If all photos had missing URLs, fall back to thumbnailUrl
      if (deduped.length > 0) return deduped;
    }
    // Fall back to thumbnailUrl if no photos array or all entries had missing URLs
    if (recipe?.thumbnailUrl) {
      return [{ url: recipe.thumbnailUrl, isPrimary: true }];
    }
    return [];
  }, [recipe?.photos, recipe?.thumbnailUrl, recipe?.tags]);

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
        <div className="flex items-center gap-0.5">
          <button onClick={handleShare} className="p-2">
            <Share className="w-5 h-5 text-stone-500 dark:text-stone-400" />
          </button>
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
          <button onClick={handleFavorite} className="p-2">
            {recipe.favorite ? (
              <HeartFilled className="w-5 h-5 text-red-500" />
            ) : (
              <Heart className="w-5 h-5 text-stone-400" />
            )}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowOverflow(!showOverflow)}
              className="text-stone-500 dark:text-stone-400 p-2"
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
          {(() => {
            const isDrinks = recipe.tags.includes("drinks");
            const alcoholicRe = /\b(?:cocktail|margarita|sangria|spritz|mojito|martini|daiquiri|whiskey|whisky|bourbon|vodka|rum|gin|tequila|mezcal|wine|champagne|prosecco|beer|ale|stout|aperol|negroni|mimosa|bellini|paloma|old fashioned|manhattan|cosmopolitan|sour|highball|julep|toddy|mule|collins|fizz|sling|punch|eggnog|grog|amaretto|kahlua|baileys|vermouth|bitters|liqueur|amaro|pisco|sake|soju|hard (?:cider|seltzer|lemonade))\b/i;
            const isAlcoholic = isDrinks && (
              alcoholicRe.test(recipe.title) ||
              recipe.ingredients.some((i) => alcoholicRe.test(i.name))
            );
            // Tags to hide for drinks — food-oriented labels
            const drinkHiddenTags = new Set([
              "weeknight", "quick", "under 30 min", "under 30 minutes", "30 min",
              "meal prep", "one-pot", "sheet pan", "healthy", "low-carb", "keto",
              "grilling", "baking", "slow cook", "instant pot", "air fryer", "stir-fry",
            ]);
            const displayTags = isDrinks
              ? recipe.tags.filter((t) => !drinkHiddenTags.has(t))
              : recipe.tags;
            return (
              <>
                <div className="flex flex-wrap gap-3 mt-2 text-sm text-stone-500 dark:text-stone-400">
                  {!isDrinks && (recipe.prepTime || recipe.cookTime) && (
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
                  {isDrinks && (
                    <span>{isAlcoholic ? "Alcoholic" : "Non-alcoholic"}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                  {displayTags.map((tag) => (
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
              </>
            );
          })()}
        </div>

        {/* Divider between tags and ingredients/steps */}
        <div className="border-t border-stone-200 dark:border-stone-700" />

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
                  const target = originalServings * mult;
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

            {/* Ingredient sort toggle + clear checked */}
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
              {hasCheckedIngredients && (
                <button
                  onClick={() => {
                    setIngredientResetKey((k) => k + 1);
                    setHasCheckedIngredients(false);
                  }}
                  className="ml-auto px-2.5 py-0.5 rounded-full text-xs font-medium border border-stone-300 text-stone-500 hover:border-orange-500 hover:text-orange-600 dark:border-stone-600 dark:text-stone-400 dark:hover:border-orange-500 dark:hover:text-orange-400 transition-colors"
                >
                  Clear checked
                </button>
              )}
            </div>

            {ingredients.length > 0 ? (
              <GroupedIngredients ingredients={ingredients} sort={ingredientSort} resetKey={ingredientResetKey} showGrams={showGrams} onCheckedChange={setHasCheckedIngredients} />
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
                <div className="flex items-center gap-2 mb-3">
                  {recipe.steps.length >= 3 && (
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
                  )}
                  {completedSteps.size > 0 && (
                    <span className="text-xs text-stone-400 dark:text-stone-500">
                      {completedSteps.size}/{recipe.steps.length}
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      if (wakeLock.isActive) {
                        await wakeLock.release();
                      } else {
                        await wakeLock.request();
                      }
                    }}
                    className={classNames(
                      "ml-auto flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                      wakeLock.isActive
                        ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                        : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                    )}
                  >
                    <Sun className="w-3.5 h-3.5" />
                    {wakeLock.isActive ? "Screen On" : "Keep Screen On"}
                  </button>
                </div>

                <StepsList steps={recipe.steps} recipeId={recipe.id} onStartTimer={onStartTimer} completedSteps={completedSteps} onToggleStep={(i) => setCompletedSteps((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; })} />
              </>
            ) : (
              <p className="text-sm text-stone-400 dark:text-stone-500 py-4 text-center">
                No steps listed
              </p>
            )}
          </section>
        )}

        {/* Notes */}
        <section className="border-t border-stone-200 dark:border-stone-700 pt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              Notes
            </h2>
            <button
              onClick={() => {
                setShowNoteInput(!showNoteInput);
                if (!showNoteInput) setTimeout(() => noteInputRef.current?.focus(), 50);
              }}
              className="p-1 text-stone-400 hover:text-orange-500 dark:text-stone-500 dark:hover:text-orange-400 transition-colors"
            >
              <PencilSquare className="w-4 h-4" />
            </button>
          </div>
          {recipe.notes && (
            <p className="text-sm text-stone-600 dark:text-stone-300 whitespace-pre-wrap mb-2">
              {decodeEntities(recipe.notes)}
            </p>
          )}
          {showNoteInput && (
            <div className="space-y-2">
              <textarea
                ref={noteInputRef}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note..."
                rows={2}
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setShowNoteInput(false); setNoteText(""); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleAddNote} disabled={!noteText.trim()}>
                  Save
                </Button>
              </div>
            </div>
          )}
          {!recipe.notes && !showNoteInput && (
            <p className="text-sm text-stone-400 dark:text-stone-500">
              No notes yet
            </p>
          )}
        </section>

        {/* Log & Planning — two columns on desktop */}
        <section className="border-t border-stone-200 dark:border-stone-700 pt-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Log & Planning */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Log & Planning
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowMadeDate(!showMadeDate)}
                  className={classNames(
                    "flex-1 flex items-center justify-center gap-2 rounded-(--wk-radius-btn) border px-4 py-2.5 text-sm font-medium transition-colors",
                    justCooked
                      ? "border-orange-500 bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400"
                      : showMadeDate
                        ? "border-orange-500 text-orange-600 dark:text-orange-400"
                        : "border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400"
                  )}
                >
                  <Check className="w-4 h-4" />
                  {justCooked ? "Logged!" : "Made This"}
                </button>
                {onAddMeal && (
                  <button
                    onClick={() => setShowPlanDate(!showPlanDate)}
                    className={classNames(
                      "flex-1 flex items-center justify-center gap-2 rounded-(--wk-radius-btn) border px-4 py-2.5 text-sm font-medium transition-colors",
                      justPlanned
                        ? "border-orange-500 bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400"
                        : showPlanDate
                          ? "border-orange-500 text-orange-600 dark:text-orange-400"
                          : "border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400"
                    )}
                  >
                    <CalendarPlus className="w-4 h-4" />
                    {justPlanned ? "Planned!" : "Plan This"}
                  </button>
                )}
              </div>
              {showMadeDate && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="date"
                    value={madeDate}
                    onChange={(e) => setMadeDate(e.target.value)}
                    className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (recipe && !justCooked) {
                        const d = new Date(madeDate + "T12:00:00");
                        markCooked(recipe.id);
                        setRecipe((r) => r ? { ...r, cookedCount: (r.cookedCount ?? 0) + 1, lastCookedAt: d.toISOString() } : r);
                        updateRecipe(recipe.id, { lastCookedAt: d.toISOString() });
                        setJustCooked(true);
                        setShowMadeDate(false);
                        setTimeout(() => setJustCooked(false), 2000);
                      }
                    }}
                  >
                    Log
                  </Button>
                </div>
              )}
              {showPlanDate && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="date"
                    value={planDate}
                    onChange={(e) => setPlanDate(e.target.value)}
                    className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  <select
                    value={planSlot}
                    onChange={(e) => setPlanSlot(e.target.value as MealSlot)}
                    className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  >
                    <option value="breakfast">Breakfast</option>
                    <option value="lunch">Lunch</option>
                    <option value="dinner">Dinner</option>
                    <option value="snack">Snack</option>
                  </select>
                  <Button size="sm" onClick={() => handlePlanThis(planDate, planSlot)}>
                    Add
                  </Button>
                </div>
              )}
              {(recipe.cookedCount || recipe.lastCookedAt) && (
                <div className="flex items-center justify-center gap-2 text-xs text-stone-400 dark:text-stone-500">
                  {recipe.cookedCount ? (
                    <span className="inline-flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          const newCount = Math.max(0, (recipe.cookedCount ?? 0) - 1);
                          updateRecipe(recipe.id, {
                            cookedCount: newCount,
                            ...(newCount === 0 ? { lastCookedAt: undefined } : {}),
                          });
                          setRecipe((r) => r ? {
                            ...r,
                            cookedCount: newCount,
                            ...(newCount === 0 ? { lastCookedAt: undefined } : {}),
                          } : r);
                        }}
                        className="w-5 h-5 rounded-full border border-stone-300 dark:border-stone-600 flex items-center justify-center hover:border-orange-500 hover:text-orange-500 transition-colors"
                        title="Decrease cooked count"
                      >
                        -
                      </button>
                      <span>Cooked {recipe.cookedCount} time{recipe.cookedCount !== 1 ? "s" : ""}</span>
                      <button
                        onClick={() => {
                          const newCount = (recipe.cookedCount ?? 0) + 1;
                          updateRecipe(recipe.id, { cookedCount: newCount, lastCookedAt: new Date().toISOString() });
                          setRecipe((r) => r ? { ...r, cookedCount: newCount, lastCookedAt: new Date().toISOString() } : r);
                        }}
                        className="w-5 h-5 rounded-full border border-stone-300 dark:border-stone-600 flex items-center justify-center hover:border-orange-500 hover:text-orange-500 transition-colors"
                        title="Increase cooked count"
                      >
                        +
                      </button>
                    </span>
                  ) : null}
                  {recipe.cookedCount && recipe.lastCookedAt ? " · " : ""}
                  {recipe.lastCookedAt ? `Last ${new Date(recipe.lastCookedAt).toLocaleDateString()}` : ""}
                </div>
              )}
            </div>

            {/* Shopping */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Shopping List
              </h3>
              <div className="flex gap-2">
                <Button
                  fullWidth
                  onClick={() => handleAddToList(true)}
                >
                  Add Essentials
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => handleAddToList(false)}
                >
                  Add All
                </Button>
              </div>
              <p className="text-[11px] text-stone-400 dark:text-stone-500">
                Essentials skips salt, pepper, oil & common pantry staples
              </p>
            </div>
          </div>
        </section>

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
