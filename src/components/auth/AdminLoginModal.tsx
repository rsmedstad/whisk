import { useState, type FormEvent } from "react";
import { api, setToken } from "../../lib/api";
import { XMark, Lock } from "../ui/Icon";
import type { AuthResponse } from "../../types";

interface AdminLoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Hidden admin login for demo deployments. Accepts only the OWNER_PASSWORD
 * (enforced server-side) — APP_SECRET yields a non-owner token that still
 * sees demo restrictions. Rate-limited at the auth endpoint.
 */
export function AdminLoginModal({ open, onClose, onSuccess }: AdminLoginModalProps) {
  const [password, setPassword] = useState("");
  const [name, setName] = useState(() => localStorage.getItem("whisk_display_name") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.post<AuthResponse>("/auth", {
        password: password.trim(),
        name: name.trim() || undefined,
      });
      if (!res.isDemoOwner) {
        setError("That password isn't the admin password for this demo.");
        setIsSubmitting(false);
        return;
      }
      setToken(res.token);
      localStorage.removeItem("whisk_demo_guest");
      if (res.userId) localStorage.setItem("whisk_user_id", res.userId);
      if (res.name) localStorage.setItem("whisk_display_name", res.name);
      localStorage.setItem("whisk_demo_mode", "true");
      localStorage.setItem("whisk_demo_owner", "true");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-stone-500 dark:text-stone-400" />
            <h2 className="text-lg font-bold dark:text-stone-100">Admin access</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 -mr-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
            aria-label="Close"
          >
            <XMark className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="given-name"
              className="w-full rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-3 py-2 text-sm dark:text-stone-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
              Admin password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-3 py-2 text-sm dark:text-stone-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !password.trim()}
            className="w-full rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-stone-300 dark:disabled:bg-stone-700 text-white font-medium py-2.5 text-sm transition-colors"
          >
            {isSubmitting ? "Signing in..." : "Unlock admin mode"}
          </button>
        </form>
      </div>
    </div>
  );
}
