import { useState, useRef, useEffect, useMemo, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Plus } from "../ui/Icon";
import { getSeasonalContext, buildSeasonalSystemContext } from "../../lib/seasonal";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface SuggestChatProps {
  chatEnabled?: boolean;
}

const URL_REGEX = /https?:\/\/[^\s,)}\]"']+/g;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  // Filter to likely recipe URLs (not images, not generic)
  return [...new Set(matches)].filter((url) => {
    const lower = url.toLowerCase();
    return !lower.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)$/);
  });
}

export function SuggestChat({ chatEnabled = false }: SuggestChatProps) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
  }, [messages]);

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
    sendMessage(input.trim());
  };

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm dark:bg-stone-950/95 border-b border-stone-200 dark:border-stone-800 px-4 py-3 pt-[calc(var(--sat)+0.75rem)]">
        <h1 className="text-xl font-bold dark:text-stone-100">Suggest</h1>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 pb-24 space-y-4"
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
              {seasonal.upcomingHolidays.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
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
              )}
              {seasonal.seasonalIngredients.length > 0 && (
                <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                  In season: {seasonal.seasonalIngredients.slice(0, 6).join(", ")}
                </p>
              )}
            </Card>

            {/* Contextual quick actions */}
            <Card>
              <p className="text-sm font-medium text-stone-600 dark:text-stone-300 mb-3">
                What are you in the mood for?
              </p>
              <div className="flex flex-wrap gap-2">
                {seasonal.contextualPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="rounded-lg border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm text-stone-600 dark:text-stone-300 hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
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
      <div className="sticky bottom-16 left-0 right-0 bg-white dark:bg-stone-950 border-t border-stone-200 dark:border-stone-800 px-4 py-3 pb-[calc(var(--sab)+4.5rem)]">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your recipes..."
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
