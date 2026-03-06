import { useState, useRef, useEffect, useMemo, useCallback, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Plus, RefreshCw, Dice, ChevronRight, WhiskLogo } from "../ui/Icon";
import { classNames } from "../../lib/utils";
import { useKeyboard } from "../../hooks/useKeyboard";
import { getSeasonalContext, buildSeasonalSystemContext } from "../../lib/seasonal";
import type { RecipeIndexEntry } from "../../types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const PICK_CATEGORIES = [
  { value: "any", label: "Any", tags: [] as string[] },
  { value: "dinner", label: "Dinner", tags: ["dinner"] },
  { value: "breakfast", label: "Breakfast", tags: ["breakfast", "brunch"] },
  { value: "appetizer", label: "Appetizer", tags: ["appetizer"] },
  { value: "side dish", label: "Side Dish", tags: ["side dish", "salad"] },
  { value: "dessert", label: "Dessert", tags: ["dessert", "desserts", "baking"] },
  { value: "drinks", label: "Drinks", tags: ["drinks", "cocktail", "cocktails"] },
  { value: "snack", label: "Snack", tags: ["snack"] },
];

function filterByCategory(recipes: RecipeIndexEntry[], categoryValue: string): RecipeIndexEntry[] {
  const cat = PICK_CATEGORIES.find((c) => c.value === categoryValue);
  if (!cat || cat.tags.length === 0) return recipes;
  return recipes.filter((r) =>
    r.tags.some((t) => cat.tags.includes(t.toLowerCase()))
  );
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

export function SuggestChat({ chatEnabled = false, recipes = [] }: SuggestChatProps) {
  const recipeCount = recipes.length;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isKeyboardOpen } = useKeyboard();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pickCategory, setPickCategory] = useState("any");
  const [pickedRecipe, setPickedRecipe] = useState<RecipeIndexEntry | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  const householdSize = useMemo(() => {
    return parseInt(localStorage.getItem("whisk_household_size") ?? "4", 10);
  }, []);

  const seasonal = useMemo(
    () => getSeasonalContext(new Date(), householdSize),
    [householdSize]
  );

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
    setPickedRecipe(null);
    autoSentRef.current = false;
  };

  const handleRandomPick = useCallback(() => {
    const pool = filterByCategory(recipes, pickCategory);
    if (pool.length === 0) return;
    const idx = Math.floor(Math.random() * pool.length);
    setPickedRecipe(pool[idx] ?? null);
  }, [recipes, pickCategory]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 pt-[var(--sat)]">
        <div className="flex items-center justify-between py-3">
          <button onClick={() => navigate("/settings")} title="Settings" className="flex items-center gap-1.5">
            <WhiskLogo className="w-5 h-5 text-orange-500" />
            <span className="text-lg font-bold text-orange-500">W</span>
            <span className="text-stone-400 dark:text-stone-500">|</span>
            <h1 className="text-lg font-bold dark:text-stone-100">Suggest</h1>
          </button>
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
              Chat requires an AI API key (GROQ_API_KEY, OPENAI_API_KEY, or similar).
              You can still browse recipes by season and use the quick actions below.
            </p>
          </div>
        )}

        {/* Seasonal context + quick actions */}
        {messages.length === 0 && (
          <>
            {/* Seasonal greeting */}
            <Card>
              <p className="text-base font-semibold dark:text-stone-100">
                {seasonal.greeting}
              </p>
              {recipeCount > 0 && (
                <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
                  AI knows your {recipeCount} recipe{recipeCount !== 1 ? "s" : ""} and can suggest from your collection
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-0.5 text-xs font-medium text-stone-600 dark:text-stone-300 capitalize">
                  {seasonal.season}
                </span>
                {seasonal.upcomingHolidays.slice(0, 3).map((h) => (
                  <span
                    key={h.name}
                    className="inline-flex items-center rounded-full bg-orange-50 dark:bg-orange-950 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300"
                  >
                    {h.name}
                    {h.daysAway > 0 && (
                      <span className="ml-1 text-orange-500/70">
                        {h.daysAway}d
                      </span>
                    )}
                  </span>
                ))}
              </div>
              {seasonal.seasonalIngredients.length > 0 && (
                <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                  In season: {seasonal.seasonalIngredients.slice(0, 6).join(", ")}
                </p>
              )}
            </Card>

            {/* Random pick */}
            {recipeCount > 0 && (
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-stone-600 dark:text-stone-300">
                    Pick for me
                  </p>
                  <select
                    value={pickCategory}
                    onChange={(e) => { setPickCategory(e.target.value); setPickedRecipe(null); }}
                    className="rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2 py-1 text-xs font-medium text-stone-600 dark:text-stone-300 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  >
                    {PICK_CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>

                {!pickedRecipe ? (
                  <button
                    onClick={handleRandomPick}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-stone-300 dark:border-stone-600 py-4 text-stone-500 dark:text-stone-400 hover:border-orange-400 hover:text-orange-500 dark:hover:border-orange-600 dark:hover:text-orange-400 transition-colors"
                  >
                    <Dice className="w-5 h-5" />
                    <span className="text-sm font-medium">Roll the dice</span>
                  </button>
                ) : (
                  <div className="rounded-lg border border-stone-200 dark:border-stone-700 overflow-hidden">
                    <button
                      onClick={() => navigate(`/recipes/${pickedRecipe.id}`)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
                    >
                      {pickedRecipe.thumbnailUrl ? (
                        <img
                          src={pickedRecipe.thumbnailUrl}
                          alt=""
                          className="w-14 h-14 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-stone-100 dark:bg-stone-800 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                          {pickedRecipe.title}
                        </p>
                        {pickedRecipe.tags.length > 0 && (
                          <p className="text-xs text-stone-400 dark:text-stone-500 truncate mt-0.5">
                            {pickedRecipe.tags.slice(0, 3).join(" · ")}
                          </p>
                        )}
                        {(pickedRecipe.prepTime ?? 0) + (pickedRecipe.cookTime ?? 0) > 0 && (
                          <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                            {(pickedRecipe.prepTime ?? 0) + (pickedRecipe.cookTime ?? 0)} min
                          </p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-stone-300 dark:text-stone-600 shrink-0" />
                    </button>
                    <div className="border-t border-stone-200 dark:border-stone-700 px-3 py-2 flex justify-end">
                      <button
                        onClick={handleRandomPick}
                        className="flex items-center gap-1.5 text-xs font-medium text-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                      >
                        <Dice className="w-3.5 h-3.5" />
                        Roll again
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Quick actions */}
            <Card>
              <p className="text-sm font-medium text-stone-600 dark:text-stone-300 mb-3">
                What are you in the mood for?
              </p>
              <div className="flex flex-wrap gap-2">
                {recipeCount > 0 && (
                  <button
                    onClick={() => sendMessage("What should I cook tonight from my recipes?")}
                    className="rounded-lg border border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950/30 px-3 py-1.5 text-sm text-orange-600 dark:text-orange-400 font-medium hover:border-orange-500 transition-colors"
                  >
                    What should I cook tonight?
                  </button>
                )}
                {seasonal.contextualPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="rounded-lg border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm text-stone-600 dark:text-stone-300 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
                {recipeCount > 0 && (
                  <>
                    <button
                      onClick={() => sendMessage("What can I make with chicken?")}
                      className="rounded-lg border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm text-stone-600 dark:text-stone-300 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                    >
                      What can I make with chicken?
                    </button>
                    <button
                      onClick={() => sendMessage("Suggest a meal plan for this week using my recipes")}
                      className="rounded-lg border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm text-stone-600 dark:text-stone-300 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                    >
                      Plan my week
                    </button>
                  </>
                )}
              </div>
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

      {/* Input */}
      <div className={classNames(
        "sticky left-0 right-0 bg-white dark:bg-stone-950 border-t border-stone-200 dark:border-stone-800 px-4 py-3",
        isKeyboardOpen ? "bottom-0 pb-1" : "bottom-0 pb-3"
      )}>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            enterKeyHint="send"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={recipeCount > 0 ? "Ask about your recipes..." : "Ask for recipe ideas..."}
            className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm placeholder:text-stone-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || isLoading}>
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
