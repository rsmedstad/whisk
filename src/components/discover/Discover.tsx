import { useState, useEffect, useCallback } from "react";
import { getSeasonalContext } from "../../lib/seasonal";
import { classNames } from "../../lib/utils";
import { api } from "../../lib/api";
import { getLocal, setLocal } from "../../lib/cache";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { ChevronLeft, ChevronRight, RefreshCw, Plus, Clock, Users } from "../ui/Icon";
import type { InspirationIdea, Recipe, Ingredient, Step } from "../../types";

interface DiscoverProps {
  chatEnabled?: boolean;
  unsplashEnabled?: boolean;
  onSaveRecipe?: (recipe: Omit<Recipe, "id" | "createdAt" | "updatedAt">) => Promise<Recipe>;
}

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

export function Discover({ chatEnabled = false, unsplashEnabled = false, onSaveRecipe }: DiscoverProps) {
  const seasonal = getSeasonalContext();

  const [mealType, setMealType] = useState("all");
  const [vibe, setVibe] = useState("seasonal");
  const [ideas, setIdeas] = useState<InspirationIdea[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail view state
  const [selectedIdea, setSelectedIdea] = useState<InspirationIdea | null>(null);
  const [generatedRecipe, setGeneratedRecipe] = useState<GeneratedRecipe | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);

  const loadIdeas = useCallback(async (mt: string, v: string, forceRefresh = false) => {
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
  }, [seasonal.season]);

  useEffect(() => {
    loadIdeas(mealType, vibe);
  }, [mealType, vibe]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleIdeaClick = async (idea: InspirationIdea) => {
    setSelectedIdea(idea);
    setGeneratedRecipe(null);
    setGenerateError(null);
    setSavedRecipeId(null);

    if (!chatEnabled) return;

    setIsGenerating(true);
    try {
      const data = await api.post<{ recipe: GeneratedRecipe }>("/discover/recipe", {
        title: idea.title,
        description: idea.description,
      });
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
      const ingredients: Ingredient[] = generatedRecipe.ingredients.map((ing) => ({
        name: ing.name,
        amount: ing.amount,
        unit: ing.unit,
      }));
      const steps: Step[] = generatedRecipe.steps.map((s) => ({ text: s.text }));
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

  // ── Detail view ──
  if (selectedIdea) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
          <div className="flex items-center gap-3 py-3">
            <button onClick={handleBack} className="p-1 -ml-1 text-stone-500 dark:text-stone-400">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold dark:text-stone-100 truncate">{selectedIdea.title}</h1>
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
              <span className="text-5xl">{(selectedIdea as { emoji?: string }).emoji ?? "🍽️"}</span>
            </div>
          )}

          {/* Description */}
          <div className="px-4 py-4">
            <p className="text-sm text-stone-600 dark:text-stone-400">{selectedIdea.description}</p>
          </div>

          {/* Recipe content */}
          <div className="px-4 space-y-4">
            {isGenerating && (
              <LoadingSpinner className="py-12" size="lg" />
            )}

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
                  <h2 className="text-sm font-semibold dark:text-stone-100 mb-2">Ingredients</h2>
                  <ul className="space-y-1.5">
                    {generatedRecipe.ingredients.map((ing, i) => (
                      <li key={i} className="text-sm dark:text-stone-300 flex gap-2">
                        <span className="text-stone-400 dark:text-stone-500 shrink-0">
                          {[ing.amount, ing.unit].filter(Boolean).join(" ") || "•"}
                        </span>
                        <span>{ing.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Steps */}
                <div>
                  <h2 className="text-sm font-semibold dark:text-stone-100 mb-2">Instructions</h2>
                  <ol className="space-y-3">
                    {generatedRecipe.steps.map((step, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400 flex items-center justify-center text-xs font-medium">
                          {i + 1}
                        </span>
                        <p className="dark:text-stone-300 flex-1">{step.text}</p>
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

  // ── Grid view ──
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
        <div className="flex items-center justify-between py-3">
          <h1 className="text-xl font-bold dark:text-stone-100">Discover</h1>
          <button
            onClick={() => loadIdeas(mealType, vibe, true)}
            className="p-2 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 transition-colors"
            title="Refresh ideas"
          >
            <RefreshCw className={classNames("w-4.5 h-4.5", isLoading && "animate-spin")} />
          </button>
        </div>

        {/* Seasonal context */}
        <p className="text-sm text-stone-500 dark:text-stone-400 pb-2">
          {seasonal.greeting}
          {seasonal.upcomingHolidays.length > 0 && (
            <span className="ml-1.5 text-orange-500 dark:text-orange-400">
              {seasonal.upcomingHolidays.slice(0, 2).map((h) => h.name).join(", ")}
              {seasonal.upcomingHolidays[0] && seasonal.upcomingHolidays[0].daysAway > 0 && (
                <span className="text-stone-400 dark:text-stone-500 ml-1">
                  in {seasonal.upcomingHolidays[0].daysAway}d
                </span>
              )}
            </span>
          )}
        </p>

        {/* Meal type pills */}
        <div className="flex gap-1.5 pb-2">
          {MEAL_TYPES.map((mt) => (
            <button
              key={mt.value}
              onClick={() => setMealType(mt.value)}
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

        {/* Vibe pills */}
        <div className="flex gap-1.5 pb-3 overflow-x-auto no-scrollbar">
          {VIBES.map((v) => (
            <button
              key={v.value}
              onClick={() => setVibe(v.value)}
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
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-24">
        {isLoading && ideas.length === 0 ? (
          <LoadingSpinner className="py-20" size="lg" />
        ) : error && ideas.length === 0 ? (
          <div className="px-4 py-12">
            <Card>
              <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-4">
                {error}
              </p>
            </Card>
          </div>
        ) : (
          <>
            {/* Ideas grid */}
            <div className="grid grid-cols-2 gap-3 px-4 py-4">
              {ideas.map((idea, i) => (
                <button
                  key={`${idea.title}-${i}`}
                  onClick={() => handleIdeaClick(idea)}
                  className="wk-card flex w-full flex-col overflow-hidden rounded-[var(--wk-radius-card)] border-[length:var(--wk-border-card)] border-stone-200 bg-white text-left shadow-[var(--wk-shadow-card)] transition-all hover:shadow-[var(--wk-shadow-card-hover)] active:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:active:bg-stone-800 dark:hover:border-orange-500/30"
                >
                  {/* Image */}
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
                        <span className="text-3xl">{(idea as { emoji?: string }).emoji ?? "🍽️"}</span>
                      </div>
                    )}
                    {/* Explore arrow */}
                    <div className="absolute bottom-1.5 right-1.5 p-1 rounded-full bg-black/30 backdrop-blur-sm">
                      <ChevronRight className="w-3.5 h-3.5 text-white/80" />
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <h3 className="font-semibold text-sm line-clamp-2 dark:text-stone-100">
                      {idea.title}
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 mt-0.5">
                      {idea.description}
                    </p>
                  </div>

                  {/* Unsplash attribution */}
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

            {/* No AI banner */}
            {!chatEnabled && !unsplashEnabled && (
              <div className="px-4 pb-4">
                <Card>
                  <div className="text-center py-2">
                    <p className="text-sm text-stone-500 dark:text-stone-400">
                      Add an AI provider in Settings for personalized recipe ideas
                    </p>
                  </div>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
