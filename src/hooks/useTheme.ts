import { useState, useEffect, useCallback } from "react";
import type { AppSettings, ThemePalette } from "../types";
import { getSeasonalAccent, type SeasonalAccent } from "../lib/seasonal";

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

function readPrefs(): { theme: Theme; palette: ThemePalette } {
  let theme: Theme = "system";
  let palette: ThemePalette = "classic";
  try {
    const storedTheme = localStorage.getItem("whisk_theme");
    const storedPalette = localStorage.getItem("whisk_palette");
    if (storedTheme === "seasonal") {
      // Migrate legacy "seasonal" theme to system mode + seasonal palette
      palette = "seasonal";
      localStorage.setItem("whisk_theme", "system");
      localStorage.setItem("whisk_palette", "seasonal");
    } else {
      if (storedTheme === "light" || storedTheme === "dark" || storedTheme === "system") {
        theme = storedTheme;
      }
      if (storedPalette === "seasonal" || storedPalette === "classic") {
        palette = storedPalette;
      }
    }
  } catch {
    // localStorage unavailable
  }
  return { theme, palette };
}

export function useTheme() {
  const [prefs] = useState(readPrefs);
  const [preference, setPreference] = useState<Theme>(prefs.theme);
  const [palette, setPaletteState] = useState<ThemePalette>(prefs.palette);
  const [systemDark, setSystemDark] = useState<boolean>(() => getSystemTheme() === "dark");

  const [accentOverride, setAccentOverrideState] = useState<"auto" | SeasonalAccent>(() => {
    return (localStorage.getItem("whisk_accent") as SeasonalAccent) || "auto";
  });

  const resolved: "light" | "dark" =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // Apply seasonal accent when palette is "seasonal"
  useEffect(() => {
    if (palette === "seasonal") {
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
  }, [palette, accentOverride]);

  // Track system color scheme changes (used when mode is "system")
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setSystemDark(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setTheme = useCallback((theme: Theme) => {
    setPreference(theme);
    try {
      localStorage.setItem("whisk_theme", theme);
    } catch {
      // ignore
    }
  }, []);

  const setPalette = useCallback((next: ThemePalette) => {
    setPaletteState(next);
    try {
      localStorage.setItem("whisk_palette", next);
    } catch {
      // ignore
    }
  }, []);

  const setAccentOverride = useCallback((accent: "auto" | SeasonalAccent) => {
    setAccentOverrideState(accent);
    if (accent === "auto") {
      localStorage.removeItem("whisk_accent");
    } else {
      localStorage.setItem("whisk_accent", accent);
    }
  }, []);

  return {
    theme: preference,
    resolved,
    setTheme,
    palette,
    setPalette,
    accentOverride,
    setAccentOverride,
  };
}
