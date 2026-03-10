import { useState, useEffect, type ComponentType } from "react";
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
  type IconProps,
} from "./Icon";

/** SVG component mapping for holiday brand icons */
const BRAND_ICONS: Record<HolidayBrandIcon, ComponentType<IconProps> | null> = {
  whisk: null, // fallback to WhiskLogo
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

/** Renders the app brand icon — swaps to holiday-themed SVG when seasonal theme is active */
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

  const IconComponent = BRAND_ICONS[iconKey];

  if (!IconComponent) {
    return (
      <span className="wk-brand-icon inline-flex">
        <WhiskLogo className={className} />
      </span>
    );
  }

  return (
    <span className="wk-brand-icon inline-flex">
      <IconComponent className={className} />
    </span>
  );
}
