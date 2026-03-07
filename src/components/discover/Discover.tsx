import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getSeasonalContext } from "../../lib/seasonal";
import { classNames } from "../../lib/utils";
import { api } from "../../lib/api";
import { getLocal, setLocal } from "../../lib/cache";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
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
} from "../ui/Icon";
import type {
  InspirationIdea,
  Recipe,
  Ingredient,
  Step,
  DiscoverFeed,
  DiscoverFeedItem,
  DiscoverSource,
} from "../../types";

// ── Props ───────────────────────────────────────────────

interface DiscoverProps {
  chatEnabled?: boolean;
  unsplashEnabled?: boolean;
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

const MEAL_TYPES = [
  { value: "all", label: "All" },
  { value: "dinner", label: "Dinner" },
  { value: "drinks", label: "Drinks" },
  { value: "desserts", label: "Desserts" },
] as const;

const VIBES = [
  { value: "seasonal", label: "Seasonal" },
  { value: "quick", label: "Quick" },
  { value: "trending", label: "Trending" },
  { value: "comfort", label: "Comfort" },
  { value: "healthy", label: "Healthy" },
] as const;

const CACHE_KEY = "discover_ideas";
const FEED_CACHE_KEY = "discover_feed";

interface CachedIdeas {
  ideas: InspirationIdea[];
  mealType: string;
  vibe: string;
  fetchedAt: number;
}

interface GeneratedRecipe {
  title: string;
  description: string;
  ingredients: { name: string; amount?: string; unit?: string }[];
  steps: { text: string }[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  tags: string[];
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
  chatEnabled = false,
  unsplashEnabled = false,
  onSaveRecipe,
}: DiscoverProps) {
  const navigate = useNavigate();
  const seasonal = getSeasonalContext();

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

  // ── Inspiration accordion state ──
  const [inspirationOpen, setInspirationOpen] = useState(false);
  const [mealType, setMealType] = useState("all");
  const [vibe, setVibe] = useState("seasonal");
  const [ideas, setIdeas] = useState<InspirationIdea[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Inspiration detail state ──
  const [selectedIdea, setSelectedIdea] = useState<InspirationIdea | null>(
    null
  );
  const [generatedRecipe, setGeneratedRecipe] =
    useState<GeneratedRecipe | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);

  // ── Feed loading ──

  const refreshFeed = useCallback(async () => {
    setFeedLoading(true);
    setFeedError(null);
    try {
      const data = await api.post<DiscoverFeed>("/discover/feed", {});
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
    async function init() {
      // If we have a cache hit, show it immediately
      if (feed?.lastRefreshed) return;

      // No cache — fetch from KV
      try {
        const data = await api.get<DiscoverFeed>("/discover/feed");
        if (data?.lastRefreshed) {
          setFeed(data);
          setLocal(FEED_CACHE_KEY, data);
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
    async (item: DiscoverFeedItem, source: DiscoverSource) => {
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

  // ── Inspiration loading (existing logic) ──

  const loadIdeas = useCallback(
    async (mt: string, v: string, forceRefresh = false) => {
      if (!forceRefresh) {
        const cached = getLocal<CachedIdeas>(`${CACHE_KEY}:${mt}:${v}`);
        if (cached && cached.ideas.length > 0) {
          const age = Date.now() - cached.fetchedAt;
          if (age < 24 * 60 * 60 * 1000) {
            setIdeas(cached.ideas);
            return;
          }
        }
      }

      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          mealType: mt,
          vibe: v,
          season: seasonal.season,
          ...(forceRefresh ? { refresh: "1" } : {}),
        });
        const data = await api.get<{ ideas: InspirationIdea[] }>(
          `/discover/ideas?${params.toString()}`
        );
        if (data?.ideas) {
          setIdeas(data.ideas);
          setLocal<CachedIdeas>(`${CACHE_KEY}:${mt}:${v}`, {
            ideas: data.ideas,
            mealType: mt,
            vibe: v,
            fetchedAt: Date.now(),
          });
        }
      } catch {
        setError("Could not load ideas. Check your connection.");
      } finally {
        setIsLoading(false);
      }
    },
    [seasonal.season]
  );

  // Load inspiration ideas when accordion opens
  useEffect(() => {
    if (inspirationOpen && ideas.length === 0) {
      loadIdeas(mealType, vibe);
    }
  }, [inspirationOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleIdeaClick = async (idea: InspirationIdea) => {
    setSelectedIdea(idea);
    setGeneratedRecipe(null);
    setGenerateError(null);
    setSavedRecipeId(null);

    if (!chatEnabled) return;

    setIsGenerating(true);
    try {
      const data = await api.post<{ recipe: GeneratedRecipe }>(
        "/discover/recipe",
        { title: idea.title, description: idea.description }
      );
      if (data?.recipe) {
        setGeneratedRecipe(data.recipe);
      }
    } catch {
      setGenerateError("Could not generate recipe details.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveRecipe = async () => {
    if (!generatedRecipe || !onSaveRecipe) return;
    setIsSaving(true);
    try {
      const ingredients: Ingredient[] = generatedRecipe.ingredients.map(
        (ing) => ({
          name: ing.name,
          amount: ing.amount,
          unit: ing.unit,
        })
      );
      const steps: Step[] = generatedRecipe.steps.map((s) => ({
        text: s.text,
      }));
      const recipe = await onSaveRecipe({
        title: generatedRecipe.title,
        description: generatedRecipe.description,
        ingredients,
        steps,
        favorite: false,
        photos: [],
        thumbnailUrl: selectedIdea?.imageUrl,
        tags: generatedRecipe.tags ?? [],
        prepTime: generatedRecipe.prepTime,
        cookTime: generatedRecipe.cookTime,
        servings: generatedRecipe.servings,
        source: { type: "ai" },
      });
      setSavedRecipeId(recipe.id);
    } catch {
      // Saving failed silently — button will stay enabled
    } finally {
      setIsSaving(false);
    }
  };

  const handleBack = () => {
    setSelectedIdea(null);
    setGeneratedRecipe(null);
    setGenerateError(null);
    setSavedRecipeId(null);
  };

  const handleFeedBack = () => {
    setSelectedFeedItem(null);
    setImportedRecipe(null);
    setImportError(null);
    setSavedFeedRecipeId(null);
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

  if (selectedFeedItem) {
    const heroImage =
      importedRecipe?.thumbnailUrl ??
      importedRecipe?.photos?.[0]?.url ??
      selectedFeedItem.imageUrl;
    const embedUrl = importedRecipe?.videoUrl
      ? getYouTubeEmbedUrl(importedRecipe.videoUrl)
      : null;

    // Deduplicate photos: filter out the hero image from the carousel
    const extraPhotos = importedRecipe?.photos
      ? importedRecipe.photos
          .filter((p, i, arr) => arr.findIndex((q) => q.url === p.url) === i)
          .filter((p) => p.url !== heroImage)
      : [];

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
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-24">
          {/* Hero image */}
          {heroImage ? (
            <div className="relative aspect-video w-full overflow-hidden bg-stone-100 dark:bg-stone-800">
              <img
                src={heroImage}
                alt={selectedFeedItem.title}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="aspect-video w-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
              <span className="text-4xl text-stone-300 dark:text-stone-600">
                {SOURCE_LABELS[selectedFeedItem.source]}
              </span>
            </div>
          )}

          {/* Video embed */}
          {embedUrl && (
            <div className="aspect-video w-full">
              <iframe
                src={embedUrl}
                title="Recipe video"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
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

              {/* Additional photos carousel (deduplicated) */}
              {extraPhotos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
                  {extraPhotos.slice(0, 6).map((photo, i) => (
                    <div
                      key={i}
                      className="shrink-0 w-24 h-24 rounded-lg overflow-hidden bg-stone-100 dark:bg-stone-800"
                    >
                      <img
                        src={photo.url}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-stone-200 dark:border-stone-700" />

              {/* Ingredients — checkbox style like RecipeDetail */}
              {importedRecipe.ingredients.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold dark:text-stone-100 mb-3">
                    Ingredients
                  </h2>
                  <ul className="space-y-2">
                    {importedRecipe.ingredients.map((ing, i) => (
                      <DiscoverIngredientRow key={i} ingredient={ing} />
                    ))}
                  </ul>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-stone-200 dark:border-stone-700" />

              {/* Steps — numbered circle style like RecipeDetail */}
              {importedRecipe.steps.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold dark:text-stone-100 mb-3">
                    Steps
                  </h2>
                  <ol className="space-y-4">
                    {importedRecipe.steps.map((step, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="shrink-0 h-6 w-6 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex items-center justify-center dark:bg-orange-900 dark:text-orange-300">
                          {i + 1}
                        </span>
                        <p className="text-sm leading-relaxed dark:text-stone-200 flex-1">
                          {step.text}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-stone-200 dark:border-stone-700" />

              {/* Save button */}
              {onSaveRecipe && (
                <div className="pt-2 pb-4">
                  {savedFeedRecipeId ? (
                    <Button
                      fullWidth
                      variant="secondary"
                      onClick={() => {
                        navigate(`/recipes/${savedFeedRecipeId}`);
                      }}
                    >
                      Saved — View Recipe
                    </Button>
                  ) : (
                    <Button
                      fullWidth
                      onClick={handleSaveFeedRecipe}
                      disabled={isSavingFeed}
                    >
                      <Plus className="w-4 h-4 mr-1.5" />
                      {isSavingFeed ? "Saving..." : "Add to My Recipes"}
                    </Button>
                  )}
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

  // ── Inspiration detail view (existing, unchanged) ──

  if (selectedIdea) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
          <div className="flex items-center gap-3 py-3">
            <button
              onClick={handleBack}
              className="p-1 -ml-1 text-stone-500 dark:text-stone-400"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold dark:text-stone-100 truncate">
              {selectedIdea.title}
            </h1>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-24">
          {/* Hero image */}
          {selectedIdea.imageUrl ? (
            <div className="relative aspect-video w-full overflow-hidden bg-stone-100 dark:bg-stone-800">
              <img
                src={selectedIdea.imageUrl}
                alt={selectedIdea.title}
                className="h-full w-full object-cover"
              />
              {selectedIdea.photographer && (
                <div className="absolute bottom-2 right-2 rounded-full bg-black/40 backdrop-blur-sm px-2.5 py-0.5">
                  <p className="text-[10px] text-white/80">
                    Photo by {selectedIdea.photographer}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="aspect-video w-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
              <span className="text-5xl">
                {(selectedIdea as { emoji?: string }).emoji ?? "\uD83C\uDF7D\uFE0F"}
              </span>
            </div>
          )}

          {/* Description */}
          <div className="px-4 py-4">
            <p className="text-sm text-stone-600 dark:text-stone-400">
              {selectedIdea.description}
            </p>
          </div>

          {/* Recipe content */}
          <div className="px-4 space-y-4">
            {isGenerating && <LoadingSpinner className="py-12" size="lg" />}

            {generateError && (
              <Card>
                <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-4">
                  {generateError}
                </p>
              </Card>
            )}

            {!chatEnabled && !isGenerating && (
              <Card>
                <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-4">
                  Add an AI provider in Settings to generate full recipes
                </p>
              </Card>
            )}

            {generatedRecipe && (
              <>
                {/* Meta bar */}
                <div className="flex items-center gap-4 text-xs text-stone-500 dark:text-stone-400">
                  {generatedRecipe.prepTime && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {generatedRecipe.prepTime}m prep
                    </span>
                  )}
                  {generatedRecipe.cookTime && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {generatedRecipe.cookTime}m cook
                    </span>
                  )}
                  {generatedRecipe.servings && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {generatedRecipe.servings} servings
                    </span>
                  )}
                </div>

                {/* Tags */}
                {generatedRecipe.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {generatedRecipe.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-0.5 text-xs text-stone-500 dark:text-stone-400"
                      >
                        {tag.charAt(0).toUpperCase() + tag.slice(1)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Ingredients */}
                <div>
                  <h2 className="text-sm font-semibold dark:text-stone-100 mb-2">
                    Ingredients
                  </h2>
                  <ul className="space-y-1.5">
                    {generatedRecipe.ingredients.map((ing, i) => (
                      <li
                        key={i}
                        className="text-sm dark:text-stone-300 flex gap-2"
                      >
                        <span className="text-stone-400 dark:text-stone-500 shrink-0">
                          {[ing.amount, ing.unit].filter(Boolean).join(" ") ||
                            "\u2022"}
                        </span>
                        <span>{ing.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Steps */}
                <div>
                  <h2 className="text-sm font-semibold dark:text-stone-100 mb-2">
                    Instructions
                  </h2>
                  <ol className="space-y-3">
                    {generatedRecipe.steps.map((step, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400 flex items-center justify-center text-xs font-medium">
                          {i + 1}
                        </span>
                        <p className="dark:text-stone-300 flex-1">
                          {step.text}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Save button */}
                {onSaveRecipe && (
                  <div className="pt-2 pb-4">
                    {savedRecipeId ? (
                      <Button fullWidth variant="secondary" disabled>
                        Saved to Recipe Book
                      </Button>
                    ) : (
                      <Button
                        fullWidth
                        onClick={handleSaveRecipe}
                        disabled={isSaving}
                      >
                        <Plus className="w-4 h-4 mr-1.5" />
                        {isSaving ? "Saving..." : "Save to Recipe Book"}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main view ──

  const hasFeedContent =
    feed?.lastRefreshed &&
    (feed.sources.nyt.length > 0 ||
      feed.sources.allrecipes.length > 0 ||
      feed.sources.seriouseats.length > 0);

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
            onClick={refreshFeed}
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

        {/* Seasonal context */}
        <p className="text-sm text-stone-500 dark:text-stone-400 pb-3">
          {seasonal.greeting}
          {seasonal.upcomingHolidays.length > 0 && (
            <span className="ml-1.5 text-orange-500 dark:text-orange-400">
              {seasonal.upcomingHolidays
                .slice(0, 2)
                .map((h) => h.name)
                .join(", ")}
              {seasonal.upcomingHolidays[0] &&
                seasonal.upcomingHolidays[0].daysAway > 0 && (
                  <span className="text-stone-400 dark:text-stone-500 ml-1">
                    in {seasonal.upcomingHolidays[0].daysAway}d
                  </span>
                )}
            </span>
          )}
        </p>
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
                <Button size="sm" onClick={refreshFeed} disabled={feedLoading}>
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
                <Button onClick={refreshFeed} disabled={feedLoading}>
                  <RefreshCw className="w-4 h-4 mr-1.5" />
                  Load Trending Recipes
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
                What&apos;s Trending
              </h2>
              {feed?.lastRefreshed && (
                <span className="text-xs text-stone-400 dark:text-stone-500">
                  Updated {timeAgo(feed.lastRefreshed)}
                </span>
              )}
            </div>

            {/* Source sections */}
            {(
              ["nyt", "allrecipes", "seriouseats"] as const
            ).map((source) => {
              const items = feed?.sources[source] ?? [];
              if (items.length === 0) return null;
              return (
                <div key={source}>
                  <h3 className="px-4 text-sm font-semibold text-stone-600 dark:text-stone-300 mb-2">
                    {SOURCE_LABELS[source]}
                    <span className="ml-1.5 text-xs font-normal text-stone-400 dark:text-stone-500">
                      {items.length} recipes
                    </span>
                  </h3>
                  <div className="flex gap-3 overflow-x-auto no-scrollbar px-4">
                    {items.map((item, i) => (
                      <button
                        key={`${source}-${i}`}
                        onClick={() => handleFeedItemClick(item, source)}
                        className="shrink-0 w-44 text-left rounded-[var(--wk-radius-card)] border border-stone-200 bg-white shadow-sm overflow-hidden transition-all hover:shadow-md active:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:active:bg-stone-800 dark:hover:border-orange-500/30"
                      >
                        <div className="relative aspect-3/2 w-full overflow-hidden bg-stone-100 dark:bg-stone-800">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.title}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-stone-300 dark:text-stone-600">
                              <span className="text-xs font-medium">
                                {SOURCE_LABELS[source]}
                              </span>
                            </div>
                          )}
                          <div className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-orange-500 shadow-sm">
                            <Plus className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                          </div>
                        </div>
                        <div className="p-2.5">
                          <h4 className="text-xs font-medium line-clamp-2 dark:text-stone-100 leading-snug">
                            {item.title}
                          </h4>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── AI Inspiration accordion ── */}
        <div className="px-4 pt-2 pb-4">
          <button
            onClick={() => setInspirationOpen(!inspirationOpen)}
            className="w-full flex items-center justify-between py-3 text-left"
          >
            <span className="text-sm font-semibold text-stone-600 dark:text-stone-300">
              AI Inspiration
            </span>
            <ChevronRight
              className={classNames(
                "w-4 h-4 text-stone-400 dark:text-stone-500 transition-transform duration-200",
                inspirationOpen && "rotate-90"
              )}
            />
          </button>

          {inspirationOpen && (
            <div className="space-y-3">
              {/* Meal type + vibe filters */}
              <div className="flex gap-1.5">
                {MEAL_TYPES.map((mt) => (
                  <button
                    key={mt.value}
                    onClick={() => {
                      setMealType(mt.value);
                      loadIdeas(mt.value, vibe);
                    }}
                    className={classNames(
                      "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                      mealType === mt.value
                        ? "bg-orange-500 text-white border-orange-500"
                        : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                    )}
                  >
                    {mt.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                {VIBES.map((v) => (
                  <button
                    key={v.value}
                    onClick={() => {
                      setVibe(v.value);
                      loadIdeas(mealType, v.value);
                    }}
                    className={classNames(
                      "px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors",
                      vibe === v.value
                        ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
                        : "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300"
                    )}
                  >
                    {v.label}
                  </button>
                ))}
                {(mealType !== "all" || vibe !== "seasonal") && (
                  <button
                    onClick={() => {
                      setMealType("all");
                      setVibe("seasonal");
                      loadIdeas("all", "seasonal");
                    }}
                    className="px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap text-stone-400 dark:text-stone-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Ideas grid */}
              {isLoading && ideas.length === 0 ? (
                <LoadingSpinner className="py-8" size="lg" />
              ) : error && ideas.length === 0 ? (
                <Card>
                  <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-4">
                    {error}
                  </p>
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {ideas.map((idea, i) => (
                      <button
                        key={`${idea.title}-${i}`}
                        onClick={() => handleIdeaClick(idea)}
                        className="wk-card flex w-full flex-col overflow-hidden rounded-[var(--wk-radius-card)] border-[length:var(--wk-border-card)] border-stone-200 bg-white text-left shadow-[var(--wk-shadow-card)] transition-all hover:shadow-[var(--wk-shadow-card-hover)] active:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:active:bg-stone-800 dark:hover:border-orange-500/30"
                      >
                        <div className="relative aspect-3/2 w-full overflow-hidden bg-stone-100 dark:bg-stone-800">
                          {idea.imageUrl ? (
                            <img
                              src={idea.imageUrl}
                              alt={idea.title}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <span className="text-3xl">
                                {(idea as { emoji?: string }).emoji ??
                                  "\uD83C\uDF7D\uFE0F"}
                              </span>
                            </div>
                          )}
                          <div className="absolute bottom-1.5 right-1.5 p-1 rounded-full bg-black/30 backdrop-blur-sm">
                            <ChevronRight className="w-3.5 h-3.5 text-white/80" />
                          </div>
                        </div>
                        <div className="p-3">
                          <h3 className="font-semibold text-sm line-clamp-2 dark:text-stone-100">
                            {idea.title}
                          </h3>
                          <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 mt-0.5">
                            {idea.description}
                          </p>
                        </div>
                        {idea.photographer && (
                          <div className="px-3 pb-2 -mt-1">
                            <p className="text-[10px] text-stone-400 dark:text-stone-600 truncate">
                              Photo by {idea.photographer}
                            </p>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>

                  {!chatEnabled && !unsplashEnabled && (
                    <Card>
                      <div className="text-center py-2">
                        <p className="text-sm text-stone-500 dark:text-stone-400">
                          Add an AI provider in Settings for personalized recipe
                          ideas
                        </p>
                      </div>
                    </Card>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Ingredient row with checkbox (matches RecipeDetail style) ──

function DiscoverIngredientRow({ ingredient }: { ingredient: { name: string; amount?: string; unit?: string } }) {
  const [checked, setChecked] = useState(false);
  const display = [ingredient.amount, ingredient.unit, ingredient.name].filter(Boolean).join(" ");

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
      <span className="dark:text-stone-200">{display}</span>
    </li>
  );
}
