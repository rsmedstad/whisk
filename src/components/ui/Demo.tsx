import { useState, useEffect, type ReactNode } from "react";
import { Lock, XMark } from "./Icon";
import { classNames } from "../../lib/utils";

const REPO_URL = "https://github.com/rsmedstad/whisk";

// ── Demo toast (lightweight, no global state) ──────────────
// Dispatches a custom DOM event; DemoToastHost listens and renders.

const TOAST_EVENT = "whisk:demo-toast";

interface DemoToastDetail {
  message: string;
  variant?: "lock" | "info";
}

export function showDemoToast(message: string, variant: DemoToastDetail["variant"] = "lock"): void {
  window.dispatchEvent(new CustomEvent<DemoToastDetail>(TOAST_EVENT, { detail: { message, variant } }));
}

export function DemoToastHost() {
  const [toast, setToast] = useState<DemoToastDetail | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<DemoToastDetail>).detail;
      setToast(detail);
      const timeout = setTimeout(() => setToast(null), 3200);
      return () => clearTimeout(timeout);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed left-1/2 -translate-x-1/2 bottom-[calc(var(--sab)+5rem)] z-60 max-w-[calc(100vw-2rem)] pointer-events-none"
    >
      <div className="flex items-center gap-2 rounded-full bg-stone-900/95 dark:bg-stone-100/95 px-4 py-2 shadow-lg backdrop-blur-sm text-sm text-white dark:text-stone-900 animate-[slideUp_180ms_ease-out]">
        <Lock className="w-4 h-4 shrink-0" />
        <span>{toast.message}</span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 font-medium underline decoration-orange-400 underline-offset-2 pointer-events-auto"
        >
          Set up your own
        </a>
      </div>
    </div>
  );
}

// ── Demo pill (top-center indicator) ───────────────────────

interface DemoPillProps {
  onClick: () => void;
}

export function DemoPill({ onClick }: DemoPillProps) {
  return (
    <button
      onClick={onClick}
      className="no-print fixed top-[calc(var(--sat)+0.5rem)] left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-1.5 rounded-full bg-orange-500 text-white px-3 py-1 text-xs font-semibold shadow-md shadow-orange-500/25 hover:bg-orange-600 transition-colors"
      aria-label="About this demo"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      Demo
    </button>
  );
}

// ── Demo info modal (explains what the demo is) ────────────

interface DemoInfoModalProps {
  open: boolean;
  onClose: () => void;
  onOpenAdminLogin?: () => void;
}

export function DemoInfoModal({ open, onClose, onOpenAdminLogin }: DemoInfoModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-70 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm px-4 pb-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold dark:text-stone-100">You're viewing a demo</h2>
          <button
            onClick={onClose}
            className="p-1 -mr-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
            aria-label="Close"
          >
            <XMark className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 text-sm text-stone-600 dark:text-stone-300">
          <p>
            Whisk is a personal recipe manager PWA. This demo uses a real recipe book but everything you change lives only in your browser.
          </p>
          <ul className="space-y-1.5 text-xs">
            <li className="flex gap-2">
              <span className="text-green-500 shrink-0">&#x2714;</span>
              <span>Browse recipes, try Ask, play with the shopping list and plan</span>
            </li>
            <li className="flex gap-2">
              <span className="text-green-500 shrink-0">&#x2714;</span>
              <span>Changes feel real &mdash; they just don't save. Refresh for a clean slate.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-stone-400 shrink-0">&#x2717;</span>
              <span>A few admin-only features are locked (look for the lock icon)</span>
            </li>
          </ul>
        </div>

        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 text-sm transition-colors"
        >
          Set up your own Whisk
        </a>

        {onOpenAdminLogin && (
          <button
            onClick={() => {
              onClose();
              onOpenAdminLogin();
            }}
            className="block w-full text-center text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
          >
            Admin access
          </button>
        )}
      </div>
    </div>
  );
}

// ── Demo lock wrapper (for permanently-blocked UI) ─────────

interface DemoLockProps {
  active: boolean;
  reason?: string;
  children: ReactNode;
  className?: string;
  /** When false, hides the lock badge but still intercepts clicks */
  showBadge?: boolean;
}

/**
 * Wraps a UI element that is permanently blocked in demo mode.
 * Dims the children, adds a lock badge, and intercepts all pointer events
 * to surface a toast instead of triggering the child's action.
 */
export function DemoLock({
  active,
  reason = "This action isn't available in the demo",
  children,
  className,
  showBadge = true,
}: DemoLockProps) {
  if (!active) return <>{children}</>;

  return (
    <div className={classNames("relative block w-full", className)}>
      <div className="opacity-50 pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          showDemoToast(reason);
        }}
        className="absolute inset-0 w-full h-full cursor-not-allowed"
        aria-label={reason}
      >
        {showBadge && (
          <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-stone-900/80 dark:bg-stone-100/80 text-white dark:text-stone-900 shadow-sm">
            <Lock className="w-3 h-3" />
          </span>
        )}
      </button>
    </div>
  );
}
