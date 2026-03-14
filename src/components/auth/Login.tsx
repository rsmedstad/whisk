import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Card } from "../ui/Card";
import { ChevronLeft } from "../ui/Icon";
import { InstallPrompt } from "../InstallPrompt";
import { getSeasonalAccent } from "../../lib/seasonal";
import type { AppSettings, OnboardingPrefs } from "../../types";

interface LoginProps {
  onLogin: (password: string, name?: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  showOnboarding?: boolean;
  userName?: string;
  currentTheme?: AppSettings["theme"];
  onSetTheme?: (theme: AppSettings["theme"]) => void;
  onCompleteOnboarding?: (prefs: OnboardingPrefs) => void;
}

type Screen = "welcome" | "join" | "setup-info";

const ACCENT_LABELS: Record<string, string> = {
  valentine: "Valentine's Day", stpatrick: "St. Patrick's",
  easter: "Easter", july4th: "4th of July",
  halloween: "Halloween", thanksgiving: "Thanksgiving",
  christmas: "Christmas", spring: "Spring",
  summer: "Summer", fall: "Fall", winter: "Winter",
};

const ACCENT_SYMBOLS: Record<string, string> = {
  valentine: "\u{1F495}", stpatrick: "\u2618\uFE0F",
  easter: "\u{1F423}", july4th: "\u{1F386}",
  halloween: "\u{1F383}", thanksgiving: "\u{1F983}",
  christmas: "\u{1F384}", spring: "\u{1F331}",
  summer: "\u2600\uFE0F", fall: "\u{1F342}", winter: "\u2744\uFE0F",
};

const activeClass = "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300";
const inactiveClass = "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400";

export function Login({
  onLogin,
  isLoading,
  error,
  showOnboarding,
  userName,
  currentTheme,
  onSetTheme,
  onCompleteOnboarding,
}: LoginProps) {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim() || !name.trim()) return;
    try {
      await onLogin(password, name.trim());
    } catch {
      // Error handled by parent
    }
  };

  // Onboarding screen (shown after first successful login)
  if (showOnboarding && userName && onCompleteOnboarding) {
    return (
      <OnboardingScreen
        userName={userName}
        currentTheme={currentTheme ?? "system"}
        onSetTheme={onSetTheme}
        onComplete={onCompleteOnboarding}
      />
    );
  }

  if (screen === "welcome") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-bold text-orange-500 mb-2">Whisk</h1>
            <p className="text-stone-600 dark:text-stone-400">
              Your personal recipe book
            </p>
          </div>

          <InstallPrompt />

          <div className="space-y-3">
            <Button fullWidth onClick={() => setScreen("join")}>
              Join an Existing Book
            </Button>
            <Button variant="secondary" fullWidth onClick={() => setScreen("setup-info")}>
              Set Up a New Book
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (screen === "setup-info") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
        <div className="w-full max-w-sm">
          <button
            onClick={() => setScreen("welcome")}
            className="flex items-center gap-1 text-stone-600 dark:text-stone-400 text-sm mb-6 min-h-11 -ml-2 px-2"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>

          <h1 className="text-2xl font-bold dark:text-stone-100 mb-2">
            Set Up Your Book
          </h1>
          <p className="text-sm text-stone-600 dark:text-stone-400 mb-6">
            Deploy your own Whisk instance to get started.
          </p>

          <Card>
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 text-xs font-bold flex items-center justify-center shrink-0">1</span>
                  <div>
                    <p className="text-sm font-medium dark:text-stone-200">Fork & deploy</p>
                    <p className="text-xs text-stone-600 dark:text-stone-400">Fork the Whisk repo and deploy to Cloudflare Pages</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 text-xs font-bold flex items-center justify-center shrink-0">2</span>
                  <div>
                    <p className="text-sm font-medium dark:text-stone-200">Set your password</p>
                    <p className="text-xs text-stone-600 dark:text-stone-400">Add APP_SECRET as an environment variable</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 text-xs font-bold flex items-center justify-center shrink-0">3</span>
                  <div>
                    <p className="text-sm font-medium dark:text-stone-200">Add AI keys (optional)</p>
                    <p className="text-xs text-stone-600 dark:text-stone-400">Add keys for any AI provider — features enable automatically. Supports Groq, OpenAI, Anthropic, Google Gemini, xAI, and more</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="mt-6 space-y-3">
            <Button fullWidth onClick={() => setScreen("join")}>
              I've deployed — sign in
            </Button>
            <p className="text-xs text-center text-stone-600 dark:text-stone-400">
              After setup, use the Share button in Settings to share your book URL and password with household members so they can join
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Join screen
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
      <div className="w-full max-w-sm">
        <button
          onClick={() => setScreen("welcome")}
          className="flex items-center gap-1 text-stone-500 dark:text-stone-400 text-sm mb-6"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold dark:text-stone-100 mb-2">
            Join a Book
          </h1>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Enter your name and the password shared by your book owner
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Your Name"
            type="text"
            placeholder="e.g. Alex"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoComplete="given-name"
          />

          <div className="relative">
            <Input
              label="Book Password"
              type={showPassword ? "text" : "password"}
              placeholder="Book password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-0.5 top-[1.3rem] p-2.5 text-stone-500 dark:text-stone-400"
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              )}
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-500 text-center" role="alert">{error}</p>
          )}

          <Button type="submit" fullWidth disabled={isLoading || !password.trim() || !name.trim()}>
            {isLoading ? "Joining..." : "Join Book"}
          </Button>
        </form>
      </div>
    </main>
  );
}

// ── Onboarding Screen ───────────────────────────────────────

function OnboardingScreen({
  userName,
  currentTheme,
  onSetTheme,
  onComplete,
}: {
  userName: string;
  currentTheme: AppSettings["theme"];
  onSetTheme?: (theme: AppSettings["theme"]) => void;
  onComplete: (prefs: OnboardingPrefs) => void;
}) {
  const [units, setUnits] = useState<OnboardingPrefs["units"]>("imperial");
  const [showGrams, setShowGrams] = useState(true);
  const handleThemeChange = (t: AppSettings["theme"]) => {
    onSetTheme?.(t);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100 mb-1">
            Welcome, {userName}!
          </h1>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Let's personalize your experience
          </p>
        </div>

        <Card>
          <div className="space-y-4">
            {/* Theme */}
            <div>
              <label className="text-sm font-medium text-stone-700 dark:text-stone-200 block mb-2">
                Theme
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["system", "light", "dark", "seasonal"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => handleThemeChange(t)}
                    aria-pressed={currentTheme === t}
                    className={`py-2.5 rounded-lg text-sm font-medium border capitalize ${
                      currentTheme === t ? activeClass : inactiveClass
                    }`}
                  >
                    {t === "seasonal" ? "Seasonal / Holiday" : t}
                  </button>
                ))}
              </div>
              {currentTheme === "seasonal" && (() => {
                const accent = getSeasonalAccent();
                const symbol = ACCENT_SYMBOLS[accent] ?? "";
                const name = ACCENT_LABELS[accent] ?? "Auto";
                return (
                  <p className="mt-2 text-xs text-stone-600 dark:text-stone-400">
                    {symbol} Currently: {name} — changes automatically
                  </p>
                );
              })()}
            </div>

            {/* Units */}
            <div>
              <label className="text-sm font-medium text-stone-700 dark:text-stone-200 block mb-2">
                Measurements
              </label>
              <div className="flex gap-2">
                {(["imperial", "metric"] as const).map((u) => (
                  <button
                    key={u}
                    onClick={() => setUnits(u)}
                    aria-pressed={units === u}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border capitalize ${
                      units === u ? activeClass : inactiveClass
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            {/* Show Gram Weights */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-stone-700 dark:text-stone-200">
                  Show gram weights
                </span>
                <p className="text-xs text-stone-600 dark:text-stone-400">
                  Display grams alongside volume
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showGrams}
                aria-label="Show gram weights"
                onClick={() => setShowGrams(!showGrams)}
                className={`relative w-12 h-7 rounded-full transition-colors ${
                  showGrams ? "bg-orange-500" : "bg-stone-300 dark:bg-stone-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                    showGrams ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>

          </div>
        </Card>

        <div className="mt-6">
          <Button
            fullWidth
            onClick={() => onComplete({ units, showGrams })}
          >
            Get Started
          </Button>
        </div>
      </div>
    </main>
  );
}
