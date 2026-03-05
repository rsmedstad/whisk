import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getSeasonalContext } from "../../lib/seasonal";
import { classNames } from "../../lib/utils";
import { api } from "../../lib/api";
import { getLocal, setLocal } from "../../lib/cache";
import { Card } from "../ui/Card";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { ChevronRight, RefreshCw } from "../ui/Icon";
import type { InspirationIdea } from "../../types";

interface DiscoverProps {
  chatEnabled?: boolean;
  unsplashEnabled?: boolean;
}

const CATEGORIES = [
  { value: "seasonal", label: "Seasonal" },
  { value: "quick", label: "Quick" },
  { value: "trending", label: "Trending" },
  { value: "comfort", label: "Comfort" },
  { value: "healthy", label: "Healthy" },
] as const;

const CACHE_KEY = "discover_ideas";

interface CachedIdeas {
  ideas: InspirationIdea[];
  category: string;
  season: string;
  fetchedAt: number;
}

export function Discover({ chatEnabled = false, unsplashEnabled = false }: DiscoverProps) {
  const navigate = useNavigate();
  const seasonal = getSeasonalContext();

  const [category, setCategory] = useState("seasonal");
  const [ideas, setIdeas] = useState<InspirationIdea[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadIdeas = useCallback(async (cat: string, forceRefresh = false) => {
    // Check local cache (valid for 1 day to reduce API calls)
    if (!forceRefresh) {
      const cached = getLocal<CachedIdeas>(`${CACHE_KEY}:${cat}`);
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
        category: cat,
        season: seasonal.season,
        ...(forceRefresh ? { refresh: "1" } : {}),
      });
      const data = await api.get<{ ideas: InspirationIdea[] }>(
        `/discover/ideas?${params.toString()}`
      );
      if (data?.ideas) {
        setIdeas(data.ideas);
        setLocal<CachedIdeas>(`${CACHE_KEY}:${cat}`, {
          ideas: data.ideas,
          category: cat,
          season: seasonal.season,
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
    loadIdeas(category);
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleIdeaClick = (idea: InspirationIdea) => {
    const prompt = `I'd like to make ${idea.title}. ${idea.description} Can you give me a detailed recipe?`;
    navigate(`/suggest?q=${encodeURIComponent(prompt)}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
        <div className="flex items-center justify-between py-3">
          <h1 className="text-xl font-bold dark:text-stone-100">Discover</h1>
          <button
            onClick={() => loadIdeas(category, true)}
            className="p-2 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 transition-colors"
            title="Refresh ideas"
          >
            <RefreshCw className={classNames("w-4.5 h-4.5", isLoading && "animate-spin")} />
          </button>
        </div>

        {/* Seasonal greeting */}
        <p className="text-sm text-stone-500 dark:text-stone-400 pb-2">
          {seasonal.greeting}
        </p>

        {/* Category pills */}
        <div className="flex gap-1.5 pb-3 overflow-x-auto no-scrollbar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={classNames(
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                category === cat.value
                  ? "bg-orange-500 text-white border-orange-500"
                  : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
              )}
            >
              {cat.label}
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

            {/* Seasonal prompt chips */}
            {chatEnabled && seasonal.contextualPrompts.length > 0 && (
              <div className="px-4 pb-4">
                <p className="text-xs font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-2">
                  Or ask about...
                </p>
                <div className="flex flex-wrap gap-2">
                  {seasonal.contextualPrompts.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => navigate(`/suggest?q=${encodeURIComponent(prompt)}`)}
                      className="px-3 py-2 rounded-full text-xs font-medium bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400 border border-stone-200 dark:border-stone-700 transition-colors hover:border-orange-400"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
