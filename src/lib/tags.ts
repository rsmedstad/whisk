import type { TagDefinition, TagGroup } from "../types";

export const PRESET_TAGS: TagDefinition[] = [
  // Meal
  { name: "breakfast", type: "preset", group: "meal", usageCount: 0 },
  { name: "brunch", type: "preset", group: "meal", usageCount: 0 },
  { name: "dinner", type: "preset", group: "meal", usageCount: 0 },
  { name: "salad", type: "preset", group: "meal", usageCount: 0 },
  { name: "dessert", type: "preset", group: "meal", usageCount: 0 },
  { name: "appetizer", type: "preset", group: "meal", usageCount: 0 },
  { name: "snack", type: "preset", group: "meal", usageCount: 0 },
  { name: "side dish", type: "preset", group: "meal", usageCount: 0 },
  { name: "drinks", type: "preset", group: "meal", usageCount: 0 },

  // Cuisine
  { name: "italian", type: "preset", group: "cuisine", usageCount: 0 },
  { name: "mexican", type: "preset", group: "cuisine", usageCount: 0 },
  { name: "chinese", type: "preset", group: "cuisine", usageCount: 0 },
  { name: "thai", type: "preset", group: "cuisine", usageCount: 0 },
  { name: "indian", type: "preset", group: "cuisine", usageCount: 0 },
  { name: "japanese", type: "preset", group: "cuisine", usageCount: 0 },
  { name: "korean", type: "preset", group: "cuisine", usageCount: 0 },
  { name: "mediterranean", type: "preset", group: "cuisine", usageCount: 0 },
  { name: "american", type: "preset", group: "cuisine", usageCount: 0 },
  { name: "french", type: "preset", group: "cuisine", usageCount: 0 },

  // Diet
  { name: "vegetarian", type: "preset", group: "diet", usageCount: 0 },
  { name: "vegan", type: "preset", group: "diet", usageCount: 0 },
  { name: "gluten-free", type: "preset", group: "diet", usageCount: 0 },
  { name: "dairy-free", type: "preset", group: "diet", usageCount: 0 },
  { name: "keto", type: "preset", group: "diet", usageCount: 0 },
  { name: "low-carb", type: "preset", group: "diet", usageCount: 0 },
  { name: "healthy", type: "preset", group: "diet", usageCount: 0 },

  // Method
  { name: "grilling", type: "preset", group: "method", usageCount: 0 },
  { name: "baking", type: "preset", group: "method", usageCount: 0 },
  { name: "slow cook", type: "preset", group: "method", usageCount: 0 },
  { name: "instant pot", type: "preset", group: "method", usageCount: 0 },
  { name: "one-pot", type: "preset", group: "method", usageCount: 0 },
  { name: "air fryer", type: "preset", group: "method", usageCount: 0 },
  { name: "no-cook", type: "preset", group: "method", usageCount: 0 },
  { name: "stir-fry", type: "preset", group: "method", usageCount: 0 },

  // Speed
  { name: "under 30 min", type: "preset", group: "speed", usageCount: 0 },
  { name: "quick", type: "preset", group: "speed", usageCount: 0 },
  { name: "weeknight", type: "preset", group: "speed", usageCount: 0 },
  { name: "meal prep", type: "preset", group: "speed", usageCount: 0 },

  // Season
  { name: "summer", type: "preset", group: "season", usageCount: 0 },
  { name: "fall", type: "preset", group: "season", usageCount: 0 },
  { name: "winter", type: "preset", group: "season", usageCount: 0 },
  { name: "spring", type: "preset", group: "season", usageCount: 0 },
  { name: "christmas", type: "preset", group: "season", usageCount: 0 },
  { name: "thanksgiving", type: "preset", group: "season", usageCount: 0 },
  { name: "halloween", type: "preset", group: "season", usageCount: 0 },
  { name: "easter", type: "preset", group: "season", usageCount: 0 },
  { name: "july 4th", type: "preset", group: "season", usageCount: 0 },
  { name: "valentines", type: "preset", group: "season", usageCount: 0 },
  { name: "st patricks", type: "preset", group: "season", usageCount: 0 },
  { name: "cinco de mayo", type: "preset", group: "season", usageCount: 0 },
];

export const TAG_GROUP_LABELS: Record<TagGroup, string> = {
  meal: "Meal",
  cuisine: "Cuisine",
  diet: "Diet",
  method: "Method",
  speed: "Speed",
  season: "Season",
  custom: "Custom",
};

export const TAG_GROUP_ORDER: TagGroup[] = [
  "meal",
  "cuisine",
  "diet",
  "method",
  "speed",
  "season",
  "custom",
];

// Speed tags that are auto-derived from time data (not "meal prep" — that's a style choice)
const AUTO_SPEED_TAGS = new Set(["under 30 min", "quick", "weeknight"]);

export function deriveSpeedTags(prepTime?: number, cookTime?: number): string[] {
  const total = (prepTime ?? 0) + (cookTime ?? 0);
  if (total <= 0) return [];
  if (total <= 30) return ["under 30 min", "quick", "weeknight"];
  if (total <= 45) return ["weeknight"];
  return [];
}

export function mergeSpeedTags(existingTags: string[], prepTime?: number, cookTime?: number): string[] {
  const filtered = existingTags.filter((t) => !AUTO_SPEED_TAGS.has(t));
  const derived = deriveSpeedTags(prepTime, cookTime);
  return [...new Set([...filtered, ...derived])];
}

export const PRESET_TAG_NAMES = PRESET_TAGS.map((t) => t.name);

export function getTagsByGroup(
  tags: TagDefinition[]
): Map<TagGroup, TagDefinition[]> {
  const grouped = new Map<TagGroup, TagDefinition[]>();
  for (const group of TAG_GROUP_ORDER) {
    grouped.set(group, []);
  }
  for (const tag of tags) {
    const group = (tag.group ?? "custom") as TagGroup;
    const list = grouped.get(group) ?? [];
    list.push(tag);
    grouped.set(group, list);
  }
  return grouped;
}
