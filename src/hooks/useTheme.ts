import { useState, useEffect, useCallback } from "react";
import type { AppSettings } from "../types";
import { getSeasonalAccent } from "../lib/seasonal";

type Theme = AppSettings["theme"];

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function applyAccent(accent: string | null) {
  if (accent) {
    document.documentElement.setAttribute("data-accent", accent);
  } else {
    document.documentElement.removeAttribute("data-accent");
  }
}

export function useTheme() {
  const [preference, setPreference] = useState<Theme>(() => {
    return (localStorage.getItem("whisk_theme") as Theme) ?? "seasonal";
  });

  // Resolve dark/light mode
  const resolved =
    preference === "system" || preference === "seasonal"
      ? getSystemTheme()
      : preference;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // Apply seasonal accent when theme is "seasonal"
  useEffect(() => {
    if (preference === "seasonal") {
      applyAccent(getSeasonalAccent());

      // Recheck accent at midnight in case the date changes
      const now = new Date();
      const msUntilMidnight =
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() -
        now.getTime();

      const timer = setTimeout(() => {
        applyAccent(getSeasonalAccent());
      }, msUntilMidnight);

      return () => clearTimeout(timer);
    } else {
      applyAccent(null);
    }
  }, [preference]);

  // Listen for system theme changes (for system + seasonal modes)
  useEffect(() => {
    if (preference !== "system" && preference !== "seasonal") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(getSystemTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  const setTheme = useCallback((theme: Theme) => {
    setPreference(theme);
    localStorage.setItem("whisk_theme", theme);
  }, []);

  return { theme: preference, resolved, setTheme };
}
