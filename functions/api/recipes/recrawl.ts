interface Env {
  WHISK_KV: KVNamespace;
  WHISK_R2: R2Bucket;
}

interface RecipeIndexEntry {
  id: string;
  title: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  [key: string]: unknown;
}

interface RecipeDetail {
  id: string;
  title: string;
  thumbnailUrl?: string;
  source?: { url?: string; type?: string };
  photos?: { url: string; isPrimary: boolean }[];
  [key: string]: unknown;
}

async function downloadPhoto(
  url: string,
  r2: R2Bucket
): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok || !resp.body) return null;

    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength < 1000) return null; // too small, likely an error page

    const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
    const hashHex = [...new Uint8Array(hashBuf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    const contentType = resp.headers.get("content-type") ?? "image/jpeg";
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

function extractImageFromHtml(html: string): string | null {
  // Try JSON-LD first
  const ldMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (ldMatch) {
    for (const block of ldMatch) {
      const json = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
      try {
        const data = JSON.parse(json);
        const recipes = Array.isArray(data) ? data : data["@graph"] ?? [data];
        for (const item of recipes) {
          if (item["@type"] === "Recipe" || (Array.isArray(item["@type"]) && item["@type"].includes("Recipe"))) {
            const img = item.image;
            if (typeof img === "string") return img;
            if (Array.isArray(img)) return typeof img[0] === "string" ? img[0] : (img[0] as { url?: string })?.url ?? null;
            if (img?.url) return img.url;
          }
        }
      } catch { /* skip invalid JSON-LD */ }
    }
  }

  // Try og:image
  const ogMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i);
  if (ogMatch?.[1]) return ogMatch[1];

  return null;
}

// POST /api/recipes/recrawl — Re-fetch images for recipes that have sourceUrl but missing/broken thumbnails
export const onRequestPost: PagesFunction<Env> = async ({ env }) => {
  try {
    const index =
      ((await env.WHISK_KV.get("recipes:index", "json")) as RecipeIndexEntry[]) ?? [];

    // Find recipes that have a source URL and either no thumbnail or an external thumbnail
    const candidates = index.filter((e) => {
      if (!e.sourceUrl) return false;
      // No thumbnail, or thumbnail is an external URL (not stored in R2)
      return !e.thumbnailUrl || e.thumbnailUrl.startsWith("http");
    });

    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({ updated: 0, message: "All recipes already have local images" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    let updated = 0;
    const errors: string[] = [];

    // Process up to 10 recipes per request to stay within CF time limits
    const batch = candidates.slice(0, 10);

    for (const entry of batch) {
      try {
        const recipe = (await env.WHISK_KV.get(
          `recipe:${entry.id}`,
          "json"
        )) as RecipeDetail | null;
        if (!recipe) continue;

        const sourceUrl = entry.sourceUrl ?? recipe.source?.url;
        if (!sourceUrl) continue;

        // Strategy 1: If thumbnail is an external URL, try downloading it directly
        if (recipe.thumbnailUrl?.startsWith("http")) {
          const local = await downloadPhoto(recipe.thumbnailUrl, env.WHISK_R2);
          if (local) {
            recipe.thumbnailUrl = local;
            entry.thumbnailUrl = local;
            await env.WHISK_KV.put(`recipe:${entry.id}`, JSON.stringify(recipe));
            updated++;
            continue;
          }
        }

        // Strategy 2: Fetch the source page and extract image URL
        const res = await fetch(sourceUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) {
          errors.push(`${entry.title}: HTTP ${res.status}`);
          continue;
        }

        const html = await res.text();
        const imageUrl = extractImageFromHtml(html);

        if (imageUrl) {
          const local = await downloadPhoto(imageUrl, env.WHISK_R2);
          if (local) {
            recipe.thumbnailUrl = local;
            entry.thumbnailUrl = local;
            await env.WHISK_KV.put(`recipe:${entry.id}`, JSON.stringify(recipe));
            updated++;
          }
        }
      } catch {
        errors.push(`${entry.title}: fetch failed`);
      }
    }

    // Save updated index
    if (updated > 0) {
      await env.WHISK_KV.put("recipes:index", JSON.stringify(index));
    }

    return new Response(
      JSON.stringify({
        updated,
        total: candidates.length,
        remaining: Math.max(0, candidates.length - batch.length),
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Recrawl failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
