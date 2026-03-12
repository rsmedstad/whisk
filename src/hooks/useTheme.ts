import { useState, useEffect, useCallback } from "react";
import type { AppSettings } from "../types";
import { getSeasonalAccent, type SeasonalAccent } from "../lib/seasonal";

type Theme = AppSettings["theme"];

// Accents whose CSS palettes use dark backgrounds (e.g. --color-white is a dark value)
// These need the `.dark` class so dark: Tailwind variants activate for text contrast
const DARK_ACCENTS: ReadonlySet<SeasonalAccent> = new Set(["halloween"]);

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

export const ACCENT_OPTIONS: { value: "auto" | SeasonalAccent; label: string }[] = [
  { value: "auto", label: "Auto (date-based)" },
  { value: "spring", label: "Spring" },
  { value: "summer", label: "Summer" },
  { value: "fall", label: "Fall" },
  { value: "winter", label: "Winter" },
  { value: "valentine", label: "Valentine's Day" },
  { value: "stpatrick", label: "St. Patrick's Day" },
  { value: "easter", label: "Easter" },
  { value: "july4th", label: "4th of July" },
  { value: "halloween", label: "Halloween" },
  { value: "thanksgiving", label: "Thanksgiving" },
  { value: "christmas", label: "Christmas" },
];

export function useTheme() {
  const [preference, setPreference] = useState<Theme>(() => {
    return (localStorage.getItem("whisk_theme") as Theme) ?? "system";
  });

  const [accentOverride, setAccentOverrideState] = useState<"auto" | SeasonalAccent>(() => {
    return (localStorage.getItem("whisk_accent") as SeasonalAccent) || "auto";
  });

  // Resolve dark/light mode
  // Seasonal themes use their own palettes — dark class only for dark-palette accents
  const activeAccent = accentOverride !== "auto" ? accentOverride : getSeasonalAccent();
  const resolved =
    preference === "system"
      ? getSystemTheme()
      : preference === "seasonal"
        ? (DARK_ACCENTS.has(activeAccent) ? "dark" : "light")
        : preference;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // Apply seasonal accent when theme is "seasonal"
  useEffect(() => {
    if (preference === "seasonal") {
      const accent = accentOverride !== "auto" ? accentOverride : getSeasonalAccent();
      applyAccent(accent);

      // If auto, recheck accent at midnight in case the date changes
      if (accentOverride === "auto") {
        const now = new Date();
        const msUntilMidnight =
          new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() -
          now.getTime();

        const timer = setTimeout(() => {
          applyAccent(getSeasonalAccent());
        }, msUntilMidnight);

        return () => clearTimeout(timer);
      }
    } else {
      applyAccent(null);
    }
  }, [preference, accentOverride]);

  // Listen for system theme changes (for system mode only)
  useEffect(() => {
    if (preference !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(getSystemTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  const setTheme = useCallback((theme: Theme) => {
    setPreference(theme);
    localStorage.setItem("whisk_theme", theme);
  }, []);

  const setAccentOverride = useCallback((accent: "auto" | SeasonalAccent) => {
    setAccentOverrideState(accent);
    if (accent === "auto") {
      localStorage.removeItem("whisk_accent");
    } else {
      localStorage.setItem("whisk_accent", accent);
    }
  }, []);

  return { theme: preference, resolved, setTheme, accentOverride, setAccentOverride };
}
