import { useEffect } from "react";
import { setBadge, clearBadge } from "../lib/badge";

const LAST_SEEN_KEY = "whisk_last_seen_recipe_count";
const ENABLED_KEY = "whisk_badge_enabled";

function getLastSeen(): number {
  const raw = localStorage.getItem(LAST_SEEN_KEY);
  if (raw == null) return -1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : -1;
}

function saveLastSeen(n: number): void {
  localStorage.setItem(LAST_SEEN_KEY, String(n));
}

function isEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "true";
}

/**
 * Sets a numeric badge on the installed PWA's home-screen icon equal to
 * `recipeCount - lastSeen`. Calibrates lastSeen (and clears the badge)
 * whenever the user is viewing the recipes list with the page visible.
 */
export function useRecipeBadge(recipeCount: number, onRecipesTab: boolean): void {
  useEffect(() => {
    if (!isEnabled()) {
      clearBadge();
      return;
    }
    if (recipeCount <= 0) return;

    const lastSeen = getLastSeen();

    if (lastSeen < 0) {
      saveLastSeen(recipeCount);
      clearBadge();
      return;
    }

    if (onRecipesTab && document.visibilityState === "visible") {
      saveLastSeen(recipeCount);
      clearBadge();
      return;
    }

    const delta = Math.max(0, recipeCount - lastSeen);
    setBadge(delta);
  }, [recipeCount, onRecipesTab]);

  useEffect(() => {
    if (!isEnabled()) return;

    const handler = () => {
      if (document.visibilityState !== "visible") return;
      if (!onRecipesTab) return;
      if (recipeCount > 0) saveLastSeen(recipeCount);
      clearBadge();
    };
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("pageshow", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("pageshow", handler);
    };
  }, [recipeCount, onRecipesTab]);
}
