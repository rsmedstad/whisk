// Seasonal & contextual awareness for recipe suggestions

export interface SeasonalContext {
  season: "spring" | "summer" | "fall" | "winter";
  upcomingHolidays: Holiday[];
  seasonalTags: string[];
  seasonalIngredients: string[];
  contextualPrompts: string[];
  greeting: string;
}

export interface Holiday {
  name: string;
  date: Date;
  daysAway: number;
  tags: string[];
  keywords: string[];
}

interface HolidayDef {
  name: string;
  tags: string[];
  keywords: string[];
  /** Returns the date of this holiday for a given year */
  getDate: (year: number) => Date;
}

const HOLIDAYS: HolidayDef[] = [
  { name: "New Year's Day", tags: ["appetizer", "holiday"], keywords: ["party", "brunch", "champagne"], getDate: (y) => new Date(y, 0, 1) },
  { name: "Super Bowl", tags: ["appetizer", "snack", "american"], keywords: ["wings", "dip", "nachos", "game day", "party food"], getDate: (y) => nthWeekdayOfMonth(y, 1, 0, 2) }, // 2nd Sunday in February
  { name: "Valentine's Day", tags: ["dinner", "dessert", "french", "italian"], keywords: ["romantic", "chocolate", "steak", "date night"], getDate: (y) => new Date(y, 1, 14) },
  { name: "St. Patrick's Day", tags: ["dinner", "holiday"], keywords: ["irish", "corned beef", "soda bread", "stew", "green"], getDate: (y) => new Date(y, 2, 17) },
  { name: "Easter", tags: ["brunch", "dinner", "baking", "holiday"], keywords: ["ham", "lamb", "deviled eggs", "hot cross buns", "brunch"], getDate: computeEasterForHolidays },
  { name: "Cinco de Mayo", tags: ["mexican", "dinner"], keywords: ["tacos", "margarita", "guacamole", "fiesta"], getDate: (y) => new Date(y, 4, 5) },
  { name: "Mother's Day", tags: ["brunch", "dessert", "baking"], keywords: ["brunch", "cake", "special", "tea"], getDate: (y) => nthWeekdayOfMonth(y, 4, 0, 2) }, // 2nd Sunday in May
  { name: "Memorial Day", tags: ["grilling", "summer", "american"], keywords: ["bbq", "burgers", "cookout", "picnic"], getDate: (y) => lastWeekdayOfMonth(y, 4, 1) }, // Last Monday in May
  { name: "Father's Day", tags: ["grilling", "dinner"], keywords: ["steak", "bbq", "grilling", "ribs"], getDate: (y) => nthWeekdayOfMonth(y, 5, 0, 3) }, // 3rd Sunday in June
  { name: "4th of July", tags: ["grilling", "summer", "american"], keywords: ["bbq", "picnic", "red white blue", "cookout", "watermelon"], getDate: (y) => new Date(y, 6, 4) },
  { name: "Labor Day", tags: ["grilling", "summer"], keywords: ["bbq", "cookout", "end of summer", "picnic"], getDate: (y) => nthWeekdayOfMonth(y, 8, 1, 1) }, // 1st Monday in September
  { name: "Halloween", tags: ["dessert", "baking", "fall"], keywords: ["pumpkin", "spooky", "candy", "party", "fall treats"], getDate: (y) => new Date(y, 9, 31) },
  { name: "Thanksgiving", tags: ["dinner", "fall", "holiday", "baking"], keywords: ["turkey", "stuffing", "pie", "cranberry", "sides", "gravy"], getDate: (y) => nthWeekdayOfMonth(y, 10, 4, 4) }, // 4th Thursday in November
  { name: "Christmas", tags: ["dinner", "dessert", "baking", "holiday", "winter"], keywords: ["cookies", "ham", "roast", "gingerbread", "festive"], getDate: (y) => new Date(y, 11, 25) },
  { name: "New Year's Eve", tags: ["appetizer", "holiday"], keywords: ["party", "appetizers", "cocktails", "celebration"], getDate: (y) => new Date(y, 11, 31) },
];

/** Placeholder — the real computeEaster is defined later, this avoids forward-reference issues */
function computeEasterForHolidays(year: number): Date {
  // Anonymous Gregorian algorithm (duplicated to avoid circular dep with function defined below)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

/** Last occurrence of a weekday in a month (e.g. last Monday of May = Memorial Day) */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0); // last day of month
  const diff = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - diff);
}

/** Nth weekday of a month (e.g. 4th Thursday of November = Thanksgiving) */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  let dayOfMonth = 1 + ((weekday - first.getDay() + 7) % 7);
  dayOfMonth += (n - 1) * 7;
  return new Date(year, month, dayOfMonth);
}

const SEASONAL_INGREDIENTS: Record<string, string[]> = {
  spring: ["asparagus", "peas", "radish", "artichoke", "strawberry", "rhubarb", "mint", "arugula", "fennel", "fava beans"],
  summer: ["tomato", "corn", "zucchini", "peach", "watermelon", "basil", "berries", "cucumber", "bell pepper", "eggplant"],
  fall: ["pumpkin", "apple", "squash", "sweet potato", "cranberry", "pear", "sage", "brussels sprouts", "cauliflower", "parsnip"],
  winter: ["citrus", "root vegetables", "cabbage", "kale", "pomegranate", "persimmon", "turnip", "leek", "beet", "cinnamon"],
};

export interface SeasonalCategory {
  label: string;
  items: string[];
}

export const SEASONAL_CATEGORIES: Record<string, SeasonalCategory[]> = {
  spring: [
    { label: "Fruit", items: ["strawberry", "rhubarb", "apricot"] },
    { label: "Vegetables", items: ["asparagus", "peas", "radish", "artichoke", "arugula", "fennel", "fava beans"] },
    { label: "Mains", items: ["lamb", "salmon", "shrimp", "chicken"] },
    { label: "Sides", items: ["risotto", "grain salad", "spring rolls", "frittata"] },
  ],
  summer: [
    { label: "Fruit", items: ["peach", "watermelon", "berries", "plum", "nectarine"] },
    { label: "Vegetables", items: ["tomato", "corn", "zucchini", "cucumber", "bell pepper", "eggplant"] },
    { label: "Mains", items: ["grilled fish", "kebabs", "ceviche", "pulled pork"] },
    { label: "Sides", items: ["coleslaw", "caprese", "corn salad", "gazpacho"] },
  ],
  fall: [
    { label: "Fruit", items: ["apple", "pear", "cranberry", "fig", "grape"] },
    { label: "Vegetables", items: ["pumpkin", "squash", "sweet potato", "brussels sprouts", "cauliflower", "parsnip"] },
    { label: "Mains", items: ["braised beef", "roast chicken", "pork chops", "stew"] },
    { label: "Sides", items: ["stuffing", "mashed potatoes", "roasted root vegetables", "soup"] },
  ],
  winter: [
    { label: "Fruit", items: ["citrus", "pomegranate", "persimmon", "blood orange"] },
    { label: "Vegetables", items: ["cabbage", "kale", "turnip", "leek", "beet", "root vegetables"] },
    { label: "Mains", items: ["pot roast", "short ribs", "beef stew", "cassoulet"] },
    { label: "Sides", items: ["gratin", "creamed spinach", "bread pudding", "chowder"] },
  ],
};

const SEASONAL_COOKING: Record<string, string[]> = {
  spring: ["light", "fresh", "salad", "grilling"],
  summer: ["grilling", "no-cook", "fresh", "cold", "ice cream", "smoothie"],
  fall: ["slow cook", "baking", "soup", "stew", "roast", "comfort food"],
  winter: ["slow cook", "baking", "soup", "stew", "comfort food", "one-pot", "hot"],
};

function getSeason(date: Date): "spring" | "summer" | "fall" | "winter" {
  const month = date.getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "fall";
  return "winter";
}

function getUpcomingHolidays(date: Date, windowDays = 21): Holiday[] {
  const now = date.getTime();
  const holidays: Holiday[] = [];

  for (const h of HOLIDAYS) {
    // Check this year and next year
    for (const yearOffset of [0, 1]) {
      const holidayDate = h.getDate(date.getFullYear() + yearOffset);
      const diff = holidayDate.getTime() - now;
      const daysAway = Math.ceil(diff / (1000 * 60 * 60 * 24));

      if (daysAway >= -1 && daysAway <= windowDays) {
        holidays.push({
          name: h.name,
          date: holidayDate,
          daysAway,
          tags: h.tags,
          keywords: h.keywords,
        });
      }
    }
  }

  return holidays.sort((a, b) => a.daysAway - b.daysAway);
}

function getGreeting(season: string, holidays: Holiday[]): string {
  const first = holidays[0];
  if (first && first.daysAway <= 3) {
    if (first.daysAway <= 0) return `Happy ${first.name}!`;
    if (first.daysAway === 1) return `${first.name} is tomorrow!`;
    return `${first.name} is in ${first.daysAway} days!`;
  }

  const seasonGreetings: Record<string, string[]> = {
    spring: ["Fresh spring flavors await", "Time for light & bright dishes"],
    summer: ["Perfect grilling weather", "Cool off with fresh summer recipes"],
    fall: ["Cozy fall cooking season", "Time for comfort food classics"],
    winter: ["Warm up with hearty winter meals", "Perfect weather for slow cooking"],
  };

  const options = seasonGreetings[season] ?? ["What should we cook today?"];
  return options[Math.floor(Math.random() * options.length)] ?? "What should we cook today?";
}

function getContextualPrompts(
  season: string,
  holidays: Holiday[],
  householdSize: number
): string[] {
  const prompts: string[] = [];

  // Holiday-specific prompts
  for (const h of holidays.slice(0, 2)) {
    if (h.daysAway <= 7) {
      if (householdSize > 4) {
        prompts.push(`${h.name} party recipes for a crowd`);
      } else {
        prompts.push(`${h.name} dinner ideas`);
      }
    } else {
      prompts.push(`Planning for ${h.name}`);
    }
  }

  // Season-specific
  const seasonPrompts: Record<string, string[]> = {
    spring: ["Light spring dinners", "What's fresh in spring?"],
    summer: ["Quick no-cook meals", "Summer grilling ideas"],
    fall: ["Cozy soup recipes", "Fall comfort food"],
    winter: ["Warm one-pot meals", "Holiday baking ideas"],
  };
  prompts.push(...(seasonPrompts[season] ?? []));

  // Household-size aware
  if (householdSize >= 6) {
    prompts.push("Feeds a crowd");
  } else if (householdSize <= 2) {
    prompts.push("Date night dinner");
  }

  prompts.push("What can I make tonight?");

  // Deduplicate and limit
  return [...new Set(prompts)].slice(0, 6);
}

export function getSeasonalContext(
  date: Date = new Date(),
  householdSize = 4
): SeasonalContext {
  const season = getSeason(date);
  const upcomingHolidays = getUpcomingHolidays(date);

  // Combine seasonal tags with holiday-specific tags
  const cookingStyles = SEASONAL_COOKING[season] ?? [];
  const seasonalTags: string[] = [season, ...cookingStyles];
  for (const h of upcomingHolidays.slice(0, 2)) {
    seasonalTags.push(...h.tags);
  }

  return {
    season,
    upcomingHolidays,
    seasonalTags: [...new Set(seasonalTags)],
    seasonalIngredients: SEASONAL_INGREDIENTS[season] ?? [],
    contextualPrompts: getContextualPrompts(season, upcomingHolidays, householdSize),
    greeting: getGreeting(season, upcomingHolidays),
  };
}

// ── Accent palette for seasonal theme ────────────────────

export type SeasonalAccent =
  | "valentine"
  | "stpatrick"
  | "easter"
  | "july4th"
  | "halloween"
  | "thanksgiving"
  | "christmas"
  | "spring"
  | "summer"
  | "fall"
  | "winter";

// ── Dynamic holiday accent ranges ──────────────────────────

interface HolidayAccentRange {
  accent: SeasonalAccent;
  start: Date;
  end: Date;
}

/**
 * Build dynamic holiday accent ranges for a given year.
 * Major holidays (Christmas, Halloween) get the longest windows.
 * Minor holidays get shorter windows. Variable-date holidays are computed dynamically.
 */
function getHolidayAccentRanges(year: number): HolidayAccentRange[] {
  const easter = computeEasterForHolidays(year);
  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4); // 4th Thursday of November

  return [
    // Christmas: Dec 1 - Dec 26 (major — full month buildup)
    { accent: "christmas",    start: new Date(year, 11, 1),  end: new Date(year, 11, 26) },
    // Halloween: Oct 10 - Nov 1 (major — 3+ weeks of spooky)
    { accent: "halloween",    start: new Date(year, 9, 10),  end: new Date(year, 10, 1) },
    // Thanksgiving: 10 days before through day after (dynamic date)
    { accent: "thanksgiving", start: addDays(thanksgiving, -10), end: addDays(thanksgiving, 1) },
    // Valentine's Day: Feb 10 - Feb 15 (short buildup + day after)
    { accent: "valentine",    start: new Date(year, 1, 10),  end: new Date(year, 1, 15) },
    // St. Patrick's Day: Mar 14 - Mar 18 (3-day buildup + day after)
    { accent: "stpatrick",    start: new Date(year, 2, 14),  end: new Date(year, 2, 18) },
    // Easter: 7 days before through day after (dynamic date)
    { accent: "easter",       start: addDays(easter, -7),    end: addDays(easter, 1) },
    // 4th of July: Jun 25 - Jul 5 (10 days patriotic)
    { accent: "july4th",      start: new Date(year, 5, 25),  end: new Date(year, 6, 5) },
  ];
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Returns the current accent palette name based on date. Holiday > season fallback. */
export function getSeasonalAccent(date: Date = new Date()): SeasonalAccent {
  const year = date.getFullYear();
  const time = date.getTime();

  // Check holidays first — they override the season default
  // Check current year and next year (for late December checking into Jan holidays)
  for (const y of [year, year + 1]) {
    for (const h of getHolidayAccentRanges(y)) {
      if (time >= h.start.getTime() && time <= h.end.getTime()) {
        return h.accent;
      }
    }
  }

  // Fall back to season
  return getSeason(date);
}

/** Maps an accent to a brand icon name for the header. */
export type HolidayBrandIcon =
  | "whisk"
  | "pumpkin"
  | "christmas-tree"
  | "snowflake"
  | "heart-arrow"
  | "shamrock"
  | "easter-egg"
  | "firework"
  | "turkey-leg";

const BRAND_ICON_MAP: Record<SeasonalAccent, HolidayBrandIcon> = {
  halloween: "pumpkin",
  christmas: "christmas-tree",
  winter: "snowflake",
  valentine: "heart-arrow",
  stpatrick: "shamrock",
  easter: "easter-egg",
  july4th: "firework",
  thanksgiving: "turkey-leg",
  spring: "whisk",
  summer: "whisk",
  fall: "whisk",
};

/** Returns which icon to show as the app brand for the current accent */
export function getBrandIcon(accent: SeasonalAccent): HolidayBrandIcon {
  return BRAND_ICON_MAP[accent];
}

/** Build a context string for AI system prompts */
export function buildSeasonalSystemContext(
  date: Date = new Date(),
  householdSize = 4
): string {
  const ctx = getSeasonalContext(date, householdSize);
  const lines: string[] = [];

  lines.push(`Current date: ${date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`);
  lines.push(`Season: ${ctx.season}`);
  lines.push(`Household size: ${householdSize} ${householdSize === 1 ? "person" : "people"}`);

  if (ctx.upcomingHolidays.length > 0) {
    const holidayList = ctx.upcomingHolidays
      .slice(0, 3)
      .map((h) => `${h.name} (${h.daysAway <= 0 ? "today" : `in ${h.daysAway} days`})`)
      .join(", ");
    lines.push(`Upcoming holidays: ${holidayList}`);
  }

  lines.push(`Seasonal ingredients in peak right now: ${ctx.seasonalIngredients.join(", ")}`);
  lines.push(`Seasonal cooking styles: ${(SEASONAL_COOKING[ctx.season] ?? []).join(", ")}`);

  return lines.join("\n");
}
