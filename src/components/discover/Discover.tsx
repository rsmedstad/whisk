import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { classNames } from "../../lib/utils";
import { api } from "../../lib/api";
import { getLocal, setLocal } from "../../lib/cache";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { GroupedIngredients, StepsList } from "../recipes/RecipeComponents";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Plus,
  Clock,
  Users,
  WhiskLogo,
  Share,
  Check,
  PlayCircle,
} from "../ui/Icon";
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
      setIsImporting(true);

      try {
        const data = await api.post<ImportedRecipe>("/import/url", {
          url: item.url,
        });
        if (data?.title) {
          setImportedRecipe(data);
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
                      {importedRecipe.prepTime && importedRecipe.cookTime
                        ? `${importedRecipe.prepTime + importedRecipe.cookTime}m total`
                        : `${importedRecipe.prepTime ?? importedRecipe.cookTime}m`}
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
                      <span
                        key={tag}
                        className="rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-0.5 text-xs text-stone-500 dark:text-stone-400"
                      >
                        {tag.charAt(0).toUpperCase() + tag.slice(1)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-stone-200 dark:border-stone-700" />

              {/* Ingredients — same as RecipeDetail */}
              {importedRecipe.ingredients.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold dark:text-stone-100 mb-3">
                    Ingredients
                  </h2>
                  <GroupedIngredients
                    ingredients={importedRecipe.ingredients}
                    sort="recipe"
                    resetKey={0}
                    showGrams={false}
                  />
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-stone-200 dark:border-stone-700" />

              {/* Steps — same as RecipeDetail */}
              {importedRecipe.steps.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold dark:text-stone-100 mb-3">
                    Steps
                  </h2>
                  <StepsList steps={importedRecipe.steps} />
                </div>
              )}

              {/* Source link */}
              <div className="border-t border-stone-200 dark:border-stone-700 pt-4 text-sm text-stone-400 dark:text-stone-500">
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

        {hasFeedContent && (
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

            {/* Category sections */}
            {CATEGORY_ORDER.map((category) => {
              const items = feed?.categories[category] ?? [];
              if (items.length === 0) return null;
              // Check for new items (added in the last 3 days)
              const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
              const newCount = items.filter(
                (i) => i.addedAt && new Date(i.addedAt).getTime() > threeDaysAgo
              ).length;
              return (
                <div key={category}>
                  <h3 className="px-4 text-sm font-semibold text-stone-600 dark:text-stone-300 mb-2">
                    {CATEGORY_LABELS[category]}
                    <span className="ml-1.5 text-xs font-normal text-stone-400 dark:text-stone-500">
                      {items.length} recipes
                    </span>
                    {newCount > 0 && (
                      <span className="ml-1.5 text-[10px] font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 px-1.5 py-0.5 rounded-full">
                        {newCount} new
                      </span>
                    )}
                  </h3>
                  <div className="flex gap-3 overflow-x-auto no-scrollbar px-4">
                    {items.map((item, i) => (
                      <button
                        key={`${category}-${i}`}
                        onClick={() => handleFeedItemClick(item)}
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
                        </div>
                        <div className="p-2.5">
                          <h4 className="text-xs font-medium line-clamp-2 dark:text-stone-100 leading-snug">
                            {item.title}
                          </h4>
                          {item.source && (
                            <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5">
                              {SOURCE_LABELS[item.source]}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}

