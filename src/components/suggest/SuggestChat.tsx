import { useState, useRef, useEffect, useMemo, useCallback, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Plus, RefreshCw, Dice, WhiskLogo, Leaf, Flower, Sun, Snowflake, Send, MessageCircle, XMark } from "../ui/Icon";
import { SeasonalBrandIcon } from "../ui/SeasonalBrandIcon";
import { classNames } from "../../lib/utils";
import { useKeyboard } from "../../hooks/useKeyboard";
import { getSeasonalContext, buildSeasonalSystemContext, SEASONAL_CATEGORIES } from "../../lib/seasonal";
import type { RecipeIndexEntry } from "../../types";

const SEASON_ICON: Record<string, typeof Leaf> = {
  spring: Flower,
  summer: Sun,
  fall: Leaf,
  winter: Snowflake,
};

const SEASON_ICON_COLOR: Record<string, string> = {
  spring: "text-pink-500 dark:text-pink-400",
  summer: "text-amber-500 dark:text-amber-400",
  fall: "text-orange-600 dark:text-orange-400",
  winter: "text-sky-500 dark:text-sky-400",
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

const PICK_CATEGORIES = [
  { value: "dinner", label: "Dinner", tags: ["dinner"] },
  { value: "any", label: "Any", tags: [] as string[] },
  { value: "breakfast", label: "Breakfast", tags: ["breakfast", "brunch"] },
  { value: "appetizer", label: "Appetizer", tags: ["appetizer"] },
  { value: "side dish", label: "Side Dish", tags: ["side dish", "salad"] },
  { value: "dessert", label: "Dessert", tags: ["dessert", "desserts", "baking"] },
  { value: "drinks", label: "Drinks", tags: ["drinks", "cocktail", "cocktails"] },
  { value: "snack", label: "Snack", tags: ["snack"] },
];

function filterByCategory(recipes: RecipeIndexEntry[], categoryValue: string, seasonValue?: string): RecipeIndexEntry[] {
  let filtered = recipes;

  // Filter by meal type category
  const cat = PICK_CATEGORIES.find((c) => c.value === categoryValue);
  if (cat && cat.tags.length > 0) {
    filtered = filtered.filter((r) =>
      r.tags.some((t) => cat.tags.includes(t.toLowerCase()))
    );
  }

  // Filter by season/holiday if selected
  if (seasonValue && seasonValue !== "") {
    const seasonTags = seasonValue === "current"
      ? ["spring", "summer", "fall", "winter"]
      : [seasonValue];
    const seasonFiltered = filtered.filter((r) =>
      r.tags.some((t) => seasonTags.some((st) => t.toLowerCase().includes(st)))
    );
    // Only apply season filter if it yields results; otherwise keep the full pool
    if (seasonFiltered.length > 0) filtered = seasonFiltered;
  }

  return filtered;
}

interface SuggestChatProps {
  chatEnabled?: boolean;
  recipes?: RecipeIndexEntry[];
}

const URL_REGEX = /https?:\/\/[^\s,)}\]"']+/g;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return [...new Set(matches)].filter((url) => {
    const lower = url.toLowerCase();
    return !lower.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)$/);
  });
}

/** Category icon (inline SVG for small custom icons) */
function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const cn = className ?? "w-3.5 h-3.5";
  switch (category) {
    case "Fruit":
      // Apple (Lucide)
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 6.528V3a1 1 0 0 1 1-1h0" />
          <path d="M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21" />
        </svg>
      );
    case "Vegetables":
      // Carrot (Lucide)
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7zM8.64 14l-2.05-2.04M15.34 15l-2.46-2.46" />
          <path d="M22 9s-1.33-2-3.5-2C16.86 7 15 9 15 9s1.33 2 3.5 2S22 9 22 9z" />
          <path d="M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z" />
        </svg>
      );
    case "Mains":
      // Drumstick (Lucide)
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23" />
          <path d="m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59" />
        </svg>
      );
    case "Sides":
      // Salad bowl (Lucide)
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 21h10" />
          <path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z" />
          <path d="M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1" />
          <path d="m13 12 4-4" />
          <path d="M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2" />
        </svg>
      );
    default:
      return null;
  }
}

export function SuggestChat({ chatEnabled = false, recipes = [] }: SuggestChatProps) {
  const recipeCount = recipes.length;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isKeyboardOpen } = useKeyboard();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pickCategory, setPickCategory] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("whisk_daily_pick") ?? "{}") as { cat?: string };
      return saved.cat ?? "dinner";
    } catch { return "dinner"; }
  });
  const [seasonFilter, setSeasonFilter] = useState<string>("");
  const [pickedRecipe, setPickedRecipe] = useState<RecipeIndexEntry | null>(null);
  const [diceAnimating, setDiceAnimating] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const autoSentRef = useRef(false);
  const autoPickedRef = useRef(false);

  const householdSize = useMemo(() => {
    return parseInt(localStorage.getItem("whisk_household_size") ?? "4", 10);
  }, []);

  const seasonal = useMemo(
    () => getSeasonalContext(new Date(), householdSize),
    [householdSize]
  );

  // Build season/holiday dropdown options
  const seasonOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [
      { value: "", label: "Season" },
      { value: "current", label: `${seasonal.season.charAt(0).toUpperCase() + seasonal.season.slice(1)}` },
    ];
    for (const h of seasonal.upcomingHolidays.slice(0, 3)) {
      options.push({ value: h.name.toLowerCase(), label: h.name });
    }
    return options;
  }, [seasonal]);

  // Get seasonal categories for display
  const categories = useMemo(() => {
    return SEASONAL_CATEGORIES[seasonal.season] ?? [];
  }, [seasonal.season]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isKeyboardOpen]);

  // Auto-send query from URL param (e.g., from Discover card click)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !autoSentRef.current && messages.length === 0) {
      autoSentRef.current = true;
      setSearchParams({}, { replace: true });
      sendMessage(q);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = async (text: string) => {
    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
        },
        body: JSON.stringify({
          messages: [...messages, userMsg],
          seasonalContext: buildSeasonalSystemContext(new Date(), householdSize),
        }),
      });

      if (!res.ok) throw new Error("Failed to get response");
      const data = (await res.json()) as { content: string };
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, AI suggestions aren't available yet. Configure API keys in settings to enable this feature.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    (document.activeElement as HTMLElement | null)?.blur();
    sendMessage(input.trim());
  };

  const handleNewChat = () => {
    setMessages([]);
    autoSentRef.current = false;
  };

  const animateDice = useCallback(() => {
    setDiceAnimating(true);
    setTimeout(() => setDiceAnimating(false), 600);
  }, []);

  const handleRandomPick = useCallback((animate = true) => {
    const pool = filterByCategory(recipes, pickCategory, seasonFilter);
    if (pool.length === 0) return;
    const idx = Math.floor(Math.random() * pool.length);
    const pick = pool[idx] ?? null;
    setPickedRecipe(pick);
    if (animate) animateDice();
    if (pick) {
      localStorage.setItem("whisk_daily_pick", JSON.stringify({
        id: pick.id,
        cat: pickCategory,
        ts: Date.now(),
      }));
    }
  }, [recipes, pickCategory, seasonFilter, animateDice]);

  // Auto-pick on load: restore cached pick or roll a new one
  useEffect(() => {
    if (autoPickedRef.current || recipes.length === 0) return;
    autoPickedRef.current = true;

    try {
      const saved = JSON.parse(localStorage.getItem("whisk_daily_pick") ?? "{}") as {
        id?: string; cat?: string; ts?: number;
      };
      const oneDay = 24 * 60 * 60 * 1000;
      if (saved.id && saved.ts && Date.now() - saved.ts < oneDay) {
        const found = recipes.find((r) => r.id === saved.id);
        if (found) {
          setPickedRecipe(found);
          return;
        }
      }
    } catch { /* ignore */ }

    setTimeout(() => handleRandomPick(true), 300);
  }, [recipes]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col min-h-screen pb-16">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)] wk-header-decor relative">
        <div className="flex items-center justify-between py-3">
          <button onClick={() => navigate("/settings")} title="Settings" className="flex items-center gap-1.5">
            <SeasonalBrandIcon />
            <span className="text-lg font-bold text-orange-500">W</span>
            <span className="text-stone-400 dark:text-stone-500">|</span>
            <h1 className="text-lg font-bold dark:text-stone-100">Suggest</h1>
          </button>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={handleNewChat}
                className="flex items-center gap-1.5 text-xs font-medium text-stone-500 dark:text-stone-400 hover:text-orange-500 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                New chat
              </button>
            )}
            {messages.length === 0 && (
              <button
                onClick={() => {
                  if (chatOpen) {
                    setChatOpen(false);
                    setInput("");
                  } else {
                    setChatOpen(true);
                    setTimeout(() => chatInputRef.current?.focus(), 50);
                  }
                }}
                className={classNames(
                  "p-2 rounded-lg transition-all",
                  chatOpen
                    ? "text-orange-500 ring-1 ring-orange-300 dark:ring-orange-700"
                    : "text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
                )}
                title="Chat with AI"
              >
                {chatOpen ? <XMark className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>
        {/* Collapsible chat input — like search bar pattern */}
        {chatOpen && messages.length === 0 && (
          <div className="pb-2">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={chatInputRef}
                type="text"
                enterKeyHint="send"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="What should I cook?"
                className="flex-1 rounded-[var(--wk-radius-input)] border-[length:var(--wk-border-input)] border-stone-300 bg-stone-50 px-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="rounded-[var(--wk-radius-btn)] bg-orange-500 px-3 py-2 text-white disabled:opacity-40 hover:bg-orange-600 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className={classNames("flex-1 overflow-y-auto px-4 py-4 space-y-4", isKeyboardOpen ? "pb-16" : "pb-24")}
      >
        {/* AI status banner */}
        {!chatEnabled && messages.length === 0 && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              AI suggestions — limited mode
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              Chat requires an AI API key. You can still browse recipes by season and use quick actions below.
            </p>
          </div>
        )}

        {/* Landing state: seasonal info + suggestion + mood */}
        {messages.length === 0 && (
          <>
            {/* What's in Season */}
            <Card>
              <div className="flex items-center gap-2 mb-3">
                {(() => { const SeasonIcon = SEASON_ICON[seasonal.season] ?? Leaf; return <SeasonIcon className={`w-4.5 h-4.5 ${SEASON_ICON_COLOR[seasonal.season] ?? "text-green-600 dark:text-green-400"}`} />; })()}
                <h2 className="text-base font-semibold dark:text-stone-100">
                  What&apos;s in Season
                </h2>
                {seasonal.upcomingHolidays.length > 0 && (
                  <span className="ml-auto inline-flex items-center rounded-full bg-orange-50 dark:bg-orange-950 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
                    {seasonal.upcomingHolidays[0]!.name}
                    {seasonal.upcomingHolidays[0]!.daysAway > 0 && (
                      <span className="ml-1 text-orange-500/70">{seasonal.upcomingHolidays[0]!.daysAway}d</span>
                    )}
                  </span>
                )}
              </div>
              <div className="space-y-2.5">
                {categories.map((cat) => (
                  <div key={cat.label} className="flex items-start gap-2">
                    <CategoryIcon category={cat.label} className="w-4 h-4 text-stone-400 dark:text-stone-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-stone-600 dark:text-stone-300">
                        {cat.label}
                      </p>
                      <p className="text-xs text-stone-400 dark:text-stone-500">
                        {cat.items.join(", ")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Suggestion */}
            {recipeCount > 0 && (
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">
                    Suggestion
                  </p>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={seasonFilter}
                      onChange={(e) => {
                        const newSeason = e.target.value;
                        setSeasonFilter(newSeason);
                        setPickedRecipe(null);
                        setTimeout(() => {
                          const pool = filterByCategory(recipes, pickCategory, newSeason);
                          if (pool.length === 0) return;
                          const idx = Math.floor(Math.random() * pool.length);
                          const pick = pool[idx] ?? null;
                          setPickedRecipe(pick);
                          animateDice();
                          if (pick) {
                            localStorage.setItem("whisk_daily_pick", JSON.stringify({
                              id: pick.id, cat: pickCategory, ts: Date.now(),
                            }));
                          }
                        }, 0);
                      }}
                      className={classNames(
                        "rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2 py-1 text-xs font-medium focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500",
                        seasonFilter ? "text-stone-600 dark:text-stone-300" : "text-stone-400 dark:text-stone-500"
                      )}
                    >
                      {seasonOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <select
                      value={pickCategory}
                      onChange={(e) => {
                        setPickCategory(e.target.value);
                        setPickedRecipe(null);
                        setTimeout(() => {
                          const pool = filterByCategory(recipes, e.target.value, seasonFilter);
                          if (pool.length === 0) return;
                          const idx = Math.floor(Math.random() * pool.length);
                          const pick = pool[idx] ?? null;
                          setPickedRecipe(pick);
                          animateDice();
                          if (pick) {
                            localStorage.setItem("whisk_daily_pick", JSON.stringify({
                              id: pick.id, cat: e.target.value, ts: Date.now(),
                            }));
                          }
                        }, 0);
                      }}
                      className="rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2 py-1 text-xs font-medium text-stone-600 dark:text-stone-300 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    >
                      {PICK_CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {pickedRecipe ? (
                  <button
                    onClick={() => navigate(`/recipes/${pickedRecipe.id}`)}
                    className={classNames(
                      "w-full rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden text-left",
                      "hover:border-orange-300 dark:hover:border-orange-700 transition-colors",
                      diceAnimating && "animate-pulse"
                    )}
                  >
                    {pickedRecipe.thumbnailUrl ? (
                      <div className="relative aspect-[16/9] w-full overflow-hidden bg-stone-100 dark:bg-stone-800">
                        <img
                          src={pickedRecipe.thumbnailUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="aspect-[16/9] w-full bg-stone-100 dark:bg-stone-800" />
                    )}
                    <div className="p-3">
                      <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {pickedRecipe.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {pickedRecipe.tags.length > 0 && (
                          <p className="text-xs text-stone-400 dark:text-stone-500 truncate">
                            {pickedRecipe.tags.slice(0, 3).join(" · ")}
                          </p>
                        )}
                        {(pickedRecipe.prepTime ?? 0) + (pickedRecipe.cookTime ?? 0) > 0 && (
                          <p className="text-xs text-stone-400 dark:text-stone-500 shrink-0">
                            {(pickedRecipe.prepTime ?? 0) + (pickedRecipe.cookTime ?? 0)} min
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ) : (
                  <div className="flex items-center justify-center py-8 text-stone-300 dark:text-stone-600">
                    <p className="text-sm">No {pickCategory !== "any" ? pickCategory : ""} recipes found</p>
                  </div>
                )}

                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => handleRandomPick()}
                    className="flex items-center gap-1.5 text-xs font-medium text-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                  >
                    <Dice className={classNames("w-3.5 h-3.5", diceAnimating && "animate-dice")} />
                    Roll again
                  </button>
                </div>
              </Card>
            )}

            {/* Ask anything */}
            <Card>
              <p className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-1">
                Ask anything
              </p>
              <p className="text-xs text-stone-400 dark:text-stone-500 mb-3">
                {recipeCount > 0
                  ? `Get ideas from your ${recipeCount} recipes, discover new ones, or explore what\u2019s in season for ${seasonal.season}`
                  : `Discover new recipe ideas, explore seasonal cooking for ${seasonal.season}, or get inspiration`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recipeCount > 0 && (
                  <button
                    onClick={() => sendMessage("What should I cook tonight from my recipes?")}
                    className="wk-pill rounded-full border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 px-3 py-1 text-xs text-orange-600 dark:text-orange-400 font-medium hover:border-orange-500 transition-colors"
                  >
                    What should I cook tonight?
                  </button>
                )}
                <button
                  onClick={() => sendMessage(`What ${seasonal.season} recipes should I try?`)}
                  className="rounded-full border border-stone-300 dark:border-stone-600 px-3 py-1 text-xs text-stone-600 dark:text-stone-300 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                >
                  {seasonal.season.charAt(0).toUpperCase() + seasonal.season.slice(1)} ideas
                </button>
                {seasonal.contextualPrompts.slice(0, recipeCount > 0 ? 2 : 3).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="wk-pill rounded-full border border-stone-300 dark:border-stone-600 px-3 py-1 text-xs text-stone-600 dark:text-stone-300 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
                <button
                  onClick={() => sendMessage("Suggest a new recipe I don't have yet")}
                  className="wk-pill rounded-full border border-stone-300 dark:border-stone-600 px-3 py-1 text-xs text-stone-600 dark:text-stone-300 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                >
                  Something new
                </button>
              </div>
              {/* Visible text input for custom prompts */}
              <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
                <input
                  type="text"
                  enterKeyHint="send"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={recipeCount > 0 ? "Ask me anything..." : "What should I cook?"}
                  className="flex-1 rounded-[var(--wk-radius-input)] border-[length:var(--wk-border-input)] border-stone-300 bg-white px-3 py-2 text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="rounded-[var(--wk-radius-btn)] bg-orange-500 px-3 py-2 text-white disabled:opacity-40 hover:bg-orange-600 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </Card>
          </>
        )}

        {/* Messages */}
        {messages.map((msg, i) => {
          const urls = msg.role === "assistant" ? extractUrls(msg.content) : [];
          return (
            <div
              key={i}
              className={
                msg.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-orange-500 text-white"
                    : "bg-stone-100 dark:bg-stone-800 dark:text-stone-200"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {urls.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2 border-t border-stone-200 dark:border-stone-700 pt-2">
                    {urls.map((url) => (
                      <button
                        key={url}
                        onClick={() =>
                          navigate(
                            `/recipes/new?url=${encodeURIComponent(url)}`
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> Save Recipe
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-stone-100 dark:bg-stone-800 rounded-xl px-4 py-2.5">
              <span className="animate-pulse text-sm text-stone-400">
                Thinking...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input — always visible at bottom when in chat mode */}
      {messages.length > 0 && (
        <div className={classNames(
          "sticky left-0 right-0 bg-white dark:bg-stone-950 border-t border-stone-200 dark:border-stone-800 px-4 py-3",
          isKeyboardOpen ? "bottom-0 pb-1" : "bottom-[calc(3.5rem+var(--sab))] pb-3"
        )}>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              enterKeyHint="send"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={recipeCount > 0 ? "Ask me anything..." : "What should I cook?"}
              className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
            />
            <Button type="submit" size="sm" disabled={!input.trim() || isLoading}>
              Send
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
