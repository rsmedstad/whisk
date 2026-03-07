import { useState, useEffect } from "react";
import { getBrandIcon, type SeasonalAccent, type HolidayBrandIcon } from "../../lib/seasonal";
import {
  WhiskLogo,
  Pumpkin,
  ChristmasTree,
  Snowflake,
  HeartArrow,
  Shamrock,
  EasterEgg,
  Firework,
  TurkeyLeg,
} from "./Icon";

const ICON_MAP: Record<HolidayBrandIcon, typeof WhiskLogo> = {
  whisk: WhiskLogo,
  pumpkin: Pumpkin,
  "christmas-tree": ChristmasTree,
  snowflake: Snowflake,
  "heart-arrow": HeartArrow,
  shamrock: Shamrock,
  "easter-egg": EasterEgg,
  firework: Firework,
  "turkey-leg": TurkeyLeg,
};

interface SeasonalBrandIconProps {
  className?: string;
}

/** Renders the app brand icon — swaps to holiday-themed icons when seasonal theme is active */
export function SeasonalBrandIcon({ className = "w-5 h-5 text-orange-500" }: SeasonalBrandIconProps) {
  const [iconKey, setIconKey] = useState<HolidayBrandIcon>(() => {
    const accent = document.documentElement.getAttribute("data-accent") as SeasonalAccent | null;
    return accent ? getBrandIcon(accent) : "whisk";
  });

  useEffect(() => {
    // Watch for accent attribute changes on <html>
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

  const IconComponent = ICON_MAP[iconKey];

  return (
    <span className="wk-brand-icon inline-flex">
      <IconComponent className={className} />
    </span>
  );
}
