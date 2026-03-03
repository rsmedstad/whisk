import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Card } from "../ui/Card";
import { ChevronLeft } from "../ui/Icon";
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
        currentTheme={currentTheme ?? "seasonal"}
        onSetTheme={onSetTheme}
        onComplete={onCompleteOnboarding}
      />
    );
  }

  if (screen === "welcome") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-orange-500 mb-2">Whisk</h1>
            <p className="text-stone-500 dark:text-stone-400">
              Your personal recipe book
            </p>
          </div>

          <div className="space-y-3">
            <Button fullWidth onClick={() => setScreen("join")}>
              Join an Existing Book
            </Button>
            <Button variant="secondary" fullWidth onClick={() => setScreen("setup-info")}>
              Set Up a New Book
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "setup-info") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
        <div className="w-full max-w-sm">
          <button
            onClick={() => setScreen("welcome")}
            className="flex items-center gap-1 text-stone-500 dark:text-stone-400 text-sm mb-6"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>

          <h1 className="text-2xl font-bold dark:text-stone-100 mb-2">
            Set Up Your Book
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mb-6">
            Deploy your own Whisk instance to get started.
          </p>

          <Card>
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 text-xs font-bold flex items-center justify-center shrink-0">1</span>
                  <div>
                    <p className="text-sm font-medium dark:text-stone-200">Fork & deploy</p>
                    <p className="text-xs text-stone-500 dark:text-stone-400">Fork the Whisk repo and deploy to Cloudflare Pages</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 text-xs font-bold flex items-center justify-center shrink-0">2</span>
                  <div>
                    <p className="text-sm font-medium dark:text-stone-200">Set your password</p>
                    <p className="text-xs text-stone-500 dark:text-stone-400">Add APP_SECRET as an environment variable</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 text-xs font-bold flex items-center justify-center shrink-0">3</span>
                  <div>
                    <p className="text-sm font-medium dark:text-stone-200">Add AI keys (optional)</p>
                    <p className="text-xs text-stone-500 dark:text-stone-400">Add keys for any AI provider — features enable automatically. Supports Groq, OpenAI, Anthropic, Google Gemini, xAI, and more</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="mt-6 space-y-3">
            <Button fullWidth onClick={() => setScreen("join")}>
              I've deployed — sign in
            </Button>
            <p className="text-xs text-center text-stone-400 dark:text-stone-500">
              Share your book URL and password with household members so they can join
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Join screen
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
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
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Enter your name and the password shared by your book owner
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Your Name"
            type="text"
            placeholder="e.g. Ryan"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoComplete="given-name"
          />

          <Input
            label="Book Password"
            type="password"
            placeholder="Book password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}

          <Button type="submit" fullWidth disabled={isLoading || !password.trim() || !name.trim()}>
            {isLoading ? "Joining..." : "Join Book"}
          </Button>
        </form>
      </div>
    </div>
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
  const [zipCode, setZipCode] = useState("");

  const handleThemeChange = (t: AppSettings["theme"]) => {
    onSetTheme?.(t);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold dark:text-stone-100 mb-1">
            Welcome, {userName}!
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Let's personalize your experience
          </p>
        </div>

        <Card>
          <div className="space-y-4">
            {/* Theme */}
            <div>
              <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                Theme
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["system", "light", "dark", "seasonal"] as const).map((t) => {
                  const label = t === "seasonal"
                    ? `Seasonal — ${ACCENT_LABELS[getSeasonalAccent()] ?? "Auto"}`
                    : t;
                  return (
                    <button
                      key={t}
                      onClick={() => handleThemeChange(t)}
                      className={`py-2 rounded-lg text-sm font-medium border capitalize ${
                        currentTheme === t ? activeClass : inactiveClass
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {currentTheme === "seasonal" && (
                <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                  Colors change with holidays and seasons
                </p>
              )}
            </div>

            {/* Units */}
            <div>
              <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                Measurements
              </label>
              <div className="flex gap-2">
                {(["imperial", "metric"] as const).map((u) => (
                  <button
                    key={u}
                    onClick={() => setUnits(u)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border capitalize ${
                      units === u ? activeClass : inactiveClass
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            {/* Zip Code */}
            <div>
              <Input
                label="Zip Code (optional)"
                placeholder="e.g. 90210"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                maxLength={10}
                inputMode="numeric"
              />
              <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                Used locally for seasonal suggestions. Not shared.
              </p>
            </div>
          </div>
        </Card>

        <div className="mt-6">
          <Button
            fullWidth
            onClick={() => onComplete({ units, zipCode: zipCode.trim() })}
          >
            Get Started
          </Button>
        </div>
      </div>
    </div>
  );
}
