// Shared input validation for recipe ingestion endpoints.
// Keeps untrusted JSON from growing unbounded arrays or slipping through
// malformed shapes that later crash the KV index or UI.

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_TITLE_LEN = 500;
export const MAX_DESC_LEN = 10_000;
export const MAX_NOTES_LEN = 20_000;
export const MAX_CUISINE_LEN = 100;
export const MAX_YIELD_LEN = 200;
export const MAX_TAG_COUNT = 100;
export const MAX_TAG_LEN = 100;
export const MAX_INGREDIENTS = 500;
export const MAX_STEPS = 200;
export const MAX_PHOTOS = 50;
export const MAX_INGREDIENT_NAME_LEN = 500;
export const MAX_STEP_TEXT_LEN = 5_000;
export const MAX_URL_LEN = 2048;

export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

/** Read + parse a JSON body with a size cap. Prefer over `request.json()`. */
export async function readJsonBody<T = unknown>(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES
): Promise<ReadResult<T>> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: "Failed to read body", status: 400 };
  }
  // Byte length, not char length — surrogate pairs count as 4 bytes.
  const byteLen = new TextEncoder().encode(text).length;
  if (byteLen > maxBytes) {
    return { ok: false, error: "Request body too large", status: 413 };
  }
  if (!text) return { ok: true, data: {} as T };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "Invalid JSON", status: 400 };
  }
}

function clampStr(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

function clampFiniteNumber(v: unknown, min = 0, max = 1_000_000): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function clampStringArray(
  v: unknown,
  maxCount: number,
  maxItemLen: number
): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v.slice(0, maxCount)) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t) continue;
    out.push(t.length > maxItemLen ? t.slice(0, maxItemLen) : t);
  }
  return out;
}

export interface NormalizedIngredient {
  name: string;
  amount?: string;
  unit?: string;
  group?: string;
  category?: string;
}

export interface NormalizedStep {
  text: string;
  photoUrl?: string;
  timerMinutes?: number;
  group?: string;
}

export interface NormalizedPhoto {
  url: string;
  caption?: string;
  isPrimary: boolean;
}

export interface NormalizedRecipe {
  title: string;
  description?: string;
  ingredients: NormalizedIngredient[];
  steps: NormalizedStep[];
  photos: NormalizedPhoto[];
  thumbnailUrl?: string;
  videoUrl?: string;
  source?: unknown;
  tags: string[];
  cuisine?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  yield?: string;
  difficulty?: "easy" | "medium" | "hard";
  notes?: string;
  sourceRating?: number;
  sourceRatingCount?: number;
  favorite: boolean;
  wantToMake?: boolean;
}

function normalizeIngredient(v: unknown): NormalizedIngredient | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = clampStr(o.name, MAX_INGREDIENT_NAME_LEN);
  if (!name) return null;
  return {
    name,
    amount: clampStr(o.amount, 100),
    unit: clampStr(o.unit, 50),
    group: clampStr(o.group, 100),
    category: clampStr(o.category, 100),
  };
}

function normalizeStep(v: unknown): NormalizedStep | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const text = clampStr(o.text, MAX_STEP_TEXT_LEN);
  if (!text) return null;
  return {
    text,
    photoUrl: clampStr(o.photoUrl, MAX_URL_LEN),
    timerMinutes: clampFiniteNumber(o.timerMinutes, 0, 24 * 60),
    group: clampStr(o.group, 100),
  };
}

function normalizePhoto(v: unknown): NormalizedPhoto | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const url = clampStr(o.url, MAX_URL_LEN);
  if (!url) return null;
  return {
    url,
    caption: clampStr(o.caption, 500),
    isPrimary: Boolean(o.isPrimary),
  };
}

function normalizeDifficulty(v: unknown): "easy" | "medium" | "hard" | undefined {
  return v === "easy" || v === "medium" || v === "hard" ? v : undefined;
}

function normalizeRating(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < 0) return 0;
  if (v > 5) return 5;
  return Math.round(v * 10) / 10;
}

/** Validate a recipe-shaped JSON object and return a clamped/cleaned copy.
 *  Returns null if title is missing or not a non-empty string. */
export function normalizeRecipeInput(raw: unknown): NormalizedRecipe | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const title = clampStr(o.title, MAX_TITLE_LEN);
  if (!title) return null;

  const rawIngredients = Array.isArray(o.ingredients)
    ? (o.ingredients as unknown[]).slice(0, MAX_INGREDIENTS)
    : [];
  const ingredients = rawIngredients
    .map(normalizeIngredient)
    .filter((i): i is NormalizedIngredient => i !== null);

  const rawSteps = Array.isArray(o.steps)
    ? (o.steps as unknown[]).slice(0, MAX_STEPS)
    : [];
  const steps = rawSteps
    .map(normalizeStep)
    .filter((s): s is NormalizedStep => s !== null);

  const rawPhotos = Array.isArray(o.photos)
    ? (o.photos as unknown[]).slice(0, MAX_PHOTOS)
    : [];
  const photos = rawPhotos
    .map(normalizePhoto)
    .filter((p): p is NormalizedPhoto => p !== null);

  return {
    title,
    description: clampStr(o.description, MAX_DESC_LEN),
    ingredients,
    steps,
    photos,
    thumbnailUrl: clampStr(o.thumbnailUrl, MAX_URL_LEN),
    videoUrl: clampStr(o.videoUrl, MAX_URL_LEN),
    source: typeof o.source === "object" ? o.source : undefined,
    tags: clampStringArray(o.tags, MAX_TAG_COUNT, MAX_TAG_LEN),
    cuisine: clampStr(o.cuisine, MAX_CUISINE_LEN),
    prepTime: clampFiniteNumber(o.prepTime, 0, 10_000),
    cookTime: clampFiniteNumber(o.cookTime, 0, 10_000),
    servings: clampFiniteNumber(o.servings, 0, 10_000),
    yield: clampStr(o.yield, MAX_YIELD_LEN),
    difficulty: normalizeDifficulty(o.difficulty),
    notes: clampStr(o.notes, MAX_NOTES_LEN),
    sourceRating: normalizeRating(o.sourceRating),
    sourceRatingCount: clampFiniteNumber(o.sourceRatingCount, 0, 10_000_000),
    favorite: Boolean(o.favorite),
    wantToMake: typeof o.wantToMake === "boolean" ? o.wantToMake : undefined,
  };
}
