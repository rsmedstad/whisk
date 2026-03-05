import type { Ingredient } from "../types";

// ── Formatting ──────────────────────────────────────────

export function formatTime(minutes: number | undefined): string {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatTotalTime(
  prep?: number,
  cook?: number
): string {
  const total = (prep ?? 0) + (cook ?? 0);
  if (!total) return "";
  return formatTime(total);
}

export function formatTimerDisplay(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Ingredient Scaling ──────────────────────────────────

export function scaleIngredient(
  ingredient: Ingredient,
  originalServings: number,
  targetServings: number
): Ingredient {
  if (!ingredient.amount || !originalServings || !targetServings) {
    return ingredient;
  }

  const parsed = parseFraction(ingredient.amount);
  if (parsed === null) return ingredient;

  const scaled = (parsed / originalServings) * targetServings;
  return {
    ...ingredient,
    amount: formatFraction(scaled),
  };
}

export function parseFraction(str: string): number | null {
  str = str.trim();

  // Mixed number: "1 1/2"
  const mixed = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    return parseInt(mixed[1]!) + parseInt(mixed[2]!) / parseInt(mixed[3]!);
  }

  // Fraction: "1/2"
  const frac = str.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    return parseInt(frac[1]!) / parseInt(frac[2]!);
  }

  // Decimal or integer
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

const COMMON_FRACTIONS: [number, string][] = [
  [0.125, "1/8"],
  [0.25, "1/4"],
  [0.333, "1/3"],
  [0.375, "3/8"],
  [0.5, "1/2"],
  [0.625, "5/8"],
  [0.667, "2/3"],
  [0.75, "3/4"],
  [0.875, "7/8"],
];

export function formatFraction(value: number): string {
  if (value <= 0) return "0";

  const whole = Math.floor(value);
  const frac = value - whole;

  if (frac < 0.05) return whole.toString();

  // Find closest common fraction
  let closest = "";
  let minDiff = Infinity;
  for (const [threshold, display] of COMMON_FRACTIONS) {
    const diff = Math.abs(frac - threshold);
    if (diff < minDiff) {
      minDiff = diff;
      closest = display;
    }
  }

  if (minDiff < 0.05) {
    return whole > 0 ? `${whole} ${closest}` : closest;
  }

  // Fall back to rounded decimal
  const rounded = Math.round(value * 100) / 100;
  return rounded.toString();
}

// ── Timer Parsing ───────────────────────────────────────

export function parseTimerFromText(text: string): number | null {
  // Match patterns like "15 min", "20 minutes", "1 hour", "1.5 hours", "3 min per side"
  const patterns = [
    /(\d+(?:\.\d+)?)\s*hours?/i,
    /(\d+(?:\.\d+)?)\s*hrs?/i,
    /(\d+)\s*min(?:utes?)?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const val = parseFloat(match[1]!);
      if (pattern.source.includes("hour") || pattern.source.includes("hr")) {
        return Math.round(val * 60);
      }
      return Math.round(val);
    }
  }

  return null;
}

// ── Search ──────────────────────────────────────────────

export function normalizeSearch(text: string): string {
  return text.toLowerCase().trim();
}

// ── Date Helpers ────────────────────────────────────────

export function getWeekId(date: Date): string {
  const year = date.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const days = Math.floor(
    (date.getTime() - startOfYear.getTime()) / 86400000
  );
  const week = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${year}-W${week.toString().padStart(2, "0")}`;
}

export function getWeekDates(date: Date): Date[] {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const monday = new Date(date);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function toDateString(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

// ── Text ────────────────────────────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ndash: "\u2013", mdash: "\u2014",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
  deg: "\u00B0", frac12: "\u00BD", frac14: "\u00BC", frac34: "\u00BE",
};

/** Decode HTML entities (&#123; &#xAB; &amp;) in recipe text from scraped sources. */
export function decodeEntities(str: string): string {
  if (!str.includes("&")) return str;
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES[name.toLowerCase()] ?? match);
}

// ── Misc ────────────────────────────────────────────────

export function classNames(
  ...classes: (string | boolean | undefined | null)[]
): string {
  return classes.filter(Boolean).join(" ");
}
