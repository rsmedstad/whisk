import { useState, useRef, useEffect, useMemo, useCallback, type FormEvent, type ComponentType } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Plus, RefreshCw, Dice, WhiskLogo, Send, CalendarDays, ShoppingCart, BookOpen, Sparkles } from "../ui/Icon";
import type { IconProps } from "../ui/Icon";
import { SeasonalBrandIcon } from "../ui/SeasonalBrandIcon";
import { SeasonalProduceCard } from "../ui/SeasonalProduceCard";
import { classNames } from "../../lib/utils";
import { useKeyboard } from "../../hooks/useKeyboard";
import { getSeasonalContext, buildSeasonalSystemContext } from "../../lib/seasonal";
import type { RecipeIndexEntry, PlannedMeal, ShoppingItem, UserPreferences, MealSlot } from "../../types";
import { toDateString } from "../../lib/utils";


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


/** Tappable capability card for the Ask landing state */
function CapabilityCard({ icon: Icon, title, description, onClick }: {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-1 rounded-lg border border-stone-200 dark:border-stone-700 p-2.5 text-left hover:border-orange-300 dark:hover:border-orange-700 transition-colors"
    >
      <Icon className="w-4 h-4 text-orange-500" />
      <p className="text-xs font-semibold text-stone-700 dark:text-stone-200">{title}</p>
      <p className="text-[11px] text-stone-400 dark:text-stone-500 leading-tight">{description}</p>
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
          </div>
        </div>
        {/* Input bar in header — always visible when no messages */}
        {messages.length === 0 && (
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

        {/* Landing state: suggestion + capabilities + seasonal */}
        {messages.length === 0 && (
          <>
            {/* Suggestion — random recipe picker */}
            {recipeCount > 0 && (
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">
                    Wondering what to make?
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
                      "flex gap-3 w-full rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden text-left",
                      "hover:border-orange-300 dark:hover:border-orange-700 transition-colors",
                      diceAnimating && "animate-pulse"
                    )}
                  >
                    {pickedRecipe.thumbnailUrl ? (
                      <img
                        src={pickedRecipe.thumbnailUrl}
                        alt=""
                        className="w-20 h-20 object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-20 h-20 bg-stone-100 dark:bg-stone-800 shrink-0" />
                    )}
                    <div className="py-2 pr-3 min-w-0">
                      <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 line-clamp-2">
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

            {/* What can I help with? — capabilities grid */}
            <Card>
              <p className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-3">
                What can I help with?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <CapabilityCard
                  icon={CalendarDays}
                  title="Plan meals"
                  description="Fill your week with recipes"
                  onClick={() => sendMessage("Plan my dinners for this week using my recipes. Consider variety and what's in season.")}
                />
                {mealPlan.length > 0 ? (
                  <CapabilityCard
                    icon={ShoppingCart}
                    title="Shopping list"
                    description="Generate from your plan"
                    onClick={() => sendMessage("Generate a shopping list from my meal plan for this week. Group items by category and skip anything already on my shopping list.")}
                  />
                ) : (
                  <CapabilityCard
                    icon={ShoppingCart}
                    title="Shopping list"
                    description="What to buy this week"
                    onClick={() => sendMessage("What groceries should I buy this week? Suggest a balanced shopping list.")}
                  />
                )}
                <CapabilityCard
                  icon={BookOpen}
                  title={recipeCount > 0 ? "Find recipes" : "Get ideas"}
                  description={recipeCount > 0 ? "Search your collection" : "Discover new dishes"}
                  onClick={() => sendMessage(recipeCount > 0 ? "Suggest a quick dinner from my recipes for tonight." : "Suggest some easy dinner recipes I should try.")}
                />
                <CapabilityCard
                  icon={Sparkles}
                  title="Discover new"
                  description={`Get inspired by ${seasonal.season}`}
                  onClick={() => sendMessage(
                    seasonal.upcomingHolidays.length > 0
                      ? `Suggest recipes for ${seasonal.upcomingHolidays[0]!.name} from my collection or new ideas.`
                      : `What ${seasonal.season} recipes should I try?`
                  )}
                />
              </div>
              {/* Text input */}
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

            {/* What's in Season — bottom */}
            <SeasonalProduceCard />
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
                            onClick={() => navigate(`/?q=${encodeURIComponent(action.params)}`)}
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
