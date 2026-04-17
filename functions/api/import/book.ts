import { readJsonBody, normalizeRecipeInput } from "../../lib/recipe-input";
import { isSafeFetchUrl } from "../../lib/ssrf";

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

interface Env {
  WHISK_KV: KVNamespace;
  WHISK_R2: R2Bucket;
}

interface RecipeIndexEntry {
  id: string;
  title: string;
  tags: string[];
  cuisine?: string;
  favorite: boolean;
  favoritedBy?: string[];
  updatedAt: string;
  thumbnailUrl?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  description?: string;
  sourceUrl?: string;
}

/** Normalize a title for dedup: lowercase, strip punctuation, collapse whitespace.
 *  "Chicken Tikka Masala", "chicken-tikka-masala", and "Chicken  Tikka  Masala!"
 *  all produce the same slug. */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

async function downloadPhoto(
  url: string,
  r2: R2Bucket
): Promise<string | null> {
  if (!isSafeFetchUrl(url)) return null;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Whisk-Import/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const declared = resp.headers.get("content-length");
    if (declared && Number(declared) > MAX_PHOTO_BYTES) return null;
    const contentType = resp.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;

    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > MAX_PHOTO_BYTES) return null;
    const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
    const hashHex = [...new Uint8Array(hashBuf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";

    const key = `photos/${hashHex}.${ext}`;
    await r2.put(key, buffer, { httpMetadata: { contentType } });
    return `/${key}`;
  } catch {
    return null;
  }
}

// POST /api/import/book — Import a single recipe from a book export
// Query params: mode=add|skip|overwrite (default: add)
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const mode = (url.searchParams.get("mode") ?? "add") as "add" | "skip" | "overwrite";
    const body = await readJsonBody(request);
    if (!body.ok) {
      return new Response(JSON.stringify({ error: body.error }), {
        status: body.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const recipe = normalizeRecipeInput(body.data);
    if (!recipe) {
      return new Response(JSON.stringify({ error: "Recipe title is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Load index for duplicate detection
    const index =
      ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[]) ?? [];

    // Slug-based matching collapses case, whitespace, and punctuation so that
    // "Chicken Tikka Masala" and "chicken-tikka-masala" are treated as the
    // same recipe on re-import.
    const incomingSlug = slugifyTitle(recipe.title);
    const existingIdx = index.findIndex((e) => slugifyTitle(e.title) === incomingSlug);
    const existingEntry = existingIdx >= 0 ? index[existingIdx] : undefined;

    // Handle duplicate based on mode
    if (existingEntry) {
      if (mode === "skip") {
        return new Response(
          JSON.stringify({ skipped: true, title: recipe.title, reason: "duplicate" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      // mode === "overwrite": delete the old recipe, then continue to create new
      if (mode === "overwrite") {
        await env.WHISK_KV.delete(`recipe:${existingEntry.id}`);
        index.splice(existingIdx, 1);
      }
      // mode === "add": fall through and create a new entry regardless
    }

    const id = `r_${crypto.randomUUID().split("-")[0]}`;
    const now = new Date().toISOString();

    // Download thumbnail
    let thumbnailUrl = recipe.thumbnailUrl;
    if (thumbnailUrl && (thumbnailUrl.startsWith("http://") || thumbnailUrl.startsWith("https://"))) {
      const local = await downloadPhoto(thumbnailUrl, env.WHISK_R2);
      if (local) thumbnailUrl = local;
    }

    // Download photos
    const photos: { url: string; caption?: string; isPrimary: boolean }[] = [];
    for (const photo of recipe.photos) {
      let url = photo.url;
      if (url.startsWith("http://") || url.startsWith("https://")) {
        const local = await downloadPhoto(url, env.WHISK_R2);
        if (local) url = local;
      }
      photos.push({ ...photo, url });
    }

    // If no thumbnail but has a primary photo, use it
    if (!thumbnailUrl && photos.length > 0) {
      const primary = photos.find((p) => p.isPrimary);
      thumbnailUrl = primary?.url ?? photos[0]?.url;
    }

    const newRecipe = {
      id,
      title: recipe.title,
      description: recipe.description,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      photos,
      thumbnailUrl,
      videoUrl: recipe.videoUrl,
      source: recipe.source,
      tags: recipe.tags,
      cuisine: recipe.cuisine,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      servings: recipe.servings,
      yield: recipe.yield,
      difficulty: recipe.difficulty,
      notes: recipe.notes,
      favorite: false,
      favoritedBy: [],
      createdAt: now,
      updatedAt: now,
    };

    await env.WHISK_KV.put(`recipe:${id}`, JSON.stringify(newRecipe));

    // Update index
    index.unshift({
      id,
      title: newRecipe.title,
      tags: newRecipe.tags,
      cuisine: newRecipe.cuisine,
      favorite: false,
      favoritedBy: [],
      updatedAt: now,
      thumbnailUrl: newRecipe.thumbnailUrl,
      prepTime: newRecipe.prepTime,
      cookTime: newRecipe.cookTime,
      servings: newRecipe.servings,
      description: newRecipe.description,
      sourceUrl: (newRecipe.source as { url?: string } | undefined)?.url,
    });

    await env.WHISK_KV.put("recipes:index", JSON.stringify(index));

    return new Response(JSON.stringify({ id, title: newRecipe.title }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Import failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
