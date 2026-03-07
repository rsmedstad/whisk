import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { classNames, formatTotalTime, normalizeSearch } from "../../lib/utils";
import { api } from "../../lib/api";
import { getLocal, setLocal } from "../../lib/cache";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { GroupedIngredients, StepsList } from "../recipes/RecipeComponents";
import { TagChip } from "../ui/TagChip";
import {
  ChevronLeft,
  RefreshCw,
  Plus,
  Clock,
  Users,
  WhiskLogo,
  Share,
  Check,
  PlayCircle,
  Sparkles,
  ArrowUpDown,
  XMark,
  ChevronDown,
  Sun,
} from "../ui/Icon";
import { useWakeLock } from "../../hooks/useWakeLock";
import type {
  Recipe,
  Ingredient,
  Step,
  DiscoverFeed,
  DiscoverFeedItem,
  DiscoverSource,
  DiscoverCategory,
} from "../../types";

// ── Props ───────────────────────────────────────────────

interface DiscoverProps {
  onSaveRecipe?: (
    recipe: Omit<Recipe, "id" | "createdAt" | "updatedAt">
  ) => Promise<Recipe>;
}

// ── Constants ───────────────────────────────────────────

const SOURCE_LABELS: Record<DiscoverSource, string> = {
  nyt: "NYT Cooking",
  allrecipes: "AllRecipes",
  seriouseats: "Serious Eats",
};

const CATEGORY_LABELS: Record<DiscoverCategory, string> = {
  dinner: "Dinner",
  breakfast: "Breakfast",
  "side dish": "Side Dishes",
  salad: "Salads",
  soups: "Soups & Stews",
  dessert: "Desserts",
  appetizer: "Appetizers",
  drinks: "Drinks",
  snack: "Snacks",
  baking: "Baking",
};

/** Display order for categories */
const CATEGORY_ORDER: DiscoverCategory[] = [
  "dinner",
  "soups",
  "salad",
  "side dish",
  "appetizer",
  "breakfast",
  "baking",
  "dessert",
  "drinks",
  "snack",
];

const FEED_CACHE_KEY = "discover_feed";

/** Items added within the last 7 days are considered "new" */
const NEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

type DiscoverSort = "category" | "recent" | "alpha";

function isNewItem(item: DiscoverFeedItem): boolean {
  if (!item.addedAt) return false;
  return Date.now() - new Date(item.addedAt).getTime() < NEW_THRESHOLD_MS;
}

const SOURCE_FILTER_LABELS: Record<DiscoverSource, string> = {
  nyt: "NYT",
  allrecipes: "AllRecipes",
  seriouseats: "Serious Eats",
};

/** Proxy external recipe images through our backend to avoid hotlinking blocks */
function proxyImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Don't proxy our own R2 images
  if (url.startsWith("/photos/") || url.includes("whisk")) return url;
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Image component that tries loading directly first (with no-referrer to avoid
 * hotlink blocks), then falls back to our image proxy if direct loading fails.
 * Recipe site CDNs typically serve images without hotlink protection — the
 * protection is on HTML pages, not image assets.
 */
function FeedImage({ src, alt, className, loading }: {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [useFallback, setUseFallback] = useState(false);
  const isExternal = src.startsWith("http");

  // Direct URL with no-referrer, or proxy URL as fallback
  const displayUrl = !isExternal
    ? src
    : useFallback
      ? proxyImageUrl(src) ?? src
      : src;

  return (
    <img
      src={displayUrl}
      alt={alt}
      className={className}
      loading={loading}
      referrerPolicy={isExternal && !useFallback ? "no-referrer" : undefined}
      onError={() => {
        if (isExternal && !useFallback) {
          setUseFallback(true);
        }
      }}
    />
  );
}

interface ImportedRecipe {
  title: string;
  description?: string;
  ingredients: Ingredient[];
  steps: Step[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  thumbnailUrl?: string;
  photos: { url: string; isPrimary: boolean }[];
  videoUrl?: string;
  source?: {
    type: string;
    url?: string;
    domain?: string;
    attribution?: string;
  };
  tags?: string[];
}

// ── Helpers ─────────────────────────────────────────────

function getYouTubeEmbedUrl(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/
  );
  return match?.[1] ? `https://www.youtube.com/embed/${match[1]}` : null;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// ── Component ───────────────────────────────────────────

export function Discover({
  onSaveRecipe,
}: DiscoverProps) {
  const navigate = useNavigate();

  // ── Filter/sort state ──
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DiscoverSort>("category");
  const [newOnly, setNewOnly] = useState(false);
  const [selectedSource, setSelectedSource] = useState<DiscoverSource | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<DiscoverCategory | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; right?: number } | null>(null);

  // ── Feed state ──
  const [feed, setFeed] = useState<DiscoverFeed | null>(() =>
    getLocal<DiscoverFeed>(FEED_CACHE_KEY)
  );
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  // ── Feed detail state ──
  const [selectedFeedItem, setSelectedFeedItem] = useState<
    (DiscoverFeedItem & { source: DiscoverSource }) | null
  >(null);
  const [importedRecipe, setImportedRecipe] = useState<ImportedRecipe | null>(
    null
  );
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isSavingFeed, setIsSavingFeed] = useState(false);
  const [savedFeedRecipeId, setSavedFeedRecipeId] = useState<string | null>(
    null
  );
  const [photoIndex, setPhotoIndex] = useState(0);
  const galleryRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<"ingredients" | "steps">("ingredients");
  const [ingredientSort, setIngredientSort] = useState<"recipe" | "category">(
    () => (localStorage.getItem("whisk_ingredient_sort") as "recipe" | "category") ?? "recipe"
  );
  const [ingredientResetKey, setIngredientResetKey] = useState(0);
  const [hasCheckedIngredients, setHasCheckedIngredients] = useState(false);
  const [isGroupingSteps, setIsGroupingSteps] = useState(false);
  const [groupedSteps, setGroupedSteps] = useState<Step[] | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const wakeLock = useWakeLock();

  // ── Feed loading ──

  const refreshFeed = useCallback(async (force = false) => {
    setFeedLoading(true);
    setFeedError(null);
    try {
      const url = force ? "/discover/feed?force=true" : "/discover/feed";
      const data = await api.post<DiscoverFeed>(url, {});
      if (data) {
        setFeed(data);
        setLocal(FEED_CACHE_KEY, data);
      }
    } catch {
      setFeedError("Could not refresh. Try again later.");
    } finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => {
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

    async function init() {
      // If we have cached data, show it immediately
      if (feed?.lastRefreshed) {
        // Auto-refresh in background if feed is stale (>2 days old)
        const age = Date.now() - new Date(feed.lastRefreshed).getTime();
        if (age > TWO_DAYS_MS) {
          refreshFeed(); // Background refresh — cached data shows meanwhile
        }
        return;
      }

      // No cache — fetch from KV
      try {
        const data = await api.get<DiscoverFeed>("/discover/feed");
        if (data?.lastRefreshed) {
          setFeed(data);
          setLocal(FEED_CACHE_KEY, data);
          // Check staleness of server-side data too
          const age = Date.now() - new Date(data.lastRefreshed).getTime();
          if (age > TWO_DAYS_MS) {
            refreshFeed();
          }
        }
        // First visit with no feed — auto-scrape
        else {
          refreshFeed();
        }
      } catch {
        // Offline, cached data (if any) is fine
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Feed item click → import recipe ──

  const handleFeedItemClick = useCallback(
    async (item: DiscoverFeedItem) => {
      const source = item.source ?? "nyt";
      setSelectedFeedItem({ ...item, source });
      setImportedRecipe(null);
      setImportError(null);
      setSavedFeedRecipeId(null);
      setPhotoIndex(0);
      setActiveTab("ingredients");
      setGroupedSteps(null);
      setCompletedSteps(new Set());
      setHasCheckedIngredients(false);
      setIngredientResetKey((k) => k + 1);
      setIsImporting(true);

      try {
        const data = await api.post<ImportedRecipe>("/import/url", {
          url: item.url,
        });
        if (data?.title) {
          setImportedRecipe(data);
          // Update the feed cache with the imported image when:
          // - the feed item had no image, or
          // - the imported image is different (feed image may be wrong/low-quality)
          const importedImage = data.thumbnailUrl ?? data.photos?.[0]?.url;
          if (importedImage && importedImage !== item.imageUrl) {
            setFeed((prev) => {
              if (!prev) return prev;
              const updated = { ...prev, categories: { ...prev.categories } };
              for (const cat of Object.keys(updated.categories) as DiscoverCategory[]) {
                const items = updated.categories[cat];
                if (!items) continue;
                const idx = items.findIndex((i) => i.url === item.url);
                if (idx !== -1) {
                  updated.categories[cat] = items.map((i, j) =>
                    j === idx ? { ...i, imageUrl: importedImage } : i
                  );
                  break;
                }
              }
              setLocal(FEED_CACHE_KEY, updated);
              return updated;
            });
          }
        } else {
          setImportError("Could not parse recipe from this page.");
        }
      } catch {
        setImportError(
          "Could not load recipe. The site may be blocking access."
        );
      } finally {
        setIsImporting(false);
      }
    },
    []
  );

  const handleSaveFeedRecipe = useCallback(async () => {
    if (!importedRecipe || !onSaveRecipe) return;
    setIsSavingFeed(true);
    try {
      const recipe = await onSaveRecipe({
        title: importedRecipe.title,
        description: importedRecipe.description,
        ingredients: importedRecipe.ingredients,
        steps: importedRecipe.steps,
        favorite: false,
        photos: importedRecipe.photos ?? [],
        thumbnailUrl: importedRecipe.thumbnailUrl,
        videoUrl: importedRecipe.videoUrl,
        tags: importedRecipe.tags ?? [],
        prepTime: importedRecipe.prepTime,
        cookTime: importedRecipe.cookTime,
        servings: importedRecipe.servings,
        source: importedRecipe.source as Recipe["source"],
      });
      setSavedFeedRecipeId(recipe.id);
    } catch {
      // Save failed — button stays enabled
    } finally {
      setIsSavingFeed(false);
    }
  }, [importedRecipe, onSaveRecipe]);

  const handleFeedBack = () => {
    setSelectedFeedItem(null);
    setImportedRecipe(null);
    setImportError(null);
    setSavedFeedRecipeId(null);
    setPhotoIndex(0);
    setGroupedSteps(null);
    if (wakeLock.isActive) wakeLock.release();
  };

  // ── Share handler for discover recipes ──
  const handleShareFeed = useCallback(async () => {
    if (!selectedFeedItem) return;
    const shareData: ShareData = {
      title: selectedFeedItem.title,
      url: selectedFeedItem.url,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(`${selectedFeedItem.title}\n${selectedFeedItem.url}`);
    }
  }, [selectedFeedItem]);

  // ── Feed item detail view ──

  // Deduplicate photos — match RecipeDetail logic
  const detailPhotos = useMemo(() => {
    if (!importedRecipe) return [];
    const allPhotos: { url: string; isPrimary: boolean }[] = [];
    // Add thumbnailUrl as first photo if present
    if (importedRecipe.thumbnailUrl) {
      allPhotos.push({ url: importedRecipe.thumbnailUrl, isPrimary: true });
    }
    // Add photos array
    if (importedRecipe.photos?.length) {
      for (const p of importedRecipe.photos) {
        allPhotos.push(p);
      }
    }
    // Deduplicate by URL
    const seen = new Set<string>();
    const deduped = allPhotos.filter((p) => {
      // Normalize: strip trailing slashes, query params for comparison
      const key = p.url.split("?")[0]?.replace(/\/$/, "") ?? p.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return deduped;
  }, [importedRecipe]);

  // ── Flatten, filter, and sort all feed items ──

  const allItems = useMemo(() => {
    if (!feed?.categories) return [];
    const items: (DiscoverFeedItem & { source: DiscoverSource; category: DiscoverCategory })[] = [];
    for (const [cat, catItems] of Object.entries(feed.categories)) {
      if (!catItems) continue;
      for (const item of catItems) {
        items.push({
          ...item,
          source: item.source ?? "nyt",
          category: (item.category ?? cat) as DiscoverCategory,
        });
      }
    }
    // Deduplicate by URL
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }, [feed]);

  const filteredItems = useMemo(() => {
    let items = allItems;

    // Search filter
    if (search) {
      const q = normalizeSearch(search);
      items = items.filter((i) => normalizeSearch(i.title).includes(q));
    }

    // New only
    if (newOnly) {
      items = items.filter(isNewItem);
    }

    // Source filter
    if (selectedSource) {
      items = items.filter((i) => i.source === selectedSource);
    }

    // Category filter
    if (selectedCategory) {
      items = items.filter((i) => i.category === selectedCategory);
    }

    // Sort
    if (sort === "alpha") {
      items = [...items].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === "recent") {
      items = [...items].sort((a, b) => {
        const aTime = a.addedAt ? new Date(a.addedAt).getTime() : 0;
        const bTime = b.addedAt ? new Date(b.addedAt).getTime() : 0;
        return bTime - aTime;
      });
    }

    return items;
  }, [allItems, search, newOnly, selectedSource, selectedCategory, sort]);

  // Count new items for the badge
  const newCount = useMemo(() => allItems.filter(isNewItem).length, [allItems]);

  // Check if any filters are active (to switch from carousel to grid)
  const hasActiveFilters = search || newOnly || selectedSource !== null || selectedCategory !== null;

  // Group filtered items by category for carousel view
  const groupedItems = useMemo(() => {
    if (hasActiveFilters || sort !== "category") return null;
    return CATEGORY_ORDER
      .map((cat) => ({
        category: cat,
        items: filteredItems.filter((i) => i.category === cat),
      }))
      .filter((g) => g.items.length > 0);
  }, [filteredItems, hasActiveFilters, sort]);

  // Available categories and sources for filter dropdowns (must be before early return)
  const availableCategories = useMemo(() =>
    CATEGORY_ORDER.filter((cat) => allItems.some((i) => i.category === cat)),
    [allItems]
  );
  const availableSources = useMemo(() => {
    const sources = new Set(allItems.map((i) => i.source));
    return (["nyt", "allrecipes", "seriouseats"] as DiscoverSource[]).filter((s) => sources.has(s));
  }, [allItems]);

  if (selectedFeedItem) {
    const hasVideo = !!importedRecipe?.videoUrl;
    const embedUrl = importedRecipe?.videoUrl
      ? getYouTubeEmbedUrl(importedRecipe.videoUrl)
      : null;
    const totalSlides = detailPhotos.length + (hasVideo ? 1 : 0);
    const isVideoSlide = hasVideo && photoIndex === detailPhotos.length;
    const scrollToSlide = (idx: number) => {
      const el = galleryRef.current;
      if (!el) return;
      el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
    };
    // Fallback image from the feed item itself (before import loads)
    const hasFeedImage = !!selectedFeedItem.imageUrl;

    return (
      <div className="flex flex-col h-full">
        {/* Header — matches RecipeDetail style */}
        <div className="sticky top-0 z-30 flex items-center justify-between bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 py-3 pt-[calc(var(--sat)+0.75rem)]">
          <button
            onClick={handleFeedBack}
            className="flex items-center gap-1 text-stone-600 dark:text-stone-400 font-medium text-sm"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex items-center gap-0.5">
            <button onClick={handleShareFeed} className="p-2">
              <Share className="w-5 h-5 text-stone-500 dark:text-stone-400" />
            </button>
            {onSaveRecipe && importedRecipe && !savedFeedRecipeId && (
              <button
                onClick={handleSaveFeedRecipe}
                disabled={isSavingFeed}
                className="p-2 text-orange-500 dark:text-orange-400"
                title="Add to My Recipes"
              >
                <Plus className="w-5 h-5" />
              </button>
            )}
            {savedFeedRecipeId && (
              <button
                onClick={() => navigate(`/recipes/${savedFeedRecipeId}`)}
                className="p-2 text-green-500 dark:text-green-400"
                title="View saved recipe"
              >
                <Check className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-24">
          {/* Hero gallery — scroll-snap carousel matching RecipeDetail */}
          {(totalSlides > 0 || hasFeedImage) && (
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
                {totalSlides > 0 ? (
                  <>
                    {detailPhotos.map((photo, i) => (
                      <div
                        key={i}
                        className="aspect-video w-full shrink-0 snap-center bg-stone-100 dark:bg-stone-800"
                      >
                        <FeedImage
                          src={photo.url}
                          alt={`${selectedFeedItem.title} photo ${i + 1}`}
                          className="h-full w-full object-cover"
                          loading={i === 0 ? "eager" : "lazy"}
                        />
                      </div>
                    ))}
                    {hasVideo && (
                      <div className="aspect-video w-full shrink-0 snap-center bg-stone-900 flex flex-col items-center justify-center">
                        {embedUrl ? (
                          <iframe
                            src={embedUrl}
                            className="w-full h-full"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            title="Recipe video"
                          />
                        ) : (
                          <a
                            href={importedRecipe!.videoUrl!}
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
                  </>
                ) : (
                  /* Pre-import: show feed item image */
                  <div className="aspect-video w-full shrink-0 snap-center bg-stone-100 dark:bg-stone-800">
                    {hasFeedImage ? (
                      <FeedImage
                        src={selectedFeedItem.imageUrl!}
                        alt={selectedFeedItem.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <span className="text-4xl text-stone-300 dark:text-stone-600">
                          {SOURCE_LABELS[selectedFeedItem.source]}
                        </span>
                      </div>
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
              {/* Dot indicators */}
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
              {/* Slide counter */}
              {totalSlides > 1 && !isVideoSlide && (
                <div className="absolute top-3 right-3 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white pointer-events-none">
                  {photoIndex + 1}/{totalSlides}
                </div>
              )}
              {/* Video shortcut button */}
              {hasVideo && !isVideoSlide && (
                <button
                  onClick={() => scrollToSlide(detailPhotos.length)}
                  className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white flex items-center gap-1"
                >
                  <PlayCircle className="w-4 h-4" /> Video &rarr;
                </button>
              )}
            </div>
          )}

          {/* No image placeholder when no feed image and recipe not loaded */}
          {totalSlides === 0 && !hasFeedImage && (
            <div className="aspect-video w-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
              <span className="text-4xl text-stone-300 dark:text-stone-600">
                {SOURCE_LABELS[selectedFeedItem.source]}
              </span>
            </div>
          )}

          {/* Loading state */}
          {isImporting && <LoadingSpinner className="py-12" size="lg" />}

          {/* Error state */}
          {importError && (
            <div className="px-4 py-4">
              <Card>
                <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-4">
                  {importError}
                </p>
                <div className="flex justify-center pb-3">
                  <a
                    href={selectedFeedItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-orange-500 hover:text-orange-600"
                  >
                    View on {SOURCE_LABELS[selectedFeedItem.source]}
                  </a>
                </div>
              </Card>
            </div>
          )}

          {/* Recipe content — styled like RecipeDetail */}
          {importedRecipe && (
            <div className="px-4 py-4 space-y-6">
              {/* Title & meta */}
              <div>
                <h1 className="text-2xl font-bold dark:text-stone-100">
                  {importedRecipe.title ?? selectedFeedItem.title}
                </h1>
                {importedRecipe.description && (
                  <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                    {importedRecipe.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 mt-2 text-sm text-stone-500 dark:text-stone-400">
                  {(importedRecipe.prepTime || importedRecipe.cookTime) && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {formatTotalTime(importedRecipe.prepTime, importedRecipe.cookTime)}
                    </span>
                  )}
                  {importedRecipe.servings && (
                    <span className="flex items-center gap-1">
                      <Users className="w-4 h-4" /> {importedRecipe.servings} servings
                    </span>
                  )}
                </div>
                {importedRecipe.tags && importedRecipe.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {importedRecipe.tags.map((tag) => (
                      <TagChip
                        key={tag}
                        label={tag.charAt(0).toUpperCase() + tag.slice(1)}
                        size="sm"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Tab bar — matches RecipeDetail */}
              <div className="border-t border-stone-200 dark:border-stone-700" />
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
                  Ingredients{importedRecipe.ingredients.length > 0 ? ` (${importedRecipe.ingredients.length})` : ""}
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
                  Steps{importedRecipe.steps.length > 0 ? ` (${importedRecipe.steps.length})` : ""}
                  {activeTab === "steps" && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
                  )}
                </button>
              </div>

              {/* Ingredients tab */}
              {activeTab === "ingredients" && (
                <section>
                  {importedRecipe.ingredients.length > 0 ? (
                    <>
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
                      <GroupedIngredients
                        ingredients={importedRecipe.ingredients}
                        sort={ingredientSort}
                        resetKey={ingredientResetKey}
                        showGrams={false}
                        onCheckedChange={setHasCheckedIngredients}
                      />
                    </>
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
                  {importedRecipe.steps.length > 0 ? (
                    <>
                      <div className="flex items-center gap-2 mb-3">
                        {importedRecipe.steps.length >= 3 && (
                          <button
                            onClick={async () => {
                              const steps = groupedSteps ?? importedRecipe.steps;
                              const hasGroups = steps.some((s) => s.group);
                              if (hasGroups) {
                                setGroupedSteps(importedRecipe.steps.map((s) => ({ ...s, group: undefined })));
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
                                    title: importedRecipe.title,
                                    steps: importedRecipe.steps.map((s) => s.text),
                                  }),
                                });
                                if (!res.ok) throw new Error("Failed");
                                const data = (await res.json()) as { groups: string[] };
                                if (data.groups.length === importedRecipe.steps.length) {
                                  setGroupedSteps(importedRecipe.steps.map((s, i) => ({ ...s, group: data.groups[i] })));
                                }
                              } catch {
                                // Silent fail
                              } finally {
                                setIsGroupingSteps(false);
                              }
                            }}
                            disabled={isGroupingSteps}
                            className={classNames(
                              "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                              (groupedSteps ?? importedRecipe.steps).some((s) => s.group)
                                ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                                : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                            )}
                          >
                            {isGroupingSteps ? "Grouping..." : (groupedSteps ?? importedRecipe.steps).some((s) => s.group) ? "Grouped by Section" : "Group Sections"}
                          </button>
                        )}
                        {completedSteps.size > 0 && (
                          <span className="text-xs text-stone-400 dark:text-stone-500">
                            {completedSteps.size}/{importedRecipe.steps.length}
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
                      <StepsList steps={groupedSteps ?? importedRecipe.steps} completedSteps={completedSteps} onToggleStep={(i) => setCompletedSteps((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; })} />
                    </>
                  ) : (
                    <p className="text-sm text-stone-400 dark:text-stone-500 py-4 text-center">
                      No steps listed
                    </p>
                  )}
                </section>
              )}

              {/* Add to Recipes CTA */}
              {onSaveRecipe && !savedFeedRecipeId && (
                <div className="border-t border-stone-200 dark:border-stone-700 pt-4">
                  <Button
                    fullWidth
                    onClick={handleSaveFeedRecipe}
                    disabled={isSavingFeed}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <Plus className="w-5 h-5" /> Add to My Recipes
                    </span>
                  </Button>
                </div>
              )}
              {savedFeedRecipeId && (
                <div className="border-t border-stone-200 dark:border-stone-700 pt-4">
                  <Button
                    fullWidth
                    variant="secondary"
                    onClick={() => navigate(`/recipes/${savedFeedRecipeId}`)}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <Check className="w-5 h-5" /> View Saved Recipe
                    </span>
                  </Button>
                </div>
              )}

              {/* Source link + added date */}
              <div className="border-t border-stone-200 dark:border-stone-700 pt-4 text-sm text-stone-400 dark:text-stone-500 space-y-1">
                <div>
                  Source:{" "}
                  <a
                    href={selectedFeedItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-500 hover:underline"
                  >
                    {SOURCE_LABELS[selectedFeedItem.source]}
                  </a>
                </div>
                {selectedFeedItem.addedAt && (
                  <div>
                    Added {new Date(selectedFeedItem.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main view ──

  const hasFeedContent =
    feed?.lastRefreshed &&
    feed.categories &&
    Object.values(feed.categories).some((items) => items && items.length > 0);

  const openDropdownAt = (key: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (openDropdown === key) {
      setOpenDropdown(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const minW = 140;
      const overflow = rect.left + minW > window.innerWidth;
      if (overflow) {
        setDropdownPos({ top: rect.bottom + 4, left: 0, right: Math.max(8, window.innerWidth - rect.right) });
      } else {
        setDropdownPos({ top: rect.bottom + 4, left: rect.left });
      }
      setOpenDropdown(key);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
        <div className="flex items-center justify-between py-3">
          <button
            onClick={() => navigate("/settings")}
            title="Settings"
            className="flex items-center gap-1.5"
          >
            <WhiskLogo className="w-5 h-5 text-orange-500" />
            <span className="text-lg font-bold text-orange-500">W</span>
            <span className="text-stone-400 dark:text-stone-500">|</span>
            <h1 className="text-lg font-bold dark:text-stone-100">Discover</h1>
          </button>
          <button
            onClick={() => refreshFeed(true)}
            disabled={feedLoading}
            className="p-2 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 transition-colors"
            title="Refresh trending recipes"
          >
            <RefreshCw
              className={classNames(
                "w-4.5 h-4.5",
                feedLoading && "animate-spin"
              )}
            />
          </button>
        </div>

        {/* Search + filter bar — only show when we have content */}
        {hasFeedContent && (
          <>
            {/* Search */}
            <div className="pb-2">
              <div className="relative">
                <input
                  type="search"
                  enterKeyHint="search"
                  placeholder="Search discover recipes..."
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

            {/* Filter bar */}
            <div className="flex items-center gap-2 pb-2 overflow-x-auto no-scrollbar">
              {/* New toggle */}
              <button
                onClick={() => { setNewOnly(!newOnly); setOpenDropdown(null); }}
                className={classNames(
                  "shrink-0 p-1.5 rounded-full transition-colors relative",
                  newOnly
                    ? "text-orange-500 bg-orange-50 dark:bg-orange-950/50"
                    : "text-stone-400 hover:text-orange-400 dark:text-stone-500 dark:hover:text-orange-400"
                )}
                title={newOnly ? "Show all recipes" : "Show new only"}
              >
                <Sparkles className="w-5 h-5" />
                {newCount > 0 && !newOnly && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 flex items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white px-1">
                    {newCount}
                  </span>
                )}
              </button>

              {/* Sort */}
              <button
                onClick={(e) => openDropdownAt("sort", e)}
                className="shrink-0 p-1.5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 transition-colors"
                title={`Sort: ${({ category: "Category", recent: "Recent", alpha: "A-Z" } as Record<DiscoverSort, string>)[sort]}`}
              >
                <ArrowUpDown className="w-4.5 h-4.5" />
              </button>

              <span className="text-stone-300 dark:text-stone-600 text-sm select-none">|</span>

              {/* Source filter */}
              {availableSources.length > 1 && (
                <button
                  onClick={(e) => openDropdownAt("source", e)}
                  className={classNames(
                    "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors shrink-0",
                    selectedSource
                      ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : openDropdown === "source"
                        ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                        : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                  )}
                >
                  {selectedSource ? SOURCE_FILTER_LABELS[selectedSource] : "Source"}
                  <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === "source" && "rotate-180")} />
                </button>
              )}

              {/* Category filter */}
              <button
                onClick={(e) => openDropdownAt("category", e)}
                className={classNames(
                  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors shrink-0",
                  selectedCategory
                    ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                    : openDropdown === "category"
                      ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                      : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                )}
              >
                {selectedCategory ? CATEGORY_LABELS[selectedCategory] : "Category"}
                <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === "category" && "rotate-180")} />
              </button>
            </div>

            {/* Dropdown panel — portaled to body */}
            {openDropdown && dropdownPos && createPortal(
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                <div
                  className="fixed z-50 min-w-35 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800 py-1"
                  style={{
                    top: dropdownPos.top,
                    ...(dropdownPos.right != null
                      ? { right: dropdownPos.right }
                      : { left: dropdownPos.left }),
                  }}
                >
                  {openDropdown === "sort" && (
                    [["category", "Category"], ["recent", "Recent"], ["alpha", "A-Z"]] as [DiscoverSort, string][]
                  ).map(([value, label]) => (
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
                  ))}
                  {openDropdown === "source" && availableSources.map((src) => (
                    <button
                      key={src}
                      onClick={() => { setSelectedSource(selectedSource === src ? null : src); setOpenDropdown(null); }}
                      className={classNames(
                        "w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors",
                        selectedSource === src
                          ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                          : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      )}
                    >
                      {SOURCE_FILTER_LABELS[src]}
                      {selectedSource === src && <Check className="w-4 h-4 text-orange-500" />}
                    </button>
                  ))}
                  {openDropdown === "category" && availableCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => { setSelectedCategory(selectedCategory === cat ? null : cat); setOpenDropdown(null); }}
                      className={classNames(
                        "w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors",
                        selectedCategory === cat
                          ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                          : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      )}
                    >
                      {CATEGORY_LABELS[cat]}
                      {selectedCategory === cat && <Check className="w-4 h-4 text-orange-500" />}
                    </button>
                  ))}
                </div>
              </>,
              document.body
            )}

            {/* Active filter chips */}
            {(selectedSource || selectedCategory) && (
              <div className="flex items-center gap-1.5 pb-2">
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {selectedSource && (
                    <button
                      onClick={() => setSelectedSource(null)}
                      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                    >
                      {SOURCE_FILTER_LABELS[selectedSource]}
                      <XMark className="w-3 h-3" />
                    </button>
                  )}
                  {selectedCategory && (
                    <button
                      onClick={() => setSelectedCategory(null)}
                      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300 capitalize"
                    >
                      {CATEGORY_LABELS[selectedCategory]}
                      <XMark className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => { setSelectedSource(null); setSelectedCategory(null); }}
                  className="inline-flex items-center rounded-full border border-stone-300 px-2.5 py-0.5 text-xs font-medium text-stone-500 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-400 dark:hover:bg-stone-800 shrink-0 transition-colors"
                >
                  Clear all
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-24">
        {/* ── Trending Feed ── */}
        {feedLoading && !hasFeedContent && (
          <LoadingSpinner className="py-16" size="lg" />
        )}

        {feedError && !hasFeedContent && (
          <div className="px-4 py-8">
            <Card>
              <div className="text-center py-4 space-y-3">
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  {feedError}
                </p>
                <Button size="sm" onClick={() => refreshFeed(true)} disabled={feedLoading}>
                  Try Again
                </Button>
              </div>
            </Card>
          </div>
        )}

        {!hasFeedContent && !feedLoading && !feedError && (
          <div className="px-4 py-8">
            <Card>
              <div className="text-center py-6 space-y-3">
                <p className="text-base font-semibold dark:text-stone-100">
                  What&apos;s Trending
                </p>
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  See trending recipes from NYT Cooking, AllRecipes, and Serious
                  Eats
                </p>
                <Button onClick={() => refreshFeed(true)} disabled={feedLoading}>
                  <RefreshCw className="w-4 h-4 mr-1.5" />
                  Load Recipes
                </Button>
              </div>
            </Card>
          </div>
        )}

        {hasFeedContent && groupedItems && (
          /* Category carousel view (default, no filters active) */
          <div className="py-4 space-y-6">
            {/* Feed header */}
            <div className="px-4 flex items-center justify-between">
              <h2 className="text-base font-bold dark:text-stone-100">
                Discover Recipes
              </h2>
              {feed?.lastRefreshed && (
                <span className="text-xs text-stone-400 dark:text-stone-500">
                  Updated {timeAgo(feed.lastRefreshed)}
                </span>
              )}
            </div>

            {groupedItems.map(({ category, items }) => {
              const catNewCount = items.filter(isNewItem).length;
              return (
                <div key={category}>
                  <h3 className="px-4 text-sm font-semibold text-stone-600 dark:text-stone-300 mb-2">
                    {CATEGORY_LABELS[category]}
                    <span className="ml-1.5 text-xs font-normal text-stone-400 dark:text-stone-500">
                      {items.length} recipes
                    </span>
                    {catNewCount > 0 && (
                      <span className="ml-1.5 text-[10px] font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 px-1.5 py-0.5 rounded-full">
                        {catNewCount} new
                      </span>
                    )}
                  </h3>
                  <div className="flex gap-3 overflow-x-auto no-scrollbar px-4">
                    {items.map((item, i) => (
                      <FeedCard
                        key={`${category}-${i}`}
                        item={item}
                        category={category}
                        onClick={() => handleFeedItemClick(item)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasFeedContent && !groupedItems && (
          /* Grid view (filters active or non-category sort) */
          <div className="py-4 px-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold dark:text-stone-100">
                {filteredItems.length} recipe{filteredItems.length !== 1 ? "s" : ""}
              </h2>
              {feed?.lastRefreshed && (
                <span className="text-xs text-stone-400 dark:text-stone-500">
                  Updated {timeAgo(feed.lastRefreshed)}
                </span>
              )}
            </div>
            {filteredItems.length === 0 ? (
              <Card>
                <div className="text-center py-6 space-y-2">
                  <p className="text-sm text-stone-500 dark:text-stone-400">
                    No recipes match your filters
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setSearch(""); setNewOnly(false); setSelectedSource(null); setSelectedCategory(null); }}
                  >
                    Clear filters
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {filteredItems.map((item, i) => (
                  <FeedCard
                    key={`grid-${i}`}
                    item={item}
                    category={item.category}
                    onClick={() => handleFeedItemClick(item)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ── Feed card component ──────────────────────────────────

function FeedCard({
  item,
  category,
  onClick,
}: {
  item: DiscoverFeedItem;
  category: DiscoverCategory;
  onClick: () => void;
}) {
  const itemIsNew = isNewItem(item);
  return (
    <button
      onClick={onClick}
      className="shrink-0 w-44 text-left rounded-[var(--wk-radius-card)] border border-stone-200 bg-white shadow-sm overflow-hidden transition-all hover:shadow-md active:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:active:bg-stone-800 dark:hover:border-orange-500/30"
    >
      <div className="relative aspect-3/2 w-full overflow-hidden bg-stone-100 dark:bg-stone-800">
        {item.imageUrl ? (
          <FeedImage
            src={item.imageUrl}
            alt={item.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-stone-300 dark:text-stone-600">
            <span className="text-xs font-medium">
              {CATEGORY_LABELS[category]}
            </span>
          </div>
        )}
        {itemIsNew && (
          <div className="absolute top-1.5 right-1.5 p-1 rounded-full bg-orange-500/90 backdrop-blur-sm">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
        )}
      </div>
      <div className="p-2.5">
        <h4 className="text-xs font-medium line-clamp-2 dark:text-stone-100 leading-snug">
          {item.title}
        </h4>
        {item.source && (
          <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5">
            {SOURCE_LABELS[item.source ?? "nyt"]}
          </p>
        )}
      </div>
    </button>
  );
}

