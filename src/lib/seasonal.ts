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

const HOLIDAYS: {
  name: string;
  month: number;
  day: number;
  tags: string[];
  keywords: string[];
}[] = [
  { name: "New Year's Day", month: 0, day: 1, tags: ["appetizer", "holiday"], keywords: ["party", "brunch", "champagne"] },
  { name: "Super Bowl", month: 1, day: 9, tags: ["appetizer", "snack", "american"], keywords: ["wings", "dip", "nachos", "game day", "party food"] },
  { name: "Valentine's Day", month: 1, day: 14, tags: ["dinner", "dessert", "french", "italian"], keywords: ["romantic", "chocolate", "steak", "date night"] },
  { name: "St. Patrick's Day", month: 2, day: 17, tags: ["dinner", "holiday"], keywords: ["irish", "corned beef", "soda bread", "stew", "green"] },
  { name: "Easter", month: 3, day: 20, tags: ["brunch", "dinner", "baking", "holiday"], keywords: ["ham", "lamb", "deviled eggs", "hot cross buns", "brunch"] },
  { name: "Cinco de Mayo", month: 4, day: 5, tags: ["mexican", "dinner"], keywords: ["tacos", "margarita", "guacamole", "fiesta"] },
  { name: "Mother's Day", month: 4, day: 11, tags: ["brunch", "dessert", "baking"], keywords: ["brunch", "cake", "special", "tea"] },
  { name: "Memorial Day", month: 4, day: 26, tags: ["grilling", "summer", "american"], keywords: ["bbq", "burgers", "cookout", "picnic"] },
  { name: "Father's Day", month: 5, day: 15, tags: ["grilling", "dinner"], keywords: ["steak", "bbq", "grilling", "ribs"] },
  { name: "4th of July", month: 6, day: 4, tags: ["grilling", "summer", "american"], keywords: ["bbq", "picnic", "red white blue", "cookout", "watermelon"] },
  { name: "Labor Day", month: 8, day: 1, tags: ["grilling", "summer"], keywords: ["bbq", "cookout", "end of summer", "picnic"] },
  { name: "Halloween", month: 9, day: 31, tags: ["dessert", "baking", "fall"], keywords: ["pumpkin", "spooky", "candy", "party", "fall treats"] },
  { name: "Thanksgiving", month: 10, day: 27, tags: ["dinner", "fall", "holiday", "baking"], keywords: ["turkey", "stuffing", "pie", "cranberry", "sides", "gravy"] },
  { name: "Christmas", month: 11, day: 25, tags: ["dinner", "dessert", "baking", "holiday", "winter"], keywords: ["cookies", "ham", "roast", "gingerbread", "festive"] },
  { name: "New Year's Eve", month: 11, day: 31, tags: ["appetizer", "holiday"], keywords: ["party", "appetizers", "cocktails", "celebration"] },
];

const SEASONAL_INGREDIENTS: Record<string, string[]> = {
  spring: ["asparagus", "peas", "radish", "artichoke", "strawberry", "rhubarb", "mint", "arugula", "fennel", "fava beans"],
  summer: ["tomato", "corn", "zucchini", "peach", "watermelon", "basil", "berries", "cucumber", "bell pepper", "eggplant"],
  fall: ["pumpkin", "apple", "squash", "sweet potato", "cranberry", "pear", "sage", "brussels sprouts", "cauliflower", "parsnip"],
  winter: ["citrus", "root vegetables", "cabbage", "kale", "pomegranate", "persimmon", "turnip", "leek", "beet", "cinnamon"],
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
      const holidayDate = new Date(date.getFullYear() + yearOffset, h.month, h.day);
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

// Holiday name → CSS accent name. Holidays take priority when within range.
const HOLIDAY_ACCENT_MAP: { name: string; accent: SeasonalAccent; startMonth: number; startDay: number; endMonth: number; endDay: number }[] = [
  { name: "Christmas",       accent: "christmas",    startMonth: 11, startDay: 1,  endMonth: 11, endDay: 26 },
  { name: "Valentine's Day", accent: "valentine",    startMonth: 1,  startDay: 1,  endMonth: 1,  endDay: 15 },
  { name: "St. Patrick's Day", accent: "stpatrick",  startMonth: 2,  startDay: 10, endMonth: 2,  endDay: 17 },
  { name: "Easter",          accent: "easter",       startMonth: 3,  startDay: 7,  endMonth: 3,  endDay: 21 },
  { name: "4th of July",     accent: "july4th",      startMonth: 5,  startDay: 25, endMonth: 6,  endDay: 5 },
  { name: "Halloween",       accent: "halloween",    startMonth: 9,  startDay: 15, endMonth: 9,  endDay: 31 },
  { name: "Thanksgiving",    accent: "thanksgiving", startMonth: 10, startDay: 18, endMonth: 10, endDay: 28 },
];

/** Returns the current accent palette name based on date. Holiday > season fallback. */
export function getSeasonalAccent(date: Date = new Date()): SeasonalAccent {
  const month = date.getMonth();
  const day = date.getDate();

  // Check holidays first — they override the season default
  for (const h of HOLIDAY_ACCENT_MAP) {
    const afterStart = month > h.startMonth || (month === h.startMonth && day >= h.startDay);
    const beforeEnd = month < h.endMonth || (month === h.endMonth && day <= h.endDay);
    if (afterStart && beforeEnd) return h.accent;
  }

  // Fall back to season
  return getSeason(date);
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
