import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Card } from "../ui/Card";

interface LoginProps {
  onLogin: (password: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

type Screen = "welcome" | "join" | "setup-info";

export function Login({ onLogin, isLoading, error }: LoginProps) {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    try {
      await onLogin(password);
    } catch {
      // Error handled by parent
    }
  };

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
            className="text-stone-500 dark:text-stone-400 text-sm mb-6 block"
          >
            &#8592; Back
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
          className="text-stone-500 dark:text-stone-400 text-sm mb-6 block"
        >
          &#8592; Back
        </button>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold dark:text-stone-100 mb-2">
            Join a Book
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Enter the password shared by your book owner
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder="Book password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />

          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}

          <Button type="submit" fullWidth disabled={isLoading || !password.trim()}>
            {isLoading ? "Joining..." : "Join Book"}
          </Button>
        </form>
      </div>
    </div>
  );
}
