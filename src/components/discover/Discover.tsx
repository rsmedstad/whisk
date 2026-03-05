import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useRecipes } from "../../hooks/useRecipes";
import { getSeasonalContext } from "../../lib/seasonal";
import { classNames } from "../../lib/utils";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { TextArea } from "../ui/TextArea";
import { Camera, Tag, ChevronDown, Link, Plus, Check } from "../ui/Icon";

interface DiscoverProps {
  visionEnabled?: boolean;
  chatEnabled?: boolean;
}

// ── TheMealDB types ────────────────────────────────────────

interface MealSummary {
  idMeal: string;
  strMeal: string;
  strMealThumb: string;
}

interface MealFull {
  idMeal: string;
  strMeal: string;
  strMealThumb: string;
  strCategory: string;
  strArea: string;
  strInstructions: string;
  strTags: string | null;
  strYoutube: string | null;
  [key: string]: unknown;
}

const MEALDB_BASE = "https://www.themealdb.com/api/json/v1/1";

const BROWSE_TABS = [
  { value: "Chicken", label: "Chicken" },
  { value: "Seafood", label: "Seafood" },
  { value: "Pasta", label: "Pasta" },
  { value: "Beef", label: "Beef" },
  { value: "Dessert", label: "Dessert" },
  { value: "Vegetarian", label: "Vegetarian" },
  { value: "Breakfast", label: "Breakfast" },
  { value: "Side", label: "Sides" },
  { value: "Starter", label: "Starters" },
  { value: "Vegan", label: "Vegan" },
] as const;

// ── TheMealDB → Whisk converter ────────────────────────────

function parseMealIngredients(meal: MealFull) {
  const ingredients: { name: string; amount?: string; unit?: string }[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = (meal[`strIngredient${i}`] as string | null)?.trim();
    const measure = (meal[`strMeasure${i}`] as string | null)?.trim();
    if (!name) break;
    // Try to split measure into amount + unit
    const match = measure?.match(
      /^([\d\s/½⅓⅔¼¾⅛⅜⅝⅞.]+)\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|liters?|cloves?|cans?|pieces?|slices?|sticks?|pinche?s?|dashes?|bunch|head|sprig)?\s*(.*)/i
    );
    if (match?.[1]) {
      ingredients.push({
        amount: match[1].trim(),
        unit: match[2]?.trim() || undefined,
        name: match[3] ? `${match[3].trim()} ${name}`.trim() : name,
      });
    } else {
      ingredients.push({
        name: measure ? `${measure} ${name}` : name,
      });
    }
  }
  return ingredients;
}

function parseMealSteps(instructions: string) {
  // Split on numbered steps, "STEP N", or double newlines
  const raw = instructions
    .split(/(?:STEP\s*\d+\s*\n?|\r?\n\r?\n|\d+\.\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
  return raw.map((text) => ({ text }));
}

// ── Deals types ─────────────────────────────────────────────

interface Deal {
  item: string;
  price: string;
  originalPrice?: string | null;
  unit?: string | null;
  category: string;
  notes?: string | null;
}

interface DealScanResult {
  deals: Deal[];
  storeName?: string | null;
  validDates?: string | null;
  message?: string;
}

// ── Component ───────────────────────────────────────────────

export function Discover({ visionEnabled = false, chatEnabled = false }: DiscoverProps) {
  const navigate = useNavigate();
  const { createRecipe } = useRecipes();
  const seasonal = getSeasonalContext();

  // -- Browse state --
  const [browseCategory, setBrowseCategory] = useState("Chicken");
  const [meals, setMeals] = useState<MealSummary[]>([]);
  const [isLoadingMeals, setIsLoadingMeals] = useState(false);
  const [mealsCache, setMealsCache] = useState<Record<string, MealSummary[]>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // -- Deals scanner state --
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [flyerPreview, setFlyerPreview] = useState<string | null>(null);
  const [dealUrl, setDealUrl] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [allDeals, setAllDeals] = useState<Deal[]>([]);
  const [dealsMeta, setDealsMeta] = useState<{ storeName?: string | null; validDates?: string | null } | null>(null);
  const [dealsMessage, setDealsMessage] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [preferredStores] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("whisk_preferred_stores");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  });

  // -- Identify state --
  const identifyFileRef = useRef<HTMLInputElement>(null);
  const [identifyPreview, setIdentifyPreview] = useState<string | null>(null);
  const [identifyContext, setIdentifyContext] = useState("");
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [identifyResult, setIdentifyResult] = useState<{
    title: string;
    confidence: string;
    ingredients: string[];
  } | null>(null);
  const [showIdentify, setShowIdentify] = useState(false);

  // ── TheMealDB fetching ──────────────────────────────────

  const loadMeals = useCallback(async (category: string) => {
    const cached = mealsCache[category];
    if (cached) {
      setMeals(cached);
      return;
    }
    setIsLoadingMeals(true);
    try {
      const res = await fetch(`${MEALDB_BASE}/filter.php?c=${category}`);
      const data = (await res.json()) as { meals: MealSummary[] | null };
      const items = data.meals ?? [];
      // Shuffle for variety
      const shuffled = items.sort(() => Math.random() - 0.5).slice(0, 20);
      setMeals(shuffled);
      setMealsCache((prev) => ({ ...prev, [category]: shuffled }));
    } catch {
      setMeals([]);
    } finally {
      setIsLoadingMeals(false);
    }
  }, [mealsCache]);

  useEffect(() => {
    loadMeals(browseCategory);
  }, [browseCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveRecipe = async (meal: MealSummary) => {
    if (savingIds.has(meal.idMeal) || savedIds.has(meal.idMeal)) return;
    setSavingIds((prev) => new Set(prev).add(meal.idMeal));
    try {
      // Fetch full recipe details
      const res = await fetch(`${MEALDB_BASE}/lookup.php?i=${meal.idMeal}`);
      const data = (await res.json()) as { meals: MealFull[] | null };
      const full = data.meals?.[0];
      if (!full) throw new Error("Recipe not found");

      const ingredients = parseMealIngredients(full);
      const steps = parseMealSteps(full.strInstructions);
      const tags: string[] = [];
      // Map TheMealDB category to our tags
      const catLower = full.strCategory?.toLowerCase();
      if (catLower === "breakfast") tags.push("breakfast");
      else if (catLower === "dessert") tags.push("dessert");
      else if (catLower === "starter") tags.push("appetizer");
      else if (catLower === "side") tags.push("side dish");
      else tags.push("dinner");
      if (catLower === "vegan") tags.push("vegan");
      if (catLower === "vegetarian") tags.push("vegetarian");
      if (full.strArea) tags.push(full.strArea.toLowerCase());

      await createRecipe({
        title: full.strMeal,
        description: "",
        ingredients,
        steps,
        tags,
        cuisine: full.strArea ?? "",
        favorite: false,
        photos: [{ url: full.strMealThumb, isPrimary: true }],
        thumbnailUrl: full.strMealThumb,
        videoUrl: full.strYoutube ?? undefined,
        notes: "",
        source: { type: "url" as const, url: `https://www.themealdb.com/meal/${full.idMeal}`, domain: "themealdb.com" },
      });

      setSavedIds((prev) => new Set(prev).add(meal.idMeal));
    } catch {
      // Silent fail
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(meal.idMeal);
        return next;
      });
    }
  };

  // ── Deals scanner handlers ──────────────────────────────

  const handleFlyerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFlyerPreview(URL.createObjectURL(file));
    setDealUrl("");
  };

  const handleScanDeals = async () => {
    const hasPhoto = fileInputRef.current?.files?.[0];
    const hasUrl = dealUrl.trim();
    if (!hasPhoto && !hasUrl) return;

    setIsScanning(true);
    try {
      const formData = new FormData();
      if (hasPhoto) {
        formData.append("photo", fileInputRef.current!.files![0]!);
      } else {
        formData.append("url", hasUrl);
      }

      const token = localStorage.getItem("whisk_token");
      const res = await fetch("/api/discover/scan-deals", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) throw new Error("Scan failed");
      const data = (await res.json()) as DealScanResult;

      setAllDeals((prev) => [...prev, ...data.deals]);
      if (data.storeName || data.validDates) {
        setDealsMeta((prev) => prev ?? { storeName: data.storeName, validDates: data.validDates });
      }
      if (data.deals.length === 0 && data.message) {
        setDealsMessage(data.message);
      } else {
        setDealsMessage(null);
      }
      setPageCount((n) => n + 1);

      setFlyerPreview(null);
      setDealUrl("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setDealsMessage("Failed to scan. Try a clearer image or different URL.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleResetDeals = () => {
    setAllDeals([]);
    setDealsMeta(null);
    setDealsMessage(null);
    setPageCount(0);
    setFlyerPreview(null);
    setDealUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Identify handlers ───────────────────────────────────

  const handleIdentifyFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIdentifyPreview(URL.createObjectURL(file));
    setIdentifyResult(null);
  };

  const handleIdentify = async () => {
    if (!identifyFileRef.current?.files?.[0]) return;
    setIsIdentifying(true);
    try {
      const formData = new FormData();
      formData.append("photo", identifyFileRef.current.files[0]);
      if (identifyContext.trim()) formData.append("context", identifyContext.trim());

      const token = localStorage.getItem("whisk_token");
      const res = await fetch("/api/identify/photo", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) throw new Error("Identification failed");
      const data = (await res.json()) as { title: string; confidence: string; ingredients: string[] };
      setIdentifyResult(data);
    } catch {
      setIdentifyResult({ title: "Could not identify", confidence: "Low", ingredients: [] });
    } finally {
      setIsIdentifying(false);
    }
  };

  const hasInput = flyerPreview || dealUrl.trim();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
        <div className="flex items-center justify-between py-3">
          <h1 className="text-xl font-bold dark:text-stone-100">Discover</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {/* ── Browse Recipes (TheMealDB) ──────────────────── */}
        <section className="py-4">
          <div className="flex items-center gap-2 mb-3 px-4">
            <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
              Browse Recipes
            </h2>
          </div>

          {/* Category tabs */}
          <div className="flex gap-1.5 px-4 mb-3 overflow-x-auto no-scrollbar">
            {BROWSE_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setBrowseCategory(tab.value)}
                className={classNames(
                  "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                  browseCategory === tab.value
                    ? "bg-orange-500 text-white border-orange-500"
                    : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Meals grid */}
          {isLoadingMeals ? (
            <div className="grid grid-cols-2 gap-3 px-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800 aspect-3/2" />
              ))}
            </div>
          ) : meals.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 px-4">
              {meals.map((meal) => {
                const isSaving = savingIds.has(meal.idMeal);
                const isSaved = savedIds.has(meal.idMeal);
                return (
                  <button
                    key={meal.idMeal}
                    onClick={() => handleSaveRecipe(meal)}
                    className="wk-card flex w-full flex-col overflow-hidden rounded-[var(--wk-radius-card)] border-[length:var(--wk-border-card)] border-stone-200 bg-white text-left shadow-[var(--wk-shadow-card)] transition-all hover:shadow-[var(--wk-shadow-card-hover)] active:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:active:bg-stone-800 dark:hover:border-orange-500/30"
                  >
                    <div className="relative aspect-3/2 w-full overflow-hidden bg-stone-100 dark:bg-stone-800">
                      <img
                        src={`${meal.strMealThumb}/preview`}
                        alt={meal.strMeal}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      {/* Save indicator */}
                      <div
                        className={classNames(
                          "absolute top-1.5 right-1.5 p-1.5 rounded-full backdrop-blur-sm transition-colors",
                          isSaved
                            ? "bg-green-500"
                            : isSaving
                              ? "bg-orange-500 animate-pulse"
                              : "bg-black/30"
                        )}
                      >
                        {isSaved ? (
                          <Check className="w-4 h-4 text-white" />
                        ) : (
                          <Plus className="w-4 h-4 text-white/80" />
                        )}
                      </div>
                    </div>
                    <div className="p-2.5">
                      <h3 className="font-semibold text-sm line-clamp-2 dark:text-stone-100">
                        {meal.strMeal}
                      </h3>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4">
              <Card>
                <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-2">
                  No recipes found
                </p>
              </Card>
            </div>
          )}

          {/* Seasonal suggestions (keep AI prompts if chat enabled) */}
          {chatEnabled && seasonal.contextualPrompts.length > 0 && (
            <div className="mt-4 px-4">
              <p className="text-xs font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-2">
                Seasonal ideas
              </p>
              <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                {seasonal.contextualPrompts.slice(0, 4).map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => navigate(`/suggest?q=${encodeURIComponent(prompt)}`)}
                    className="px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400 border border-stone-200 dark:border-stone-700"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="border-t border-stone-200 dark:border-stone-800 mx-4" />

        {/* ── Deals Scanner ───────────────────────────────── */}
        <section className="px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="w-4 h-4 text-stone-400 dark:text-stone-500" />
            <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
              Scan Store Deals
            </h2>
          </div>

          {!visionEnabled && !chatEnabled ? (
            <Card>
              <div className="text-center py-2">
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  Add an AI provider in Settings to scan deals
                </p>
              </div>
            </Card>
          ) : (
            <>
              {/* URL input */}
              <div className="flex gap-2 mb-2">
                <div className="relative flex-1">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                  <input
                    type="url"
                    value={dealUrl}
                    onChange={(e) => {
                      setDealUrl(e.target.value);
                      if (e.target.value.trim()) setFlyerPreview(null);
                    }}
                    placeholder="Paste store ad URL..."
                    className="w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
                  />
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 p-2 text-stone-500 dark:text-stone-400 hover:border-orange-400"
                  title="Upload screenshot or photo"
                >
                  <Camera className="w-5 h-5" />
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFlyerSelect}
                className="hidden"
              />

              {/* Photo preview */}
              {flyerPreview && (
                <div className="rounded-xl border border-stone-200 dark:border-stone-700 overflow-hidden mb-2">
                  <img src={flyerPreview} alt="Flyer preview" className="w-full max-h-48 object-cover" />
                </div>
              )}

              {/* Scan button */}
              {hasInput && (
                <Button
                  fullWidth
                  onClick={handleScanDeals}
                  disabled={isScanning}
                >
                  {isScanning
                    ? "Scanning deals..."
                    : pageCount > 0
                      ? `Scan Page ${pageCount + 1}`
                      : "Extract Deals"}
                </Button>
              )}

              {/* Accumulated deals results */}
              {(allDeals.length > 0 || dealsMessage) && (
                <div className="mt-3 space-y-2">
                  {dealsMeta?.storeName && (
                    <p className="text-sm font-semibold dark:text-stone-200">
                      {dealsMeta.storeName}
                      {dealsMeta.validDates && (
                        <span className="ml-2 text-xs font-normal text-stone-400">
                          {dealsMeta.validDates}
                        </span>
                      )}
                    </p>
                  )}
                  {pageCount > 1 && (
                    <p className="text-xs text-stone-400 dark:text-stone-500">
                      {allDeals.length} deals from {pageCount} pages
                    </p>
                  )}
                  {dealsMessage && allDeals.length === 0 && (
                    <p className="text-sm text-stone-500 dark:text-stone-400">{dealsMessage}</p>
                  )}
                  {allDeals.length > 0 && (
                    <div className="grid grid-cols-1 gap-1.5">
                      {allDeals.map((deal, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-stone-50 dark:bg-stone-900"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium dark:text-stone-200 truncate">
                              {deal.item}
                            </p>
                            {deal.notes && (
                              <p className="text-[10px] text-stone-400 truncate">{deal.notes}</p>
                            )}
                          </div>
                          <div className="text-right ml-2 shrink-0">
                            <p className="text-sm font-bold text-orange-600 dark:text-orange-400">
                              {deal.price}
                            </p>
                            {deal.originalPrice && (
                              <p className="text-[10px] line-through text-stone-400">{deal.originalPrice}</p>
                            )}
                            {deal.unit && (
                              <p className="text-[10px] text-stone-400">{deal.unit}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {allDeals.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={handleResetDeals}
                    >
                      Start Over
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Quick store links */}
          {preferredStores.length > 0 && (
            <div className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar">
              {preferredStores.map((store) => (
                <span
                  key={store}
                  className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                >
                  {store}
                </span>
              ))}
            </div>
          )}
        </section>

        <div className="border-t border-stone-200 dark:border-stone-800 mx-4" />

        {/* ── Identify a Dish (collapsed by default) ─────── */}
        <section className="px-4 py-4">
          <button
            onClick={() => setShowIdentify(!showIdentify)}
            className="flex items-center gap-2 w-full"
          >
            <Camera className="w-4 h-4 text-stone-400 dark:text-stone-500" />
            <h2 className="text-sm font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide">
              Identify a Dish
            </h2>
            <ChevronDown
              className={classNames(
                "w-4 h-4 text-stone-400 ml-auto transition-transform",
                showIdentify && "rotate-180"
              )}
            />
          </button>

          {showIdentify && (
            <div className="mt-3">
              {!visionEnabled && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 mb-3">
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Add a vision API key in Settings to enable photo identification.
                  </p>
                </div>
              )}

              <div
                onClick={() => identifyFileRef.current?.click()}
                className="aspect-video rounded-xl border-2 border-dashed border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 flex flex-col items-center justify-center cursor-pointer overflow-hidden"
              >
                {identifyPreview ? (
                  <img src={identifyPreview} alt="Preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-center">
                    <Camera className="w-8 h-8 text-stone-400 dark:text-stone-500 mx-auto" />
                    <p className="mt-1.5 text-sm font-medium text-stone-500 dark:text-stone-400">
                      Snap a photo of any dish
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500">
                      AI will identify it and suggest a recipe
                    </p>
                  </div>
                )}
              </div>
              <input
                ref={identifyFileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleIdentifyFile}
                className="hidden"
              />

              {identifyPreview && !identifyResult && (
                <div className="mt-2 space-y-2">
                  <TextArea
                    label="Add context (optional)"
                    value={identifyContext}
                    onChange={(e) => setIdentifyContext(e.target.value)}
                    placeholder="&quot;My mom's pot roast, about 6 servings&quot;"
                    rows={2}
                  />
                  <Button fullWidth onClick={handleIdentify} disabled={isIdentifying}>
                    {isIdentifying ? "Identifying..." : "Identify This"}
                  </Button>
                </div>
              )}

              {identifyResult && (
                <Card className="mt-3">
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        This looks like:
                      </p>
                      <h3 className="text-lg font-bold dark:text-stone-100">
                        {identifyResult.title}
                      </h3>
                      <p className="text-xs text-stone-400">
                        Confidence: {identifyResult.confidence}
                      </p>
                    </div>

                    {identifyResult.ingredients.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-stone-600 dark:text-stone-300 mb-1">
                          Detected ingredients:
                        </p>
                        <ul className="space-y-0.5">
                          {identifyResult.ingredients.map((ing, i) => (
                            <li key={i} className="text-sm text-stone-600 dark:text-stone-400 flex gap-1.5 items-center">
                              <span className="w-1 h-1 rounded-full bg-stone-400 shrink-0" /> {ing}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const params = new URLSearchParams({
                            title: identifyResult.title,
                            ingredients: identifyResult.ingredients.join(","),
                          });
                          navigate(`/recipes/new?${params.toString()}`);
                        }}
                      >
                        Save as Recipe
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setIdentifyResult(null);
                          setIdentifyPreview(null);
                        }}
                      >
                        Try Again
                      </Button>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
