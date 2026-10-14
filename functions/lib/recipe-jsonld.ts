import { isSafeFetchUrl } from "./ssrf";

export const CLIENT_JSONLD_MAX_BYTES = 256 * 1024;
export const CLIENT_JSONLD_MAX_STRING = 8_000;
export const CLIENT_JSONLD_MAX_INGREDIENTS = 200;
export const CLIENT_JSONLD_MAX_STEPS = 120;

export type ClientJsonLdErrorCode =
  | "jsonld_too_large"
  | "jsonld_invalid"
  | "jsonld_not_recipe"
  | "jsonld_url_mismatch";

export interface ClientJsonLdOk {
  ok: true;
  recipe: Record<string, unknown>;
}

export interface ClientJsonLdErr {
  ok: false;
  error: string;
  code: ClientJsonLdErrorCode;
}

export type ClientJsonLdResult = ClientJsonLdOk | ClientJsonLdErr;

/** Walk JSON-LD (arrays, @graph, mainEntity) and return the Recipe node. */
export function findRecipeObject(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeObject(item);
      if (found) return found;
    }
    return null;
  }
  const obj = data as Record<string, unknown>;
  if (isRecipeType(obj["@type"])) return obj;
  if (Array.isArray(obj["@graph"])) {
    const found = findRecipeObject(obj["@graph"]);
    if (found) return found;
  }
  if (obj.mainEntity) {
    const found = findRecipeObject(obj.mainEntity);
    if (found) return found;
  }
  return null;
}

function isRecipeType(type: unknown): boolean {
  if (type === "Recipe") return true;
  if (typeof type === "string" && type.endsWith("/Recipe")) return true;
  if (Array.isArray(type)) return type.some((t) => t === "Recipe" || (typeof t === "string" && t.endsWith("/Recipe")));
  return false;
}

export function hostKey(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Pull declared page URLs from a Recipe node (url / mainEntityOfPage / @id). */
export function jsonLdDeclaredUrls(recipe: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      out.push(value);
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.url === "string" && /^https?:\/\//i.test(obj.url)) out.push(obj.url);
      else if (typeof obj["@id"] === "string" && /^https?:\/\//i.test(obj["@id"])) out.push(obj["@id"]);
    }
  };
  add(recipe.url);
  add(recipe.mainEntityOfPage);
  return out;
}

export function sourceUrlMatchesJsonLd(sourceUrl: string, recipe: Record<string, unknown>): boolean {
  const declared = jsonLdDeclaredUrls(recipe);
  if (declared.length === 0) return true;
  const src = hostKey(sourceUrl);
  if (!src) return false;
  return declared.some((d) => hostKey(d) === src);
}

export function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function capString(value: string): string {
  const cleaned = stripHtml(value);
  return cleaned.length > CLIENT_JSONLD_MAX_STRING
    ? cleaned.slice(0, CLIENT_JSONLD_MAX_STRING)
    : cleaned;
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (value == null) return value;
  if (typeof value === "string") return capString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 250).map((item) => sanitizeUnknown(item, depth + 1));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      if (key.startsWith("@") || /^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
        out[key] = sanitizeUnknown(val, depth + 1);
      }
    }
    return out;
  }
  return undefined;
}

const RECIPE_KEYS = new Set([
  "@context",
  "@type",
  "@id",
  "name",
  "description",
  "image",
  "recipeIngredient",
  "recipeInstructions",
  "prepTime",
  "cookTime",
  "totalTime",
  "recipeYield",
  "recipeCategory",
  "recipeCuisine",
  "keywords",
  "aggregateRating",
  "url",
  "mainEntityOfPage",
  "author",
  "nutrition",
  "video",
]);

function whitelistRecipe(recipe: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { "@type": "Recipe" };
  for (const key of RECIPE_KEYS) {
    if (key in recipe && recipe[key] !== undefined) {
      out[key] = sanitizeUnknown(recipe[key]);
    }
  }
  if (Array.isArray(out.recipeIngredient)) {
    out.recipeIngredient = out.recipeIngredient.slice(0, CLIENT_JSONLD_MAX_INGREDIENTS);
  }
  if (Array.isArray(out.recipeInstructions)) {
    out.recipeInstructions = out.recipeInstructions.slice(0, CLIENT_JSONLD_MAX_STEPS);
  } else if (typeof out.recipeInstructions === "string" && out.recipeInstructions) {
    out.recipeInstructions = [out.recipeInstructions];
  }
  // Drop unsafe image URLs (javascript:, data:, internal hosts)
  out.image = filterImages(out.image);
  return out;
}

function filterImages(image: unknown): unknown {
  const keep = (url: string): boolean => isSafeFetchUrl(url);
  if (typeof image === "string") return keep(image) ? image : undefined;
  if (Array.isArray(image)) {
    return image
      .map((item) => {
        if (typeof item === "string") return keep(item) ? item : undefined;
        if (item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string") {
          const url = (item as { url: string }).url;
          return keep(url) ? item : undefined;
        }
        return undefined;
      })
      .filter(Boolean);
  }
  if (image && typeof image === "object" && typeof (image as { url?: unknown }).url === "string") {
    return isSafeFetchUrl((image as { url: string }).url) ? image : undefined;
  }
  return undefined;
}

function rawSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function ingredientCount(recipe: Record<string, unknown>): number {
  const raw = recipe.recipeIngredient;
  if (typeof raw === "string") return raw.trim() ? 1 : 0;
  if (!Array.isArray(raw)) return 0;
  return raw.filter((item) => {
    if (typeof item === "string") return item.trim().length > 0;
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      return typeof obj.name === "string" || typeof obj.text === "string";
    }
    return false;
  }).length;
}

/** Endpoint-shaped result for POST /api/import/url { jsonLd }. */
export function clientJsonLdImportResult(
  raw: unknown,
  sourceUrl: string,
): {
  status: number;
  body: { error?: string; code?: ClientJsonLdErrorCode; ok?: true };
  html?: string;
  recipe?: Record<string, unknown>;
} {
  const result = validateClientJsonLd(raw, sourceUrl);
  if (!result.ok) {
    return { status: 400, body: { error: result.error, code: result.code } };
  }
  return {
    status: 200,
    body: { ok: true },
    recipe: result.recipe,
    html: `<script type="application/ld+json">${JSON.stringify(result.recipe)}</script>`,
  };
}

/** Validate, size-cap, schema-check, host-match, and sanitize client JSON-LD. */
export function validateClientJsonLd(raw: unknown, sourceUrl: string): ClientJsonLdResult {
  if (rawSize(raw) > CLIENT_JSONLD_MAX_BYTES) {
    return { ok: false, code: "jsonld_too_large", error: "Recipe data is too large." };
  }
  const recipe = findRecipeObject(raw);
  if (!recipe) {
    return { ok: false, code: "jsonld_not_recipe", error: "No Recipe JSON-LD was found in the payload." };
  }
  const name = typeof recipe.name === "string" ? stripHtml(recipe.name) : "";
  if (!name || ingredientCount(recipe) === 0) {
    return {
      ok: false,
      code: "jsonld_invalid",
      error: "Recipe JSON-LD must include a name and at least one ingredient.",
    };
  }
  if (!sourceUrlMatchesJsonLd(sourceUrl, recipe)) {
    return {
      ok: false,
      code: "jsonld_url_mismatch",
      error: "The recipe's JSON-LD URL does not match the page you sent.",
    };
  }
  return { ok: true, recipe: whitelistRecipe({ ...recipe, name }) };
}
