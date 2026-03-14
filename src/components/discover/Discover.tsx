import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { classNames, formatTime, formatTotalTime, normalizeSearch } from "../../lib/utils";
import { TIME_RANGES } from "../../lib/tags";
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
  Hourglass,
  ArrowUpDown,
  XMark,
  ChevronDown,
  Sun,
  MagnifyingGlass,
  Tag,
  EllipsisVertical,
  Trash,
} from "../ui/Icon";
import { useTags } from "../../hooks/useTags";
import { SeasonalBrandIcon } from "../ui/SeasonalBrandIcon";
import { useWakeLock } from "../../hooks/useWakeLock";
import type {
  Recipe,
  RecipeIndexEntry,
  Ingredient,
  Step,
  DiscoverFeed,
  DiscoverFeedItem,
  DiscoverSource,
  DiscoverCategory,
  DiscoverConfig,
} from "../../types";

// ── Props ───────────────────────────────────────────────

interface DiscoverProps {
  onSaveRecipe?: (
    recipe: Omit<Recipe, "id" | "createdAt" | "updatedAt">
  ) => Promise<Recipe>;
  onUpdateRecipe?: (id: string, updates: Partial<Recipe>) => Promise<Recipe>;
  chatEnabled?: boolean;
  recipes?: RecipeIndexEntry[];
}

// ── Constants ───────────────────────────────────────────

/** Fallback labels for legacy source IDs */
const LEGACY_SOURCE_LABELS: Record<string, string> = {
  nyt: "NYT Cooking",
  allrecipes: "AllRecipes",
  seriouseats: "Serious Eats",
};

const TYPE_LABELS: Record<DiscoverCategory, string> = {
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

/** Keywords that indicate an alcoholic drink */
const ALCOHOLIC_KEYWORDS = /\b(?:cocktail|margarita|sangria|spritz|mojito|martini|daiquiri|whiskey|whisky|bourbon|vodka|rum|gin|tequila|mezcal|wine|champagne|prosecco|beer|ale|stout|aperol|negroni|mimosa|bellini|paloma|old fashioned|manhattan|cosmopolitan|sour|highball|julep|toddy|mule|collins|fizz|sling|flip|punch(?!.*fruit)|eggnog|grog|absinthe|amaretto|kahlua|baileys|vermouth|bitters|liqueur|amaro|pisco|sake|soju|hard (?:cider|seltzer|lemonade))\b/i;

/** Detect whether a discover feed drink item is likely alcoholic based on title/description */
function isAlcoholicDrink(item: { title: string; description?: string }): boolean {
  const text = `${item.title} ${item.description ?? ""}`;
  return ALCOHOLIC_KEYWORDS.test(text);
}

/** Cuisine keywords for text-matching against discover item titles/descriptions */
const CUISINE_OPTIONS = [
  "italian", "mexican", "chinese", "thai", "indian",
  "japanese", "korean", "mediterranean", "american", "french",
] as const;
type CuisineOption = typeof CUISINE_OPTIONS[number];

const CUISINE_LABELS: Record<CuisineOption, string> = {
  italian: "Italian",
  mexican: "Mexican",
  chinese: "Chinese",
  thai: "Thai",
  indian: "Indian",
  japanese: "Japanese",
  korean: "Korean",
  mediterranean: "Mediterranean",
  american: "American",
  french: "French",
};

/** Cuisine keyword sets for text matching (includes related terms) */
const CUISINE_KEYWORDS: Record<CuisineOption, string[]> = {
  italian: ["italian", "pasta", "risotto", "pizza", "lasagna", "pesto", "marinara", "bolognese", "gnocchi", "tiramisu", "bruschetta", "carbonara", "parmesan"],
  mexican: ["mexican", "taco", "burrito", "enchilada", "salsa", "guacamole", "quesadilla", "tamale", "mole", "tortilla", "pozole", "elote", "churro"],
  chinese: ["chinese", "stir-fry", "wok", "dumpling", "dim sum", "lo mein", "kung pao", "szechuan", "sichuan", "mapo", "fried rice", "chow"],
  thai: ["thai", "curry", "pad thai", "satay", "tom yum", "green curry", "red curry", "coconut", "basil chicken", "larb"],
  indian: ["indian", "tandoori", "tikka", "masala", "naan", "biryani", "samosa", "paneer", "dal", "chutney", "vindaloo", "korma", "chapati"],
  japanese: ["japanese", "sushi", "ramen", "teriyaki", "tempura", "miso", "sashimi", "udon", "yakitori", "gyoza", "katsu", "onigiri", "edamame"],
  korean: ["korean", "bibimbap", "kimchi", "bulgogi", "gochujang", "japchae", "tteokbokki", "galbi", "banchan", "jjigae", "kimbap"],
  mediterranean: ["mediterranean", "falafel", "hummus", "tzatziki", "pita", "shawarma", "tabbouleh", "dolma", "olive oil", "couscous", "baba ganoush"],
  american: ["american", "burger", "bbq", "mac and cheese", "fried chicken", "buffalo", "grilled cheese", "hot dog", "coleslaw", "cornbread", "biscuits"],
  french: ["french", "soufflé", "crêpe", "croissant", "ratatouille", "coq au vin", "beurre", "gratin", "béarnaise", "quiche", "bouillabaisse", "crème"],
};

function matchesCuisine(item: DiscoverFeedItem, cuisine: CuisineOption): boolean {
  // Prefer stored tags from AI classification
  if (item.tags && item.tags.length > 0) {
    return item.tags.includes(cuisine);
  }
  // Fallback to keyword matching for untagged items
  const text = `${item.title} ${item.description ?? ""}`.toLowerCase();
  return CUISINE_KEYWORDS[cuisine].some((kw) => text.includes(kw));
}

/** Diet options for tag-based filtering */
const DIET_OPTIONS = [
  "vegetarian", "vegan", "gluten-free", "dairy-free", "keto", "low-carb", "healthy",
] as const;
type DietOption = typeof DIET_OPTIONS[number];

const DIET_LABELS: Record<DietOption, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  "gluten-free": "Gluten-Free",
  "dairy-free": "Dairy-Free",
  keto: "Keto",
  "low-carb": "Low-Carb",
  healthy: "Healthy",
};

/** Season options for tag-based filtering */
const SEASON_OPTIONS = [
  "summer", "fall", "winter", "spring",
  "christmas", "thanksgiving", "halloween", "easter",
  "july 4th", "valentines", "st patricks", "cinco de mayo", "new years", "birthday",
] as const;
type SeasonOption = typeof SEASON_OPTIONS[number];

const SEASON_LABELS: Record<SeasonOption, string> = {
  summer: "Summer",
  fall: "Fall",
  winter: "Winter",
  spring: "Spring",
  christmas: "Christmas",
  thanksgiving: "Thanksgiving",
  halloween: "Halloween",
  easter: "Easter",
  "july 4th": "July 4th",
  valentines: "Valentine's",
  "st patricks": "St. Patrick's",
  "cinco de mayo": "Cinco de Mayo",
  "new years": "New Year's",
  birthday: "Birthday",
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

type DiscoverSort = "category" | "recent" | "expiring" | "alpha";

/** An item is "new" if it was added in the most recent crawl (same timestamp as lastRefreshed) */
function isNewItem(item: DiscoverFeedItem, lastRefreshed?: string): boolean {
  if (!item.addedAt || !lastRefreshed) return false;
  return item.addedAt === lastRefreshed;
}

/** How many days until this item expires from the discover feed */
function daysUntilExpiry(item: DiscoverFeedItem): number | null {
  if (!item.expiresAt) return null;
  const ms = new Date(item.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** An item is "expiring" if it will leave the discover feed within 2 days */
function isExpiringItem(item: DiscoverFeedItem): boolean {
  const days = daysUntilExpiry(item);
  return days !== null && days <= 2;
}

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
  onUpdateRecipe,
  chatEnabled,
  recipes: savedRecipes,
}: DiscoverProps) {
  const navigate = useNavigate();
  const tags = useTags();

  // ── Filter/sort state ──
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DiscoverSort>("category");
  const [newOnly, setNewOnly] = useState(false);
  const [discoverDrinkFilter, setDiscoverDrinkFilter] = useState<"all" | "alcoholic" | "non-alcoholic">("all");
  const [selectedType, setSelectedType] = useState<DiscoverCategory | null>(null);
  const [selectedCuisine, setSelectedCuisine] = useState<CuisineOption | null>(null);
  const [selectedDiet, setSelectedDiet] = useState<DietOption | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<SeasonOption | null>(null);
  const [maxTime, setMaxTime] = useState<number | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; right?: number } | null>(null);

  // ── Feed state ──
  const [feed, setFeed] = useState<DiscoverFeed | null>(() =>
    getLocal<DiscoverFeed>(FEED_CACHE_KEY)
  );
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedWarnings, setFeedWarnings] = useState<string[]>([]);

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
  // Track URLs that have been quick-saved to recipe book
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [savingUrls, setSavingUrls] = useState<Set<string>>(new Set());
  const [photoIndex, setPhotoIndex] = useState(0);
  const galleryRef = useRef<HTMLDivElement>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollPos = useRef<{ vertical: number; carousels: Record<string, number> } | null>(null);
  const [activeTab, setActiveTab] = useState<"ingredients" | "steps">("ingredients");
  const [ingredientSort, setIngredientSort] = useState<"recipe" | "category">(
    () => (localStorage.getItem("whisk_ingredient_sort") as "recipe" | "category") ?? "recipe"
  );
  const [ingredientResetKey, setIngredientResetKey] = useState(0);
  const [hasCheckedIngredients, setHasCheckedIngredients] = useState(false);
  const [isGroupingSteps, setIsGroupingSteps] = useState(false);
  const [groupedSteps, setGroupedSteps] = useState<Step[] | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [showOverflow, setShowOverflow] = useState(false);
  const wakeLock = useWakeLock();

  // ── Discover config (source labels + settings from server) ──
  const [discoverConfig, setDiscoverConfig] = useState<DiscoverConfig | null>(null);
  useEffect(() => {
    api.get<DiscoverConfig>("/discover/config").then((config) => {
      if (config) setDiscoverConfig(config);
    }).catch(() => {});
  }, []);

  /** Look up display label for a source ID */
  const sourceLabel = useCallback((sourceId: string | undefined): string => {
    if (!sourceId) return "Recipe";
    // Check config first, then legacy fallback
    const fromConfig = discoverConfig?.sources.find((s) => s.id === sourceId);
    if (fromConfig) return fromConfig.label;
    return LEGACY_SOURCE_LABELS[sourceId] ?? sourceId;
  }, [discoverConfig]);

  // ── Feed loading ──

  const refreshFeed = useCallback(async (force = false) => {
    setFeedLoading(true);
    setFeedError(null);
    setFeedWarnings([]);
    try {
      const params = new URLSearchParams();
      if (force) params.set("force", "true");
      const url = `/discover/feed?${params}`;
      const data = await api.post<DiscoverFeed & { warnings?: string[] }>(url, {});
      if (data) {
        if (data.warnings?.length) {
          setFeedWarnings(data.warnings);
        }
        setFeed(data);
        setLocal(FEED_CACHE_KEY, data);
      }
    } catch {
      setFeedError("Could not refresh. Try again later.");
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const autoRefreshEnabled = discoverConfig?.autoRefreshEnabled !== false;

  useEffect(() => {
    // Use server config for refresh interval, fallback to 2 days
    const refreshDays = discoverConfig?.refreshIntervalDays ?? 2;
    const staleMs = refreshDays * 24 * 60 * 60 * 1000;

    async function init() {
      // If we have cached data, show it immediately
      if (feed?.lastRefreshed) {
        // Auto-refresh in background if feed is stale (only when auto-refresh is on)
        if (autoRefreshEnabled) {
          const age = Date.now() - new Date(feed.lastRefreshed).getTime();
          if (age > staleMs) {
            refreshFeed(); // Background refresh — cached data shows meanwhile
          }
        }
        return;
      }

      // No cache — fetch from KV (server applies config-based filtering)
      try {
        const data = await api.get<DiscoverFeed>("/discover/feed");
        if (data?.lastRefreshed) {
          setFeed(data);
          setLocal(FEED_CACHE_KEY, data);
          // Only auto-refresh stale data when enabled
          if (autoRefreshEnabled) {
            const age = Date.now() - new Date(data.lastRefreshed).getTime();
            if (age > staleMs) {
              refreshFeed();
            }
          }
        }
        // First visit with no feed — auto-scrape (even if auto-refresh is off, need initial data)
        else if (autoRefreshEnabled) {
          refreshFeed();
        }
      } catch {
        // Offline, cached data (if any) is fine
      }
    }
    init();
  }, [discoverConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Backfill missing feed images from saved recipes ──
  useEffect(() => {
    if (!feed || !savedRecipes?.length) return;
    // Build a map from source URL → thumbnailUrl for saved recipes that have both
    const urlToThumb = new Map<string, string>();
    for (const r of savedRecipes) {
      if (r.sourceUrl && r.thumbnailUrl) {
        urlToThumb.set(r.sourceUrl.replace(/\/$/, "").replace(/^http:/, "https:"), r.thumbnailUrl);
      }
    }
    if (urlToThumb.size === 0) return;

    let hasUpdates = false;
    const updated = { ...feed, categories: { ...feed.categories } };
    for (const cat of Object.keys(updated.categories) as DiscoverCategory[]) {
      const items = updated.categories[cat];
      if (!items) continue;
      const patched = items.map((item) => {
        if (item.imageUrl) return item;
        const norm = item.url.replace(/\/$/, "").replace(/^http:/, "https:");
        const thumb = urlToThumb.get(norm);
        if (thumb) {
          hasUpdates = true;
          // Persist fix to server
          api.patch("/discover/feed", { url: item.url, imageUrl: thumb }).catch(() => {});
          return { ...item, imageUrl: thumb };
        }
        return item;
      });
      updated.categories[cat] = patched;
    }
    if (hasUpdates) {
      setFeed(updated);
      setLocal(FEED_CACHE_KEY, updated);
    }
  }, [feed?.lastRefreshed, savedRecipes]); // Only re-run when feed is loaded or recipes change

  // ── Feed item click → import recipe ──

  const handleFeedItemClick = useCallback(
    async (item: DiscoverFeedItem) => {
      // Save scroll positions before navigating to detail
      const el = feedScrollRef.current;
      if (el) {
        const carousels: Record<string, number> = {};
        el.querySelectorAll<HTMLDivElement>("[data-carousel]").forEach((c) => {
          const key = c.dataset.carousel;
          if (key && c.scrollLeft > 0) carousels[key] = c.scrollLeft;
        });
        savedScrollPos.current = { vertical: el.scrollTop, carousels };
      }
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
          downloadImage: true,
        });
        if (data?.title) {
          setImportedRecipe(data);
          // Update the feed cache with imported image and totalTime
          const importedImage = data.thumbnailUrl ?? data.photos?.[0]?.url;
          const importedTotalTime = ((data.prepTime ?? 0) + (data.cookTime ?? 0)) || undefined;
          const needsImageUpdate = importedImage && importedImage !== item.imageUrl;
          const needsTimeUpdate = importedTotalTime && !item.totalTime;
          if (needsImageUpdate || needsTimeUpdate) {
            // Update local feed cache
            setFeed((prev) => {
              if (!prev) return prev;
              const updated = { ...prev, categories: { ...prev.categories } };
              for (const cat of Object.keys(updated.categories) as DiscoverCategory[]) {
                const items = updated.categories[cat];
                if (!items) continue;
                const idx = items.findIndex((i) => i.url === item.url);
                if (idx !== -1) {
                  updated.categories[cat] = items.map((i, j) =>
                    j === idx ? {
                      ...i,
                      ...(needsImageUpdate ? { imageUrl: importedImage } : {}),
                      ...(needsTimeUpdate ? { totalTime: importedTotalTime } : {}),
                    } : i
                  );
                  break;
                }
              }
              setLocal(FEED_CACHE_KEY, updated);
              return updated;
            });
            // Persist the fix to the server so other devices/sessions get it too
            api.patch("/discover/feed", {
              url: item.url,
              ...(needsImageUpdate ? { imageUrl: importedImage } : {}),
              ...(needsTimeUpdate ? { totalTime: importedTotalTime } : {}),
            }).catch(() => {/* best-effort */});
          }
        } else {
          setImportError("Could not parse recipe from this page.");
        }
      } catch (err) {
        const message = err instanceof Error && err.message
          ? err.message
          : "Could not load recipe. The site may be blocking access.";
        setImportError(message);
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
      // Merge tags from discover item + imported recipe (deduped)
      const mergedTags = [...new Set([
        ...(importedRecipe.tags ?? []),
        ...(selectedFeedItem?.tags ?? []),
      ])];
      const recipe = await onSaveRecipe({
        title: importedRecipe.title,
        description: importedRecipe.description,
        ingredients: importedRecipe.ingredients,
        steps: importedRecipe.steps,
        favorite: false,
        photos: detailPhotos.length > 0 ? detailPhotos : importedRecipe.photos ?? [],
        thumbnailUrl: importedRecipe.thumbnailUrl,
        videoUrl: importedRecipe.videoUrl,
        tags: mergedTags,
        prepTime: importedRecipe.prepTime,
        cookTime: importedRecipe.cookTime,
        servings: importedRecipe.servings,
        source: importedRecipe.source as Recipe["source"],
      });
      setSavedFeedRecipeId(recipe.id);
      // Auto-tag in background if AI is available and tags are sparse
      if (chatEnabled && onUpdateRecipe) {
        const SPEED_TAGS = new Set(["quick", "under 30 min", "under 15 min"]);
        const hasMeaningfulTags = mergedTags.some((t) => !SPEED_TAGS.has(t));
        if (!hasMeaningfulTags || !recipe.difficulty) {
          (async () => {
            try {
              const res = await fetch("/api/ai/auto-tag", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
                },
                body: JSON.stringify({
                  title: importedRecipe.title,
                  description: importedRecipe.description ?? "",
                  ingredients: importedRecipe.ingredients.filter((i) => i.name.trim()).map((i) => i.name),
                }),
              });
              if (!res.ok) return;
              const data = (await res.json()) as { tags?: string[]; difficulty?: Recipe["difficulty"] };
              const updates: Partial<Recipe> = {};
              if (Array.isArray(data.tags) && data.tags.length > 0 && !hasMeaningfulTags) {
                updates.tags = [...new Set([...mergedTags, ...data.tags])];
              }
              if (data.difficulty && !recipe.difficulty) {
                updates.difficulty = data.difficulty;
              }
              if (Object.keys(updates).length > 0) {
                await onUpdateRecipe(recipe.id, updates);
              }
            } catch {
              // Silent fail
            }
          })();
        }
      }
    } catch {
      // Save failed — button stays enabled
    } finally {
      setIsSavingFeed(false);
    }
  }, [importedRecipe, onSaveRecipe, onUpdateRecipe, chatEnabled]);

  // Quick-save a feed item directly from the card (imports + saves in one step)
  const handleQuickSave = useCallback(async (item: DiscoverFeedItem) => {
    if (!onSaveRecipe || savedUrls.has(item.url) || savingUrls.has(item.url)) return;
    setSavingUrls((prev) => new Set(prev).add(item.url));
    try {
      const data = await api.post<ImportedRecipe>("/import/url", {
        url: item.url,
        downloadImage: true,
      });
      if (!data?.title) return;
      const mergedTags = [...new Set([
        ...(data.tags ?? []),
        ...(item.tags ?? []),
      ])];
      await onSaveRecipe({
        title: data.title,
        description: data.description,
        ingredients: data.ingredients,
        steps: data.steps,
        favorite: false,
        photos: data.photos ?? [],
        thumbnailUrl: data.thumbnailUrl,
        videoUrl: data.videoUrl,
        tags: mergedTags,
        prepTime: data.prepTime,
        cookTime: data.cookTime,
        servings: data.servings,
        source: data.source as Recipe["source"],
      });
      setSavedUrls((prev) => new Set(prev).add(item.url));
      // Backfill feed image if the import got one and the feed card didn't have one
      const importedImage = data.thumbnailUrl ?? data.photos?.[0]?.url;
      if (importedImage && !item.imageUrl) {
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
        api.patch("/discover/feed", { url: item.url, imageUrl: importedImage }).catch(() => {});
      }
    } catch {
      // Import failed — button stays as +
    } finally {
      setSavingUrls((prev) => {
        const next = new Set(prev);
        next.delete(item.url);
        return next;
      });
    }
  }, [onSaveRecipe, savedUrls, savingUrls]);

  const handleFeedBack = () => {
    const pos = savedScrollPos.current;
    setSelectedFeedItem(null);
    setImportedRecipe(null);
    setImportError(null);
    setSavedFeedRecipeId(null);
    setPhotoIndex(0);
    setGroupedSteps(null);
    setShowTagEditor(false);
    setShowOverflow(false);
    setNewTag("");
    if (wakeLock.isActive) wakeLock.release();
    // Restore scroll positions after returning to feed list
    if (pos) {
      requestAnimationFrame(() => {
        const el = feedScrollRef.current;
        if (el) {
          el.scrollTop = pos.vertical;
          el.querySelectorAll<HTMLDivElement>("[data-carousel]").forEach((c) => {
            const key = c.dataset.carousel;
            if (key && pos.carousels[key]) c.scrollLeft = pos.carousels[key];
          });
        }
      });
    }
  };

  /** Remove a discover feed item from the local feed and go back to browse */
  const handleRemoveFeedItem = useCallback(() => {
    if (!selectedFeedItem) return;
    setFeed((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, categories: { ...prev.categories } };
      for (const cat of Object.keys(updated.categories) as DiscoverCategory[]) {
        const items = updated.categories[cat];
        if (!items) continue;
        const filtered = items.filter((i) => i.url !== selectedFeedItem.url);
        if (filtered.length !== items.length) {
          updated.categories[cat] = filtered.length > 0 ? filtered : undefined!;
          if (filtered.length === 0) {
            delete updated.categories[cat];
          }
          break;
        }
      }
      setLocal(FEED_CACHE_KEY, updated);
      return updated;
    });
    // Also persist removal server-side so it doesn't come back
    api.delete(`/discover/feed?url=${encodeURIComponent(selectedFeedItem.url)}`).catch(() => {/* best-effort */});
    handleFeedBack();
  }, [selectedFeedItem, handleFeedBack]);

  // Toggle a tag on the imported recipe and persist to the discover feed
  const handleToggleDiscoverTag = useCallback((tag: string) => {
    let updatedTags: string[] | undefined;
    setImportedRecipe((prev) => {
      if (!prev) return prev;
      const current = prev.tags ?? [];
      const newTags = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag];
      updatedTags = newTags;
      return { ...prev, tags: newTags };
    });

    // Persist tag change to the discover feed cache + API
    if (!selectedFeedItem) return;
    const itemUrl = selectedFeedItem.url;

    // Determine if category should change (tag matches a category name)
    const CATEGORIES: Set<string> = new Set(CATEGORY_ORDER);
    const newCategory = updatedTags?.find((t) => CATEGORIES.has(t)) as DiscoverCategory | undefined;

    setFeed((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, categories: { ...prev.categories } };
      for (const cat of Object.keys(updated.categories) as DiscoverCategory[]) {
        const items = updated.categories[cat];
        if (!items) continue;
        const idx = items.findIndex((i) => i.url === itemUrl);
        if (idx !== -1) {
          const item = { ...items[idx]!, tags: updatedTags };
          if (newCategory && newCategory !== cat) {
            // Move item to new category
            updated.categories[cat] = items.filter((_, j) => j !== idx);
            const dest = updated.categories[newCategory] ?? [];
            updated.categories[newCategory] = [...dest, { ...item, category: newCategory }];
          } else {
            updated.categories[cat] = items.map((i, j) => j === idx ? item : i);
          }
          break;
        }
      }
      setLocal(FEED_CACHE_KEY, updated);
      return updated;
    });

    // Persist to server
    api.patch("/discover/feed", {
      url: itemUrl,
      tags: updatedTags,
      ...(newCategory ? { category: newCategory } : {}),
    }).catch(() => {/* best-effort */});
  }, [selectedFeedItem]);

  const handleAddNewDiscoverTag = useCallback(async () => {
    const name = newTag.trim().toLowerCase();
    if (!name || !importedRecipe) return;
    if (!tags.allTagNames.includes(name)) {
      await tags.addCustomTag(name);
    }
    if (!(importedRecipe.tags ?? []).includes(name)) {
      handleToggleDiscoverTag(name);
    }
    setNewTag("");
  }, [newTag, importedRecipe, tags, handleToggleDiscoverTag]);

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

  // Deduplicate photos — aggressive dedup to catch same image from different CDN paths
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
    // Normalize a CDN image URL to a canonical key for dedup comparison.
    // CDNs like Dotdash Meredith (AllRecipes, Serious Eats) serve the same image
    // at different sizes/crops with different fingerprints in the URL path:
    //   /thmb/ABC123/1500x0/filters:no_upscale()/lamb-biryani.jpg
    //   /thmb/DEF456/750x422/filters:fill()/lamb-biryani.jpg
    // We strip the fingerprint, dimensions, and filter params to compare.
    const normalizeImageKey = (url: string): string => {
      let u = url.split("?")[0]?.replace(/\/$/, "").replace(/^https?:\/\//, "") ?? url;
      // Strip Dotdash /thmb/FINGERPRINT/DIMENSIONs/filters:.../ path segments
      u = u.replace(/\/thmb\/[^/]+\/[^/]*\d+x\d+[^/]*\/(?:filters:[^/]*\/)?/i, "/thmb/");
      // Strip generic CDN size/crop segments like /750x422/, /4x3/, /1500x0/
      u = u.replace(/\/\d+x\d+\//g, "/");
      // NYT images: strip size/crop suffixes like -articleLarge, -mediumThreeByTwo252, -master675
      u = u.replace(/-(?:article\w+|medium\w+|master\d+|thumb\w+|square\w+|blog\w+|popup|jumbo|super[Jj]umbo|wide\w+|video\w+)\.(jpg|jpeg|png|webp)/i, ".$1");
      return u.toLowerCase();
    };

    const seenKeys = new Set<string>();
    const seenFilenames = new Set<string>();
    const deduped = allPhotos.filter((p) => {
      const key = normalizeImageKey(p.url);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      // Also dedup by filename — catches same image from different CDN subdomains
      const filename = key.split("/").pop() ?? "";
      if (filename.length > 8 && /\.(jpg|jpeg|png|webp|avif)$/i.test(filename)) {
        // Strip dimension suffixes for better matching (e.g. "image-750x422.jpg" → "image.jpg")
        const baseFilename = filename.replace(/-?\d+x\d+/, "");
        if (seenFilenames.has(filename)) return false;
        seenFilenames.add(filename);
        if (baseFilename !== filename) {
          if (seenFilenames.has(baseFilename)) return false;
          seenFilenames.add(baseFilename);
        }
      }
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
    // Deduplicate by URL and filter out items without images
    // (imageless items are typically roundup/collection pages that fail on import)
    const seen = new Set<string>();
    return items.filter((item) => {
      if (!item.imageUrl) return false;
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
      items = items.filter((i) => isNewItem(i, feed?.lastRefreshed));
    }

    // Type filter (maps to category field)
    if (selectedType) {
      items = items.filter((i) => i.category === selectedType);
    }

    // Cuisine filter (tags or text match)
    if (selectedCuisine) {
      items = items.filter((i) => matchesCuisine(i, selectedCuisine));
    }

    // Diet filter (tag match)
    if (selectedDiet) {
      items = items.filter((i) => i.tags?.includes(selectedDiet));
    }

    // Season filter (tag match)
    if (selectedSeason) {
      items = items.filter((i) => i.tags?.includes(selectedSeason));
    }

    // Time filter
    if (maxTime != null) {
      if (maxTime === Infinity) {
        items = items.filter((i) => i.totalTime && i.totalTime >= 60);
      } else {
        items = items.filter((i) => i.totalTime && i.totalTime <= maxTime);
      }
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
    } else if (sort === "expiring") {
      items = [...items].sort((a, b) => {
        const aExpiry = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
        const bExpiry = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
        return aExpiry - bExpiry;
      });
    }

    return items;
  }, [allItems, search, newOnly, selectedType, selectedCuisine, selectedDiet, selectedSeason, maxTime, sort]);

  // Count new items for the badge
  const newCount = useMemo(() => allItems.filter((i) => isNewItem(i, feed?.lastRefreshed)).length, [allItems, feed?.lastRefreshed]);
  // Count expiring items (for conditional sort option)
  const expirationEnabled = discoverConfig?.expirationEnabled !== false;
  const expiringCount = useMemo(() => allItems.filter((i) => isExpiringItem(i)).length, [allItems]);

  // Check if any filters are active (to switch from carousel to grid)
  const hasActiveFilters = search || newOnly || selectedType !== null || selectedCuisine !== null || selectedDiet !== null || selectedSeason !== null || maxTime !== null;

  // Group filtered items by category for carousel view
  const groupedItems = useMemo(() => {
    if (hasActiveFilters || sort !== "category") return null;
    return CATEGORY_ORDER
      .map((cat) => ({
        category: cat,
        items: filteredItems.filter((i) => i.category === cat).sort((a, b) => {
          // New items first, then expiring, then the rest
          const aNew = isNewItem(a, feed?.lastRefreshed) ? 0 : 1;
          const bNew = isNewItem(b, feed?.lastRefreshed) ? 0 : 1;
          if (aNew !== bNew) return aNew - bNew;
          const aExpiring = isExpiringItem(a) ? 0 : 1;
          const bExpiring = isExpiringItem(b) ? 0 : 1;
          if (aExpiring !== bExpiring) return aExpiring - bExpiring;
          // Within the same group, sort by expiry date ascending (soonest first)
          const aExpiry = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
          const bExpiry = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
          return aExpiry - bExpiry;
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [filteredItems, hasActiveFilters, sort, feed?.lastRefreshed]);

  // Available types and cuisines for filter dropdowns (must be before early return)
  const availableTypes = useMemo(() =>
    CATEGORY_ORDER.filter((cat) => allItems.some((i) => i.category === cat)),
    [allItems]
  );
  const availableCuisines = useMemo(() =>
    CUISINE_OPTIONS.filter((cuisine) => allItems.some((i) => matchesCuisine(i, cuisine))),
    [allItems]
  );
  const availableDiets = useMemo(() =>
    DIET_OPTIONS.filter((diet) => allItems.some((i) => i.tags?.includes(diet))),
    [allItems]
  );
  const availableSeasons = useMemo(() =>
    SEASON_OPTIONS.filter((season) => allItems.some((i) => i.tags?.includes(season))),
    [allItems]
  );

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
                  <div className="wk-dropdown absolute right-0 top-8 z-50 w-48 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800">
                    <button
                      onClick={() => {
                        handleRemoveFeedItem();
                        setShowOverflow(false);
                      }}
                      className="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-stone-700"
                    >
                      <Trash className="w-4 h-4" />
                      Remove from Feed
                    </button>
                  </div>
                </>
              )}
            </div>
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
                          {sourceLabel(selectedFeedItem.source)}
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
                {sourceLabel(selectedFeedItem.source)}
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
                    View on {sourceLabel(selectedFeedItem.source)}
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
                {((importedRecipe.tags && importedRecipe.tags.length > 0) || showTagEditor) && (
                  <>
                  <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                    {(importedRecipe.tags ?? []).map((tag) => (
                      <TagChip
                        key={tag}
                        label={tag.charAt(0).toUpperCase() + tag.slice(1)}
                        size="sm"
                        selected={showTagEditor}
                        onToggle={showTagEditor ? () => handleToggleDiscoverTag(tag) : undefined}
                      />
                    ))}
                    <button
                      onClick={() => setShowTagEditor(!showTagEditor)}
                      className={classNames(
                        "wk-pill inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
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
                          .filter((t) => !(importedRecipe.tags ?? []).includes(t))
                          .slice(0, 15)
                          .map((tag) => (
                            <TagChip
                              key={tag}
                              label={tag}
                              size="sm"
                              onToggle={() => handleToggleDiscoverTag(tag)}
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
                              handleAddNewDiscoverTag();
                            }
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleAddNewDiscoverTag}
                          disabled={!newTag.trim()}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                  </>
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
                    {sourceLabel(selectedFeedItem.source)}
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
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)] wk-header-decor relative">
        <div className="flex items-center justify-between py-3">
          <button
            onClick={() => navigate("/settings")}
            title="Settings"
            className="flex items-center gap-1.5"
          >
            <SeasonalBrandIcon />
            <span className="text-lg font-bold text-orange-500">W</span>
            <span className="text-stone-400 dark:text-stone-500">|</span>
            <h1 className="text-lg font-bold dark:text-stone-100">Discover</h1>
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
              title="Search discover recipes"
            >
              {searchOpen ? <XMark className="w-5 h-5" /> : <MagnifyingGlass className="w-5 h-5" />}
            </button>
            <button
              onClick={() => {
                if (!autoRefreshEnabled) {
                  setFeedError("Auto-refresh is paused. Enable it in Settings > Display > Discover Feed.");
                  return;
                }
                refreshFeed(true);
              }}
              disabled={feedLoading}
              className={classNames(
                "p-2 rounded-lg transition-all relative",
                !autoRefreshEnabled
                  ? "text-stone-300 dark:text-stone-600"
                  : feedLoading
                    ? "text-orange-500 ring-1 ring-orange-300 dark:ring-orange-700"
                    : "text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
              )}
              title={autoRefreshEnabled ? "Refresh trending recipes" : "Auto-refresh paused"}
            >
              <RefreshCw
                className={classNames(
                  "w-4.5 h-4.5",
                  feedLoading && "animate-spin"
                )}
              />
              {!autoRefreshEnabled && (
                <XMark className="w-3 h-3 absolute -top-0.5 -right-0.5 text-red-500 bg-white dark:bg-stone-900 rounded-full" />
              )}
            </button>
          </div>
        </div>

        {/* Search + filter bar — only show when we have content */}
        {hasFeedContent && (
          <>
            {/* Search — collapsible */}
            {searchOpen && (
              <div className="pb-2">
                <div className="relative">
                  <input
                    ref={searchInputRef}
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
            )}

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
                  <span className="wk-badge absolute -top-0.5 -right-0.5 min-w-4 h-4 flex items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white px-1">
                    {newCount}
                  </span>
                )}
              </button>

              {/* Sort */}
              <button
                onClick={(e) => openDropdownAt("sort", e)}
                className="shrink-0 p-1.5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 transition-colors"
                title={`Sort: ${({ category: "Category", recent: "Recent", expiring: "Expiring", alpha: "A-Z" } as Record<DiscoverSort, string>)[sort]}`}
              >
                <ArrowUpDown className="w-4.5 h-4.5" />
              </button>

              <span className="text-stone-300 dark:text-stone-600 text-sm select-none">|</span>

              {/* Type filter (meal type) */}
              <button
                onClick={(e) => openDropdownAt("type", e)}
                className={classNames(
                  "wk-pill inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors shrink-0",
                  selectedType
                    ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                    : openDropdown === "type"
                      ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                      : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                )}
              >
                {selectedType ? TYPE_LABELS[selectedType] : "Type"}
                <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === "type" && "rotate-180")} />
              </button>

              {/* Cuisine filter */}
              {availableCuisines.length > 0 && (
                <button
                  onClick={(e) => openDropdownAt("cuisine", e)}
                  className={classNames(
                    "wk-pill inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors shrink-0",
                    selectedCuisine
                      ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : openDropdown === "cuisine"
                        ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                        : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                  )}
                >
                  {selectedCuisine ? CUISINE_LABELS[selectedCuisine] : "Cuisine"}
                  <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === "cuisine" && "rotate-180")} />
                </button>
              )}

              {/* Time filter */}
              <button
                onClick={(e) => openDropdownAt("time", e)}
                className={classNames(
                  "wk-pill inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors shrink-0",
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

              {/* Diet filter */}
              {availableDiets.length > 0 && (
                <button
                  onClick={(e) => openDropdownAt("diet", e)}
                  className={classNames(
                    "wk-pill inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors shrink-0",
                    selectedDiet
                      ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : openDropdown === "diet"
                        ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                        : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                  )}
                >
                  {selectedDiet ? DIET_LABELS[selectedDiet] : "Diet"}
                  <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === "diet" && "rotate-180")} />
                </button>
              )}

              {/* Season filter */}
              {availableSeasons.length > 0 && (
                <button
                  onClick={(e) => openDropdownAt("season", e)}
                  className={classNames(
                    "wk-pill inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors shrink-0",
                    selectedSeason
                      ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : openDropdown === "season"
                        ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                        : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                  )}
                >
                  <Sun className="w-3 h-3" />
                  {selectedSeason ? SEASON_LABELS[selectedSeason] : "Season"}
                  <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === "season" && "rotate-180")} />
                </button>
              )}
            </div>

            {/* Dropdown panel — portaled to body */}
            {openDropdown && dropdownPos && createPortal(
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
                  {openDropdown === "sort" && (
                    ([["category", "Category"], ["recent", "Recent"], ...(expiringCount > 0 ? [["expiring", "Expiring"]] : []), ["alpha", "A-Z"]] as [DiscoverSort, string][])
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
                  {openDropdown === "type" && availableTypes.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => { setSelectedType(selectedType === cat ? null : cat); setOpenDropdown(null); }}
                      className={classNames(
                        "w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors",
                        selectedType === cat
                          ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                          : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      )}
                    >
                      {TYPE_LABELS[cat]}
                      {selectedType === cat && <Check className="w-4 h-4 text-orange-500" />}
                    </button>
                  ))}
                  {openDropdown === "cuisine" && availableCuisines.map((cuisine) => (
                    <button
                      key={cuisine}
                      onClick={() => { setSelectedCuisine(selectedCuisine === cuisine ? null : cuisine); setOpenDropdown(null); }}
                      className={classNames(
                        "w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors",
                        selectedCuisine === cuisine
                          ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                          : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      )}
                    >
                      {CUISINE_LABELS[cuisine]}
                      {selectedCuisine === cuisine && <Check className="w-4 h-4 text-orange-500" />}
                    </button>
                  ))}
                  {openDropdown === "diet" && availableDiets.map((diet) => (
                    <button
                      key={diet}
                      onClick={() => { setSelectedDiet(selectedDiet === diet ? null : diet); setOpenDropdown(null); }}
                      className={classNames(
                        "w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors",
                        selectedDiet === diet
                          ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                          : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      )}
                    >
                      {DIET_LABELS[diet]}
                      {selectedDiet === diet && <Check className="w-4 h-4 text-orange-500" />}
                    </button>
                  ))}
                  {openDropdown === "season" && availableSeasons.map((season) => (
                    <button
                      key={season}
                      onClick={() => { setSelectedSeason(selectedSeason === season ? null : season); setOpenDropdown(null); }}
                      className={classNames(
                        "w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors",
                        selectedSeason === season
                          ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                          : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                      )}
                    >
                      {SEASON_LABELS[season]}
                      {selectedSeason === season && <Check className="w-4 h-4 text-orange-500" />}
                    </button>
                  ))}
                  {openDropdown === "time" && TIME_RANGES.map((range) => {
                    const isActive = maxTime === range.maxMinutes;
                    return (
                      <button
                        key={range.maxMinutes}
                        onClick={() => { setMaxTime(isActive ? null : range.maxMinutes); setOpenDropdown(null); }}
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
                </div>
              </>,
              document.body
            )}

            {/* Active filter chips */}
            {(selectedType || selectedCuisine || selectedDiet || selectedSeason || maxTime != null) && (
              <div className="flex items-center gap-1.5 pb-2">
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {selectedType && (
                    <button
                      onClick={() => setSelectedType(null)}
                      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                    >
                      {TYPE_LABELS[selectedType]}
                      <XMark className="w-3 h-3" />
                    </button>
                  )}
                  {selectedCuisine && (
                    <button
                      onClick={() => setSelectedCuisine(null)}
                      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300 capitalize"
                    >
                      {CUISINE_LABELS[selectedCuisine]}
                      <XMark className="w-3 h-3" />
                    </button>
                  )}
                  {maxTime != null && (
                    <button
                      onClick={() => setMaxTime(null)}
                      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                    >
                      {TIME_RANGES.find((r) => r.maxMinutes === maxTime)?.label ?? "Time"}
                      <XMark className="w-3 h-3" />
                    </button>
                  )}
                  {selectedDiet && (
                    <button
                      onClick={() => setSelectedDiet(null)}
                      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                    >
                      {DIET_LABELS[selectedDiet]}
                      <XMark className="w-3 h-3" />
                    </button>
                  )}
                  {selectedSeason && (
                    <button
                      onClick={() => setSelectedSeason(null)}
                      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                    >
                      {SEASON_LABELS[selectedSeason]}
                      <XMark className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => { setSelectedType(null); setSelectedCuisine(null); setSelectedDiet(null); setSelectedSeason(null); setMaxTime(null); }}
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
      <div ref={feedScrollRef} className="flex-1 overflow-y-auto pb-24">
        {/* ── Trending Feed ── */}
        {feedLoading && !hasFeedContent && (
          <LoadingSpinner className="py-16" size="lg" />
        )}

        {feedError && hasFeedContent && (
          <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center justify-between gap-2">
            <p className="text-xs text-amber-700 dark:text-amber-300 flex-1">{feedError}</p>
            <button onClick={() => setFeedError(null)} className="text-amber-400 hover:text-amber-600 shrink-0">
              <XMark className="w-4 h-4" />
            </button>
          </div>
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

        {feedWarnings.length > 0 && (
          <div className="px-4 pt-2">
            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 flex items-start justify-between gap-2">
              <div className="flex-1">
                {feedWarnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
                    {w}
                  </p>
                ))}
              </div>
              <button onClick={() => setFeedWarnings([])} className="text-amber-400 hover:text-amber-600 shrink-0 mt-0.5">
                <XMark className="w-4 h-4" />
              </button>
            </div>
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
            {groupedItems.map(({ category, items: rawItems }, groupIdx) => {
              // Apply drink filter for the Drinks category
              const items = category === "drinks" && discoverDrinkFilter !== "all"
                ? rawItems.filter((item) =>
                    discoverDrinkFilter === "alcoholic" ? isAlcoholicDrink(item) : !isAlcoholicDrink(item)
                  )
                : rawItems;
              const catNewCount = items.filter((i) => isNewItem(i, feed?.lastRefreshed)).length;
              const catExpiringCount = items.filter((i) => !isNewItem(i, feed?.lastRefreshed) && isExpiringItem(i)).length;
              // Show drink pills if there's a mix of alcoholic and non-alcoholic
              const showDrinkPills = category === "drinks" && rawItems.length > 0 && (() => {
                const alcCount = rawItems.filter(isAlcoholicDrink).length;
                return alcCount > 0 && alcCount < rawItems.length;
              })();
              return (
                <div key={category}>
                  <div className="px-4 flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-300">
                      {TYPE_LABELS[category]}
                      <span className="ml-1.5 text-xs font-normal text-stone-400 dark:text-stone-500">
                        {items.length}
                      </span>
                      {catNewCount > 0 && (
                        <span className="ml-1.5 text-[10px] font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 px-1.5 py-0.5 rounded-full">
                          {catNewCount} new
                        </span>
                      )}
                      {catExpiringCount > 0 && (
                        <span className="ml-1.5 text-[10px] font-medium text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded-full">
                          {catExpiringCount} leaving soon{!expirationEnabled && " (paused)"}
                        </span>
                      )}
                      {showDrinkPills && (
                        <>
                          <button
                            onClick={() => setDiscoverDrinkFilter(discoverDrinkFilter === "alcoholic" ? "all" : "alcoholic")}
                            className={classNames(
                              "ml-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors border",
                              discoverDrinkFilter === "alcoholic"
                                ? "border-orange-400 bg-orange-50 text-orange-600 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-400"
                                : "border-stone-300 text-stone-500 dark:border-stone-600 dark:text-stone-400"
                            )}
                          >
                            Alcoholic
                          </button>
                          <button
                            onClick={() => setDiscoverDrinkFilter(discoverDrinkFilter === "non-alcoholic" ? "all" : "non-alcoholic")}
                            className={classNames(
                              "ml-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors border",
                              discoverDrinkFilter === "non-alcoholic"
                                ? "border-orange-400 bg-orange-50 text-orange-600 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-400"
                                : "border-stone-300 text-stone-500 dark:border-stone-600 dark:text-stone-400"
                            )}
                          >
                            Non-alcoholic
                          </button>
                        </>
                      )}
                    </h3>
                    {groupIdx === 0 && feed?.lastRefreshed && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-stone-400 dark:text-stone-500">
                          {timeAgo(feed.lastRefreshed)}
                        </span>
                        <button
                          onClick={() => {
                            if (!autoRefreshEnabled) {
                              setFeedError("Auto-refresh is paused. Enable it in Settings > Display > Discover Feed.");
                              return;
                            }
                            refreshFeed(true);
                          }}
                          disabled={feedLoading}
                          className={classNames(
                            "p-1 relative transition-colors",
                            !autoRefreshEnabled
                              ? "text-stone-300 dark:text-stone-600"
                              : "text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
                          )}
                          title={autoRefreshEnabled ? "Refresh" : "Auto-refresh paused"}
                        >
                          <RefreshCw className={classNames("w-3.5 h-3.5", feedLoading && "animate-spin")} />
                          {!autoRefreshEnabled && (
                            <XMark className="w-2.5 h-2.5 absolute -top-0.5 -right-0.5 text-red-500 bg-white dark:bg-stone-900 rounded-full" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  <div data-carousel={category} className="flex gap-3 overflow-x-auto carousel-scroll snap-x snap-mandatory pb-1 px-4 scroll-pl-4">
                    {items.map((item, i) => (
                      <FeedCard
                        key={`${category}-${i}`}
                        item={item}
                        category={category}
                        onClick={() => handleFeedItemClick(item)}
                        lastRefreshed={feed?.lastRefreshed}
                        onQuickSave={() => handleQuickSave(item)}
                        isSaved={savedUrls.has(item.url)}
                        isSaving={savingUrls.has(item.url)}
                        sourceLabel={sourceLabel(item.source)}
                        expirationEnabled={expirationEnabled}
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
              <h2 className="text-sm font-semibold text-stone-600 dark:text-stone-300">
                {filteredItems.length} recipe{filteredItems.length !== 1 ? "s" : ""}
              </h2>
              {feed?.lastRefreshed && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-stone-400 dark:text-stone-500">
                    {timeAgo(feed.lastRefreshed)}
                  </span>
                  <button
                    onClick={() => {
                      if (!autoRefreshEnabled) {
                        setFeedError("Auto-refresh is paused. Enable it in Settings > Display > Discover Feed.");
                        return;
                      }
                      refreshFeed(true);
                    }}
                    disabled={feedLoading}
                    className={classNames(
                      "p-1 relative transition-colors",
                      !autoRefreshEnabled
                        ? "text-stone-300 dark:text-stone-600"
                        : "text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
                    )}
                    title={autoRefreshEnabled ? "Refresh" : "Auto-refresh paused"}
                  >
                    <RefreshCw className={classNames("w-3.5 h-3.5", feedLoading && "animate-spin")} />
                    {!autoRefreshEnabled && (
                      <XMark className="w-2.5 h-2.5 absolute -top-0.5 -right-0.5 text-red-500 bg-white dark:bg-stone-900 rounded-full" />
                    )}
                  </button>
                </div>
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
                    onClick={() => { setSearch(""); setNewOnly(false); setSelectedType(null); setSelectedCuisine(null); setSelectedDiet(null); setSelectedSeason(null); setMaxTime(null); }}
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
                    lastRefreshed={feed?.lastRefreshed}
                    onQuickSave={() => handleQuickSave(item)}
                    isSaved={savedUrls.has(item.url)}
                    isSaving={savingUrls.has(item.url)}
                    sourceLabel={sourceLabel(item.source)}
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
  lastRefreshed,
  onQuickSave,
  isSaved,
  isSaving,
  sourceLabel,
  expirationEnabled,
}: {
  item: DiscoverFeedItem;
  category: DiscoverCategory;
  onClick: () => void;
  lastRefreshed?: string;
  onQuickSave?: () => void;
  isSaved?: boolean;
  isSaving?: boolean;
  sourceLabel: string;
  expirationEnabled?: boolean;
}) {
  const itemIsNew = isNewItem(item, lastRefreshed);
  const itemIsExpiring = !itemIsNew && isExpiringItem(item);
  const expiryDays = daysUntilExpiry(item);
  return (
    <button
      onClick={onClick}
      className="shrink-0 w-44 snap-start text-left rounded-[var(--wk-radius-card)] border border-stone-200 bg-white shadow-sm overflow-hidden transition-all hover:shadow-md active:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:active:bg-stone-800 dark:hover:border-orange-500/30"
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
              {TYPE_LABELS[category]}
            </span>
          </div>
        )}
        {itemIsNew && (
          <div className="absolute top-1.5 left-1.5 p-1 rounded-full bg-orange-500/90 backdrop-blur-sm" title="New recipe">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
        )}
        {itemIsExpiring && (
          <div className="absolute top-1.5 left-1.5 p-1 rounded-full bg-amber-500/90 backdrop-blur-sm" title={expirationEnabled === false ? "Expiration paused" : expiryDays === 0 ? "Expiring today — save to keep" : `Leaving in ${expiryDays}d — save to keep`}>
            <Hourglass className="w-3.5 h-3.5 text-white" />
          </div>
        )}
        {onQuickSave && (
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              if (!isSaved && !isSaving) onQuickSave();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                if (!isSaved && !isSaving) onQuickSave();
              }
            }}
            className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/30 backdrop-blur-sm cursor-pointer"
            title={isSaved ? "Added to recipes" : "Add to recipes"}
          >
            {isSaving ? (
              <LoadingSpinner size="sm" className="w-4 h-4" />
            ) : isSaved ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <Plus className="w-4 h-4 text-white/80" />
            )}
          </div>
        )}
      </div>
      <div className="p-2.5">
        <h4 className="text-xs font-medium line-clamp-2 dark:text-stone-100 leading-snug">
          {item.title}
        </h4>
        <div className="flex items-center justify-between mt-1 text-[10px] text-stone-400 dark:text-stone-500">
          <span className="flex items-center gap-0.5">
            {item.totalTime && item.totalTime > 0 ? (
              <><Clock className="w-3 h-3" /> {formatTime(item.totalTime)}</>
            ) : null}
          </span>
          {item.source && (
            <span className="truncate">{sourceLabel}</span>
          )}
        </div>
      </div>
    </button>
  );
}

