import { useState, useEffect } from "react";
import { getBrandIcon, type SeasonalAccent, type HolidayBrandIcon } from "../../lib/seasonal";
import { WhiskLogo } from "./Icon";

/** Emoji mapping for holiday brand icons — preferred over SVG for consistency */
const BRAND_EMOJI: Record<HolidayBrandIcon, string> = {
  whisk: "", // fallback to SVG WhiskLogo
  pumpkin: "🎃",
  "christmas-tree": "🎄",
  snowflake: "❄️",
  "heart-arrow": "💘",
  shamrock: "☘️",
  "easter-egg": "🐣",
  firework: "🎆",
  "turkey-leg": "🦃",
};

interface SeasonalBrandIconProps {
  className?: string;
}

/** Renders the app brand icon — swaps to holiday-themed emoji when seasonal theme is active */
export function SeasonalBrandIcon({ className = "w-5 h-5 text-orange-500" }: SeasonalBrandIconProps) {
  const [iconKey, setIconKey] = useState<HolidayBrandIcon>(() => {
    const accent = document.documentElement.getAttribute("data-accent") as SeasonalAccent | null;
    return accent ? getBrandIcon(accent) : "whisk";
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const accent = document.documentElement.getAttribute("data-accent") as SeasonalAccent | null;
      setIconKey(accent ? getBrandIcon(accent) : "whisk");
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-accent"],
    });

    return () => observer.disconnect();
  }, []);

  const emoji = BRAND_EMOJI[iconKey];

  // Use WhiskLogo SVG for default/non-holiday, emoji for holidays
  if (!emoji) {
    return (
      <span className="wk-brand-icon inline-flex">
        <WhiskLogo className={className} />
      </span>
    );
  }

  return (
    <span className="wk-brand-icon inline-flex items-center justify-center" role="img" aria-label={iconKey}>
      <span className="text-lg leading-none">{emoji}</span>
    </span>
  );
}
