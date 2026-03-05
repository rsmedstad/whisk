import { useState, useEffect, useCallback } from "react";
import type { AppStyle } from "../types";

const VALID_STYLES: AppStyle[] = ["modern", "editorial", "soft", "brutalist", "glass"];

function applyStyle(style: AppStyle) {
  if (style === "modern") {
    document.documentElement.removeAttribute("data-style");
  } else {
    document.documentElement.setAttribute("data-style", style);
  }
}

export function useStyle() {
  const [style, setStyleState] = useState<AppStyle>(() => {
    const stored = localStorage.getItem("whisk_style") as AppStyle | null;
    return stored && VALID_STYLES.includes(stored) ? stored : "modern";
  });

  useEffect(() => {
    applyStyle(style);
  }, [style]);

  const setStyle = useCallback((s: AppStyle) => {
    setStyleState(s);
    localStorage.setItem("whisk_style", s);
  }, []);

  return { style, setStyle };
}
