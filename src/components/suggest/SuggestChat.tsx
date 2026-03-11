import { useState, useRef, useEffect, useMemo, useCallback, type FormEvent, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "../ui/Card";
import { Plus, RefreshCw, Dice, WhiskLogo, Send, CalendarDays, ShoppingCart, BookOpen, Sparkles, MessageCircle, ChevronDown, Check, MagnifyingGlass, XMark } from "../ui/Icon";
import type { IconProps } from "../ui/Icon";
import { SeasonalBrandIcon } from "../ui/SeasonalBrandIcon";
import { SeasonalProduceCard } from "../ui/SeasonalProduceCard";
import { classNames } from "../../lib/utils";
import { useKeyboard } from "../../hooks/useKeyboard";
import { getSeasonalContext, buildSeasonalSystemContext } from "../../lib/seasonal";
import type { RecipeIndexEntry, PlannedMeal, ShoppingItem, UserPreferences, MealSlot, DiscoverFeedItem } from "../../types";
import { toDateString, normalizeSearch } from "../../lib/utils";


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

  // Exclude drinks unless user explicitly selected the Drinks category
  if (categoryValue !== "drinks") {
    const drinkTags = new Set(["drinks", "cocktail", "cocktails", "drink", "beverage", "beverages"]);
    filtered = filtered.filter((r) =>
      !r.tags.some((t) => drinkTags.has(t.toLowerCase()))
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
  mealPlan?: PlannedMeal[];
  shoppingList?: ShoppingItem[];
  preferences?: UserPreferences;
  onAddMeal?: (date: Date, slot: MealSlot, title: string, recipeId?: string) => Promise<void>;
  onAddToList?: (name: string) => void;
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


/** Tappable quick-action pill for the Ask landing state — styled as chat prompts */
function QuickAction({ icon: Icon, label, onClick }: {
  icon: ComponentType<IconProps>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full bg-orange-500 dark:bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-orange-600 dark:hover:bg-orange-500 active:scale-95 transition-all"
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

// Parse action markers from AI responses
const ACTION_REGEX = /\[(ADD_TO_PLAN|ADD_TO_LIST|SEARCH_RECIPES|RECIPE_CARD|SAVE_RECIPE):\s*([^\]]+)\]/g;

type ActionType = "ADD_TO_PLAN" | "ADD_TO_LIST" | "SEARCH_RECIPES" | "RECIPE_CARD" | "SAVE_RECIPE";

interface ParsedAction {
  type: ActionType;
  raw: string;
  params: string;
}

function parseActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = [];
  let match;
  const regex = new RegExp(ACTION_REGEX.source, "g");
  while ((match = regex.exec(text)) !== null) {
    actions.push({
      type: match[1] as ParsedAction["type"],
      raw: match[0],
      params: match[2] ?? "",
    });
  }
  return actions;
}

function stripActionMarkers(text: string): string {
  return text.replace(ACTION_REGEX, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function SuggestChat({ chatEnabled = false, recipes = [], mealPlan = [], shoppingList = [], preferences, onAddMeal, onAddToList }: SuggestChatProps) {
  const recipeCount = recipes.length;
  const navigate = useNavigate();

  // Load discover items from localStorage cache for combined search
  const discoverItems = useMemo(() => {
    try {
      const raw = localStorage.getItem("whisk_cache_discover_feed");
      if (!raw) return [] as DiscoverFeedItem[];
      const cached = JSON.parse(raw) as { data?: { categories?: Record<string, DiscoverFeedItem[]> } };
      const feed = cached.data;
      if (!feed?.categories) return [] as DiscoverFeedItem[];
      return Object.values(feed.categories).flat();
    } catch { return [] as DiscoverFeedItem[]; }
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  const { isKeyboardOpen } = useKeyboard();
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem("whisk_ask_messages");
      if (saved) {
        const parsed = JSON.parse(saved) as Message[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(-30);
      }
    } catch { /* ignore */ }
    return [];
  });
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
  const [openDropdown, setOpenDropdown] = useState<"season" | "category" | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; right?: number }>({ top: 0, left: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const autoSentRef = useRef(false);
  const autoPickedRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

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

  // Combined search across recipes + discover
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return { recipes: [] as RecipeIndexEntry[], discover: [] as DiscoverFeedItem[] };
    const q = normalizeSearch(searchQuery);
    const matchedRecipes = recipes.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q)) ||
      r.cuisine?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q)
    ).slice(0, 8);
    const matchedDiscover = discoverItems.filter((d) =>
      d.title.toLowerCase().includes(q) ||
      (d.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
      d.description?.toLowerCase().includes(q)
    ).slice(0, 8);
    return { recipes: matchedRecipes, discover: matchedDiscover };
  }, [searchQuery, recipes, discoverItems]);


  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading, isKeyboardOpen]);

  // Persist messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem("whisk_ask_messages", JSON.stringify(messages.slice(-30)));
    } else {
      localStorage.removeItem("whisk_ask_messages");
    }
  }, [messages]);

  // Recover orphaned user messages — if the last message is from the user
  // (e.g., user navigated away before the AI response arrived), auto-retry
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (recoveredRef.current) return;
    const last = messages[messages.length - 1];
    if (messages.length > 0 && last?.role === "user" && !isLoading && chatEnabled) {
      recoveredRef.current = true;
      sendMessage(last.content, true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-send query from URL param (e.g., from Discover card click)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !autoSentRef.current) {
      autoSentRef.current = true;
      setSearchParams({}, { replace: true });
      // Start a fresh conversation with this query
      setMessages([]);
      sendMessage(q);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = async (text: string, isRetry = false) => {
    const userMsg: Message = { role: "user", content: text };
    // On retry (orphaned message recovery), the user message is already in state
    if (!isRetry) {
      setMessages((prev) => [...prev, userMsg]);
    }
    setInput("");
    setIsLoading(true);

    // Use ref to get latest messages for the API call (avoids stale closure)
    const currentMessages = isRetry ? messagesRef.current : [...messagesRef.current, userMsg];

    // Read preferences fresh from localStorage (avoids stale prop after Settings changes)
    let freshPreferences: typeof preferences | undefined;
    try {
      const raw = localStorage.getItem("whisk_preferences");
      if (raw) freshPreferences = JSON.parse(raw) as typeof preferences;
    } catch { /* ignore malformed preferences */ }

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("whisk_token")}`,
        },
        body: JSON.stringify({
          messages: currentMessages,
          seasonalContext: buildSeasonalSystemContext(new Date(), householdSize),
          mealPlan: mealPlan.length > 0 ? mealPlan.slice(0, 30) : undefined,
          shoppingList: shoppingList.length > 0 ? shoppingList.map((i) => ({ name: i.name, checked: i.checked, category: i.category })).slice(0, 50) : undefined,
          preferences: preferences ?? undefined,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        console.error(`[Whisk] Chat API error ${res.status}:`, errorText);
        throw new Error(`API error ${res.status}`);
      }
      const data = (await res.json()) as { content: string };
      if (!data.content) {
        console.warn("[Whisk] Chat API returned empty content");
        throw new Error("Empty response");
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content },
      ]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Whisk] Chat send failed:", errMsg);
      const isAuthError = errMsg.includes("401") || errMsg.includes("403");
      const isTimeout = errMsg.includes("timeout") || errMsg.includes("abort");
      const isEmptyResponse = errMsg.includes("Empty response");
      const userMessage = isAuthError
        ? "Your session may have expired. Try refreshing the page or logging in again."
        : isTimeout
          ? "The AI took too long to respond. Try again with a simpler question, or check your AI provider status in Settings."
          : isEmptyResponse
            ? "The AI returned an empty response. This can happen when the model is overloaded — try again in a moment."
            : "Something went wrong getting a response. Check Settings to make sure your AI provider is configured correctly.";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `${userMessage}\n\n(${errMsg})\n[ERROR]`,
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
            <h1 className="text-lg font-bold dark:text-stone-100">Ask</h1>
          </button>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={handleNewChat}
                className="flex items-center gap-1.5 text-xs font-medium text-stone-500 dark:text-stone-400 hover:text-orange-500 transition-colors mr-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                New chat
              </button>
            )}
            <button
              onClick={() => {
                setSearchOpen((prev) => {
                  if (!prev) setTimeout(() => searchInputRef.current?.focus(), 50);
                  else setSearchQuery("");
                  return !prev;
                });
              }}
              className={classNames(
                "p-2 rounded-lg transition-all",
                searchOpen
                  ? "text-orange-500 ring-1 ring-orange-300 dark:ring-orange-700"
                  : "text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
              )}
              title="Search recipes"
            >
              {searchOpen ? <XMark className="w-5 h-5" /> : <MagnifyingGlass className="w-5 h-5" />}
            </button>
            <button
              onClick={() => chatInputRef.current?.focus()}
              className="p-2 rounded-lg text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 transition-all"
              title={chatEnabled ? "AI connected — start chatting" : "Configure AI in Settings"}
            >
              <Sparkles className="w-5 h-5" />
            </button>
          </div>
        </div>
        {/* Search input bar */}
        {searchOpen && (
          <div className="px-4 py-2 border-b border-stone-100 dark:border-stone-800">
            <div className="relative">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (document.activeElement as HTMLElement | null)?.blur()}
                placeholder="Search recipes & discover..."
                className="w-full rounded-lg border border-stone-300 bg-white pl-9 pr-8 py-2 text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
                  <XMark className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Search results overlay */}
      {searchOpen && searchQuery.trim() && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {searchResults.recipes.length === 0 && searchResults.discover.length === 0 ? (
            <p className="text-sm text-stone-400 dark:text-stone-500 text-center py-8">No results for &ldquo;{searchQuery}&rdquo;</p>
          ) : (
            <>
              {searchResults.recipes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-2">My Recipes</p>
                  <div className="space-y-1.5">
                    {searchResults.recipes.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => { setSearchOpen(false); setSearchQuery(""); navigate(`/recipes/${r.id}`); }}
                        className="flex gap-3 w-full rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden text-left hover:border-orange-300 dark:hover:border-orange-700 transition-colors"
                      >
                        {r.thumbnailUrl ? (
                          <img src={r.thumbnailUrl} alt="" className="w-14 h-14 object-cover shrink-0" />
                        ) : (
                          <div className="w-14 h-14 bg-stone-100 dark:bg-stone-800 shrink-0" />
                        )}
                        <div className="py-1.5 pr-3 min-w-0 flex flex-col justify-center">
                          <p className="text-sm font-medium text-stone-900 dark:text-stone-100 line-clamp-1">{r.title}</p>
                          {r.tags.length > 0 && (
                            <p className="text-xs text-stone-500 dark:text-stone-400 truncate">{r.tags.slice(0, 3).join(" · ")}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {searchResults.discover.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-stone-500 dark:text-stone-400 mb-2">Discover</p>
                  <div className="space-y-1.5">
                    {searchResults.discover.map((d, i) => (
                      <button
                        key={`${d.url}-${i}`}
                        onClick={() => { setSearchOpen(false); setSearchQuery(""); navigate(`/recipes/new?url=${encodeURIComponent(d.url)}`); }}
                        className="flex gap-3 w-full rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden text-left hover:border-orange-300 dark:hover:border-orange-700 transition-colors"
                      >
                        {d.imageUrl ? (
                          <img src={d.imageUrl} alt="" className="w-14 h-14 object-cover shrink-0" />
                        ) : (
                          <div className="w-14 h-14 bg-stone-100 dark:bg-stone-800 shrink-0" />
                        )}
                        <div className="py-1.5 pr-3 min-w-0 flex flex-col justify-center">
                          <p className="text-sm font-medium text-stone-900 dark:text-stone-100 line-clamp-1">{d.title}</p>
                          {d.source && (
                            <p className="text-xs text-stone-500 dark:text-stone-400 truncate">{d.source === "nyt" ? "NYT Cooking" : d.source === "allrecipes" ? "AllRecipes" : "Serious Eats"}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        className={classNames(
          "flex-1 overflow-y-auto px-4 py-4 space-y-4",
          isKeyboardOpen ? "pb-16" : "pb-24",
          searchOpen && searchQuery.trim() ? "hidden" : ""
        )}
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

        {/* Landing state: suggestion + capabilities + seasonal */}
        {messages.length === 0 && (
          <>
            {/* Suggestion — random recipe picker */}
            {recipeCount > 0 && (
              <Card>
                <p className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-2">
                  Open to a suggestion?
                </p>
                <div className="flex items-center gap-1.5 mb-3">
                  <button
                    onClick={(e) => {
                      if (openDropdown === "season") {
                        setOpenDropdown(null);
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const minDropdownWidth = 140;
                        const wouldOverflow = rect.left + minDropdownWidth > window.innerWidth;
                        if (wouldOverflow) {
                          const right = Math.max(8, window.innerWidth - rect.right);
                          setDropdownPos({ top: rect.bottom + 4, left: 0, right });
                        } else {
                          setDropdownPos({ top: rect.bottom + 4, left: rect.left });
                        }
                        setOpenDropdown("season");
                      }
                    }}
                    className={classNames(
                      "wk-pill inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      seasonFilter
                        ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                        : openDropdown === "season"
                          ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                          : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                    )}
                  >
                    {seasonFilter ? seasonOptions.find((o) => o.value === seasonFilter)?.label ?? "Season" : "Season"}
                    <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === "season" && "rotate-180")} />
                  </button>
                  <button
                    onClick={(e) => {
                      if (openDropdown === "category") {
                        setOpenDropdown(null);
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const minDropdownWidth = 140;
                        const wouldOverflow = rect.left + minDropdownWidth > window.innerWidth;
                        if (wouldOverflow) {
                          const right = Math.max(8, window.innerWidth - rect.right);
                          setDropdownPos({ top: rect.bottom + 4, left: 0, right });
                        } else {
                          setDropdownPos({ top: rect.bottom + 4, left: rect.left });
                        }
                        setOpenDropdown("category");
                      }
                    }}
                    className={classNames(
                      "wk-pill inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      pickCategory !== "dinner"
                        ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                        : openDropdown === "category"
                          ? "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200"
                          : "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400"
                    )}
                  >
                    {PICK_CATEGORIES.find((c) => c.value === pickCategory)?.label ?? "Dinner"}
                    <ChevronDown className={classNames("w-3 h-3 transition-transform", openDropdown === "category" && "rotate-180")} />
                  </button>
                  <button
                    onClick={() => handleRandomPick()}
                    className="ml-auto flex items-center gap-1.5 text-xs font-medium text-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                  >
                    <Dice className={classNames("w-5 h-5", diceAnimating && "animate-dice")} />
                    Roll
                  </button>
                </div>

                {/* Filter dropdown portal */}
                {openDropdown && createPortal(
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
                      {openDropdown === "season"
                        ? seasonOptions.map((opt) => {
                            const isActive = seasonFilter === opt.value;
                            return (
                              <button
                                key={opt.value}
                                onClick={() => {
                                  const newSeason = isActive ? "" : opt.value;
                                  setSeasonFilter(newSeason);
                                  setOpenDropdown(null);
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
                                  "w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors",
                                  isActive
                                    ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                                    : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                                )}
                              >
                                {opt.label}
                                {isActive && <Check className="w-4 h-4 text-orange-500" />}
                              </button>
                            );
                          })
                        : PICK_CATEGORIES.map((cat) => {
                            const isActive = pickCategory === cat.value;
                            return (
                              <button
                                key={cat.value}
                                onClick={() => {
                                  setPickCategory(cat.value);
                                  setOpenDropdown(null);
                                  setPickedRecipe(null);
                                  setTimeout(() => {
                                    const pool = filterByCategory(recipes, cat.value, seasonFilter);
                                    if (pool.length === 0) return;
                                    const idx = Math.floor(Math.random() * pool.length);
                                    const pick = pool[idx] ?? null;
                                    setPickedRecipe(pick);
                                    animateDice();
                                    if (pick) {
                                      localStorage.setItem("whisk_daily_pick", JSON.stringify({
                                        id: pick.id, cat: cat.value, ts: Date.now(),
                                      }));
                                    }
                                  }, 0);
                                }}
                                className={classNames(
                                  "w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors",
                                  isActive
                                    ? "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"
                                    : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-700"
                                )}
                              >
                                {cat.label}
                                {isActive && <Check className="w-4 h-4 text-orange-500" />}
                              </button>
                            );
                          })}
                    </div>
                  </>,
                  document.body
                )}

                {pickedRecipe ? (
                  <button
                    onClick={() => navigate(`/recipes/${pickedRecipe.id}`)}
                    className={classNames(
                      "flex gap-3 w-full rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden text-left",
                      "hover:border-orange-300 dark:hover:border-orange-700 transition-colors",
                      diceAnimating && "animate-pulse"
                    )}
                  >
                    {pickedRecipe.thumbnailUrl ? (
                      <img
                        src={pickedRecipe.thumbnailUrl}
                        alt=""
                        className="w-24 h-24 object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-24 h-24 bg-stone-100 dark:bg-stone-800 shrink-0" />
                    )}
                    <div className="py-2 pr-3 min-w-0 flex flex-col justify-center">
                      <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 line-clamp-2">
                        {pickedRecipe.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {(() => {
                          const totalMin = (pickedRecipe.prepTime ?? 0) + (pickedRecipe.cookTime ?? 0);
                          if (totalMin <= 0) return null;
                          const h = Math.floor(totalMin / 60);
                          const m = totalMin % 60;
                          const label = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m} min`;
                          return <span className="text-xs text-stone-600 dark:text-stone-400 shrink-0">{label}</span>;
                        })()}
                        {pickedRecipe.servings && <span className="text-xs text-stone-600 dark:text-stone-400">Serves {pickedRecipe.servings}</span>}
                      </div>
                      {pickedRecipe.tags.length > 0 && (
                        <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">
                          {pickedRecipe.tags.slice(0, 3).join(" · ")}
                        </p>
                      )}
                    </div>
                  </button>
                ) : (
                  <div className="flex items-center justify-center py-6 text-stone-300 dark:text-stone-600">
                    <p className="text-sm">No {pickCategory !== "any" ? pickCategory : ""} recipes found</p>
                  </div>
                )}
              </Card>
            )}

            {/* What's in Season */}
            <SeasonalProduceCard compact />

            {/* Try asking — question pills */}
            <Card>
              <div className="flex items-center gap-2 mb-1.5">
                <MessageCircle className="w-4 h-4 text-stone-400 dark:text-stone-500" />
                <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">Or try asking</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <QuickAction
                  icon={CalendarDays}
                  label="Plan my meals this week"
                  onClick={() => sendMessage("Plan my dinners for this week using my recipes. Consider variety and what's in season.")}
                />
                <QuickAction
                  icon={ShoppingCart}
                  label={mealPlan.length > 0 ? "Make me a shopping list" : "What should I buy this week?"}
                  onClick={() => sendMessage(
                    mealPlan.length > 0
                      ? "Generate a shopping list from my meal plan for this week. Group items by category and skip anything already on my shopping list."
                      : "What groceries should I buy this week? Suggest a balanced shopping list."
                  )}
                />
                <QuickAction
                  icon={Sparkles}
                  label={
                    seasonal.upcomingHolidays.length > 0
                      ? `What should I make for ${seasonal.upcomingHolidays[0]!.name}?`
                      : "What's a quick dinner tonight?"
                  }
                  onClick={() => sendMessage(
                    seasonal.upcomingHolidays.length > 0
                      ? `Suggest recipes for ${seasonal.upcomingHolidays[0]!.name} from my collection or new ideas.`
                      : recipeCount > 0
                        ? "Suggest a quick dinner from my recipes for tonight."
                        : "Suggest some easy dinner recipes I should try."
                  )}
                />
              </div>
            </Card>
          </>
        )}

        {/* Messages */}
        {messages.map((msg, i) => {
          const isError = msg.role === "user" && msg.content.endsWith("[ERROR]");
          const urls = msg.role === "assistant" ? extractUrls(msg.content) : [];
          const actions = msg.role === "assistant" ? parseActions(msg.content) : [];
          let displayContent = actions.length > 0 ? stripActionMarkers(msg.content) : msg.content;

          // For error messages, extract the original user text and error reason
          let errorReason = "";
          let originalText = "";
          if (isError) {
            const raw = msg.content.replace(/\[ERROR\]$/, "").trim();
            const parenMatch = raw.match(/\n\n\((.+)\)$/s);
            if (parenMatch) {
              errorReason = parenMatch[1] ?? "";
              originalText = raw.slice(0, -(parenMatch[0]?.length ?? 0)).trim();
            } else {
              originalText = raw;
            }
            displayContent = originalText;
          }

          // Separate action types for grouped rendering
          const recipeCards = actions.filter((a) => a.type === "RECIPE_CARD");
          const saveRecipes = actions.filter((a) => a.type === "SAVE_RECIPE");
          const planActions = actions.filter((a) => a.type === "ADD_TO_PLAN");
          const otherActions = actions.filter((a) => a.type !== "RECIPE_CARD" && a.type !== "SAVE_RECIPE" && a.type !== "ADD_TO_PLAN");

          return (
            <div
              key={i}
              className={
                msg.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              <div
                className={classNames(
                  "max-w-[85%] rounded-xl px-4 py-2.5 text-sm",
                  isError
                    ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                    : msg.role === "user"
                      ? "bg-orange-500 text-white"
                      : "bg-stone-100 dark:bg-stone-800 dark:text-stone-200"
                )}
              >
                <p className="whitespace-pre-wrap">{displayContent}</p>
                {isError && (
                  <div className="mt-2 flex items-center gap-2 border-t border-red-200 dark:border-red-800 pt-2">
                    <p className="text-xs text-red-600 dark:text-red-400 flex-1">
                      {errorReason || "Failed to send"}
                    </p>
                    <button
                      onClick={() => {
                        setMessages((prev) => prev.filter((_, idx) => idx !== i));
                        sendMessage(originalText, true);
                      }}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1 rounded-full bg-red-200 dark:bg-red-900 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-300 dark:hover:bg-red-800 transition-colors disabled:opacity-40"
                    >
                      <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                  </div>
                )}

                {/* Recipe cards from user's collection */}
                {recipeCards.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-stone-200 dark:border-stone-700 pt-2">
                    {recipeCards.map((action, ai) => {
                      const parts = action.params.split(",").map((s) => s.trim());
                      const recipeId = parts[0] ?? "";
                      const recipe = recipes.find((r) => r.id === recipeId);
                      if (!recipe) return null;
                      const totalTime = (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0);
                      return (
                        <button
                          key={ai}
                          onClick={() => navigate(`/recipes/${recipe.id}`)}
                          className="flex gap-2 w-full rounded-lg border border-stone-200 dark:border-stone-600 overflow-hidden text-left hover:border-orange-300 dark:hover:border-orange-600 transition-colors"
                        >
                          {recipe.thumbnailUrl ? (
                            <img src={recipe.thumbnailUrl} alt="" className="w-16 h-16 object-cover shrink-0" />
                          ) : (
                            <div className="w-16 h-16 bg-stone-200 dark:bg-stone-700 shrink-0" />
                          )}
                          <div className="py-1.5 pr-2 min-w-0">
                            <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">{recipe.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {totalTime > 0 && <span className="text-xs text-stone-400">{totalTime} min</span>}
                              {recipe.servings && <span className="text-xs text-stone-400">Serves {recipe.servings}</span>}
                            </div>
                            {recipe.tags.length > 0 && (
                              <p className="text-xs text-stone-400 truncate mt-0.5">{recipe.tags.slice(0, 3).join(" · ")}</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* External recipe save cards */}
                {saveRecipes.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-stone-200 dark:border-stone-700 pt-2">
                    {saveRecipes.map((action, ai) => {
                      const commaIdx = action.params.indexOf(",");
                      const url = commaIdx >= 0 ? action.params.slice(0, commaIdx).trim() : action.params.trim();
                      const title = commaIdx >= 0 ? action.params.slice(commaIdx + 1).trim() : "";
                      let displayHost = "";
                      try { displayHost = new URL(url).hostname; } catch { displayHost = url; }
                      return (
                        <button
                          key={ai}
                          onClick={() => navigate(`/recipes/new?url=${encodeURIComponent(url)}`)}
                          className="flex items-center gap-2 w-full rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20 p-2.5 text-left hover:border-orange-400 transition-colors"
                        >
                          <Plus className="w-4 h-4 text-orange-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">
                              {title || displayHost}
                            </p>
                            <p className="text-xs text-stone-400 truncate">{url}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Bulk "Add all to plan" + individual plan actions */}
                {planActions.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-stone-200 dark:border-stone-700 pt-2">
                    {planActions.length >= 3 && (
                      <button
                        onClick={() => {
                          for (const action of planActions) {
                            const parts = action.params.split(",").map((s) => s.trim());
                            const dateStr = parts[0] ?? "";
                            const slot = (parts[1] ?? "dinner") as MealSlot;
                            const title = parts[2] ?? "Meal";
                            const recipeId = parts[3];
                            if (onAddMeal) {
                              const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
                              onAddMeal(d, slot, title, recipeId);
                            }
                          }
                        }}
                        className="w-full rounded-lg bg-orange-500 text-white py-2 text-sm font-medium hover:bg-orange-600 transition-colors"
                      >
                        Add all {planActions.length} meals to plan
                      </button>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {planActions.map((action, ai) => {
                        const parts = action.params.split(",").map((s) => s.trim());
                        const dateStr = parts[0] ?? "";
                        const slot = (parts[1] ?? "dinner") as MealSlot;
                        const title = parts[2] ?? "Meal";
                        const recipeId = parts[3];
                        return (
                          <button
                            key={ai}
                            onClick={() => {
                              if (onAddMeal) {
                                const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
                                onAddMeal(d, slot, title, recipeId);
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900 transition-colors"
                          >
                            <Plus className="w-3 h-3" /> {title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Other action buttons (ADD_TO_LIST, SEARCH_RECIPES) */}
                {otherActions.length > 0 && (
                  <div className={classNames("flex flex-wrap gap-2", (recipeCards.length > 0 || saveRecipes.length > 0 || planActions.length > 0) ? "mt-1" : "mt-2 border-t border-stone-200 dark:border-stone-700 pt-2")}>
                    {otherActions.map((action, ai) => {
                      if (action.type === "ADD_TO_LIST") {
                        const parts = action.params.split(",").map((s) => s.trim());
                        const itemName = parts[0] ?? "Item";
                        const amount = parts[1];
                        const displayName = amount ? `${amount} ${itemName}` : itemName;
                        return (
                          <button
                            key={ai}
                            onClick={() => {
                              if (onAddToList) onAddToList(displayName);
                            }}
                            className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900 transition-colors"
                          >
                            <Plus className="w-3 h-3" /> Add &ldquo;{itemName}&rdquo;
                          </button>
                        );
                      }
                      if (action.type === "SEARCH_RECIPES") {
                        return (
                          <button
                            key={ai}
                            onClick={() => sendMessage(`Search my recipes for "${action.params}"`)}
                            className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900 transition-colors"
                          >
                            Search &ldquo;{action.params}&rdquo;
                          </button>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}

                {/* URL-based save buttons (fallback for URLs not caught by SAVE_RECIPE markers) */}
                {urls.length > 0 && (
                  <div className={classNames("flex flex-wrap gap-2", actions.length > 0 ? "mt-1" : "mt-2 border-t border-stone-200 dark:border-stone-700 pt-2")}>
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

      {/* Sticky input bar — always visible at bottom */}
      <div className={classNames(
        "sticky left-0 right-0 bg-white dark:bg-stone-950 border-t border-stone-200 dark:border-stone-800 px-4 py-3",
        isKeyboardOpen ? "bottom-0 pb-1" : "bottom-[calc(3.5rem+var(--sab))] pb-3"
      )}>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={chatInputRef}
            type="text"
            enterKeyHint="send"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={recipeCount > 0 ? "Ask me anything..." : "What should I cook?"}
            className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="rounded-lg bg-orange-500 px-3 py-2 text-white disabled:opacity-40 hover:bg-orange-600 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
