import { useMemo } from "react";
import { Card } from "./Card";
import { Leaf, Flower, Sun, Snowflake } from "./Icon";
import { getSeasonalContext, SEASONAL_CATEGORIES } from "../../lib/seasonal";

const SEASON_ICON: Record<string, typeof Leaf> = {
  spring: Flower,
  summer: Sun,
  fall: Leaf,
  winter: Snowflake,
};

const SEASON_ICON_COLOR: Record<string, string> = {
  spring: "text-pink-500 dark:text-pink-400",
  summer: "text-amber-500 dark:text-amber-400",
  fall: "text-orange-600 dark:text-orange-400",
  winter: "text-sky-500 dark:text-sky-400",
};

/** Category icon (inline SVG for small custom icons) */
function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const cn = className ?? "w-3.5 h-3.5";
  switch (category) {
    case "Fruit":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 6.528V3a1 1 0 0 1 1-1h0" />
          <path d="M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21" />
        </svg>
      );
    case "Vegetables":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7zM8.64 14l-2.05-2.04M15.34 15l-2.46-2.46" />
          <path d="M22 9s-1.33-2-3.5-2C16.86 7 15 9 15 9s1.33 2 3.5 2S22 9 22 9z" />
          <path d="M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z" />
        </svg>
      );
    case "Mains":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23" />
          <path d="m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59" />
        </svg>
      );
    case "Sides":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 21h10" />
          <path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z" />
          <path d="M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1" />
          <path d="m13 12 4-4" />
          <path d="M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2" />
        </svg>
      );
    default:
      return null;
  }
}

interface SeasonalProduceCardProps {
  compact?: boolean;
}

/** Displays seasonal produce by category with holiday badge */
export function SeasonalProduceCard({ compact = false }: SeasonalProduceCardProps) {
  const seasonal = useMemo(() => getSeasonalContext(new Date()), []);
  const categories = useMemo(
    () => SEASONAL_CATEGORIES[seasonal.season] ?? [],
    [seasonal.season]
  );

  if (categories.length === 0) return null;

  const SeasonIcon = SEASON_ICON[seasonal.season] ?? Leaf;
  const iconColor = SEASON_ICON_COLOR[seasonal.season] ?? "text-green-600 dark:text-green-400";
  const displayCategories = compact ? categories.slice(0, 3) : categories;

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <SeasonIcon className={`w-4.5 h-4.5 ${iconColor}`} />
        <h2 className={`font-semibold dark:text-stone-100 ${compact ? "text-sm" : "text-base"}`}>
          What&apos;s in Season
        </h2>
        {seasonal.upcomingHolidays.length > 0 && (
          <span className="ml-auto inline-flex items-center rounded-full bg-orange-50 dark:bg-orange-950 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
            {seasonal.upcomingHolidays[0]!.name}
            {seasonal.upcomingHolidays[0]!.daysAway > 0 && (
              <span className="ml-1 text-orange-500/70">{seasonal.upcomingHolidays[0]!.daysAway}d</span>
            )}
          </span>
        )}
      </div>
      <div className="space-y-2.5">
        {displayCategories.map((cat) => (
          <div key={cat.label} className="flex items-start gap-2">
            <CategoryIcon category={cat.label} className="w-4 h-4 text-stone-400 dark:text-stone-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-stone-600 dark:text-stone-300">
                {cat.label}
              </p>
              <p className="text-xs text-stone-400 dark:text-stone-500">
                {compact ? cat.items.slice(0, 4).join(", ") : cat.items.join(", ")}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
