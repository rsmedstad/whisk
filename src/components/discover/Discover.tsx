import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { getSeasonalContext } from "../../lib/seasonal";
import { classNames } from "../../lib/utils";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { TextArea } from "../ui/TextArea";
import { Camera, Sparkles, Tag, ChevronRight } from "../ui/Icon";

interface DiscoverProps {
  visionEnabled?: boolean;
  chatEnabled?: boolean;
}

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

interface RecipeIdea {
  title: string;
  description: string;
  emoji: string;
}

type IdeaCategory = "seasonal" | "quick" | "trending" | "comfort" | "healthy";

const IDEA_TABS: { value: IdeaCategory; label: string; emoji: string }[] = [
  { value: "seasonal", label: "Seasonal", emoji: "\uD83C\uDF3F" },
  { value: "quick", label: "Quick", emoji: "\u26A1" },
  { value: "trending", label: "Trending", emoji: "\uD83D\uDD25" },
  { value: "comfort", label: "Comfort", emoji: "\uD83E\uDEAB" },
  { value: "healthy", label: "Healthy", emoji: "\uD83E\uDD57" },
];

export function Discover({ visionEnabled = false, chatEnabled = false }: DiscoverProps) {
  const navigate = useNavigate();
  const seasonal = getSeasonalContext();

  // -- Deals scanner state --
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [flyerPreview, setFlyerPreview] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [deals, setDeals] = useState<DealScanResult | null>(null);
  const [preferredStores] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("whisk_preferred_stores");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  });

  // -- Recipe ideas state --
  const [ideaCategory, setIdeaCategory] = useState<IdeaCategory>("seasonal");
  const [ideas, setIdeas] = useState<RecipeIdea[]>([]);
  const [isLoadingIdeas, setIsLoadingIdeas] = useState(false);
  const [ideasCache, setIdeasCache] = useState<Record<string, RecipeIdea[]>>({});

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

  // Load ideas on category change
  const loadIdeas = useCallback(async (category: IdeaCategory) => {
    const cached = ideasCache[category];
    if (cached) {
      setIdeas(cached);
      return;
    }

    setIsLoadingIdeas(true);
    try {
      const result = await api.get<{ ideas: RecipeIdea[] }>(
        `/discover/ideas?category=${category}&season=${seasonal.season}`
      );
      const items = result?.ideas ?? [];
      setIdeas(items);
      setIdeasCache((prev) => ({ ...prev, [category]: items }));
    } catch {
      setIdeas([]);
    } finally {
      setIsLoadingIdeas(false);
    }
  }, [seasonal.season, ideasCache]);

  useEffect(() => {
    loadIdeas(ideaCategory);
  }, [ideaCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deals scanner
  const handleFlyerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFlyerPreview(URL.createObjectURL(file));
    setDeals(null);
  };

  const handleScanDeals = async () => {
    if (!fileInputRef.current?.files?.[0]) return;
    setIsScanning(true);
    try {
      const formData = new FormData();
      formData.append("photo", fileInputRef.current.files[0]);

      const token = localStorage.getItem("whisk_token");
      const res = await fetch("/api/discover/scan-deals", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) throw new Error("Scan failed");
      const data = (await res.json()) as DealScanResult;
      setDeals(data);
    } catch {
      setDeals({ deals: [], message: "Failed to scan flyer. Try a clearer photo." });
    } finally {
      setIsScanning(false);
    }
  };

  // Identify photo
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 py-3 pt-[calc(var(--sat)+0.75rem)]">
        <h1 className="text-xl font-bold dark:text-stone-100">Discover</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
          {seasonal.greeting}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {/* ── Deals Scanner ───────────────────────────────── */}
        <section className="px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="w-4 h-4 text-orange-500" />
            <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide">
              Scan Store Deals
            </h2>
          </div>

          {!visionEnabled ? (
            <Card>
              <div className="text-center py-2">
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  Add a vision AI provider in Settings to scan flyers
                </p>
              </div>
            </Card>
          ) : (
            <>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl border-2 border-dashed border-stone-300 dark:border-stone-600 bg-stone-50 dark:bg-stone-900 cursor-pointer overflow-hidden"
              >
                {flyerPreview ? (
                  <img src={flyerPreview} alt="Flyer preview" className="w-full max-h-48 object-cover" />
                ) : (
                  <div className="text-center py-6">
                    <Camera className="w-8 h-8 text-stone-400 dark:text-stone-500 mx-auto" />
                    <p className="mt-1.5 text-sm font-medium text-stone-500 dark:text-stone-400">
                      Photo a store flyer
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500">
                      We'll extract the deals using AI
                    </p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFlyerSelect}
                className="hidden"
              />

              {flyerPreview && (
                <Button
                  fullWidth
                  onClick={handleScanDeals}
                  disabled={isScanning}
                  className="mt-2"
                >
                  {isScanning ? "Scanning deals..." : "Extract Deals"}
                </Button>
              )}

              {/* Deals results */}
              {deals && (
                <div className="mt-3 space-y-2">
                  {deals.storeName && (
                    <p className="text-sm font-semibold dark:text-stone-200">
                      {deals.storeName}
                      {deals.validDates && (
                        <span className="ml-2 text-xs font-normal text-stone-400">
                          {deals.validDates}
                        </span>
                      )}
                    </p>
                  )}
                  {deals.message && deals.deals.length === 0 && (
                    <p className="text-sm text-stone-500 dark:text-stone-400">{deals.message}</p>
                  )}
                  {deals.deals.length > 0 && (
                    <div className="grid grid-cols-1 gap-1.5">
                      {deals.deals.map((deal, i) => (
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
                          <div className="text-right ml-2 flex-shrink-0">
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
                  {deals.deals.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={() => {
                        setDeals(null);
                        setFlyerPreview(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      Scan Another Flyer
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

        {/* ── Recipe Ideas ────────────────────────────────── */}
        <section className="py-4">
          <div className="flex items-center gap-2 mb-3 px-4">
            <Sparkles className="w-4 h-4 text-orange-500" />
            <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide">
              Recipe Ideas
            </h2>
          </div>

          {/* Category tabs */}
          <div className="flex gap-1.5 px-4 mb-3 overflow-x-auto no-scrollbar">
            {IDEA_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setIdeaCategory(tab.value)}
                className={classNames(
                  "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                  ideaCategory === tab.value
                    ? "bg-orange-500 text-white border-orange-500"
                    : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                )}
              >
                {tab.emoji} {tab.label}
              </button>
            ))}
          </div>

          {/* Ideas grid */}
          {isLoadingIdeas ? (
            <div className="grid grid-cols-2 gap-2.5 px-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800 h-28" />
              ))}
            </div>
          ) : ideas.length > 0 ? (
            <div className="grid grid-cols-2 gap-2.5 px-4">
              {ideas.map((idea, i) => (
                <button
                  key={i}
                  onClick={() => {
                    // Navigate to suggest chat with this idea as the starting prompt
                    navigate(`/suggest?q=${encodeURIComponent(idea.title)}`);
                  }}
                  className="rounded-xl bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 p-3 text-left hover:border-orange-300 dark:hover:border-orange-700 transition-colors group"
                >
                  <span className="text-2xl block mb-1">{idea.emoji}</span>
                  <p className="text-sm font-semibold dark:text-stone-200 line-clamp-1 group-hover:text-orange-600 dark:group-hover:text-orange-400">
                    {idea.title}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 mt-0.5">
                    {idea.description}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4">
              <Card>
                <div className="text-center py-2">
                  <p className="text-sm text-stone-500 dark:text-stone-400">
                    {chatEnabled
                      ? "Tap a category to browse recipe ideas"
                      : "Add an AI provider in Settings for recipe ideas"}
                  </p>
                </div>
              </Card>
            </div>
          )}

          {/* Seasonal suggestions */}
          <div className="mt-3 px-4">
            <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
              {seasonal.contextualPrompts.slice(0, 4).map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => navigate(`/suggest?q=${encodeURIComponent(prompt)}`)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300 border border-orange-200 dark:border-orange-800"
                >
                  {prompt}
                  <ChevronRight className="w-3 h-3" />
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="border-t border-stone-200 dark:border-stone-800 mx-4" />

        {/* ── Identify a Dish ─────────────────────────────── */}
        <section className="px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Camera className="w-4 h-4 text-orange-500" />
            <h2 className="text-sm font-semibold text-stone-500 dark:text-orange-300/50 uppercase tracking-wide">
              Identify a Dish
            </h2>
          </div>

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
                <div className="flex items-start gap-2">
                  <Sparkles className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
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
        </section>
      </div>
    </div>
  );
}
