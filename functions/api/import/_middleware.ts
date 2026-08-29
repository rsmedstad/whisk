import { overlayImportedRecipe } from "../../lib/cooking-groups-overlay";

/**
 * URL import prefers JSON-LD, which flattens cooking groups.
 * After the existing importer returns, overlay headings / HowToStep names
 * from a second fetch of the source page. Amounts and names stay as-is.
 *
 * This lives here because functions/api/import/url.ts is too large to
 * rewrite through the GitHub file API. The patch at
 * scripts/patches/cooking-groups-url.patch is the in-file version.
 */
export const onRequestPost: PagesFunction = async (context) => {
  const pathname = new URL(context.request.url).pathname.replace(/\/$/, "");
  if (!pathname.endsWith("/import/url")) {
    return context.next();
  }

  const reqClone = context.request.clone();
  const response = await context.next();
  if (!response.ok) return response;

  let recipe: Record<string, unknown>;
  try {
    recipe = (await response.clone().json()) as Record<string, unknown>;
  } catch {
    return response;
  }
  if (!recipe || typeof recipe !== "object" || recipe.error) return response;

  let sourceUrl: string | undefined;
  try {
    const body = (await reqClone.json()) as { url?: string };
    sourceUrl = typeof body.url === "string" ? body.url.trim() : undefined;
  } catch {
    return response;
  }
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return response;

  let html = "";
  try {
    const pageRes = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    html = await pageRes.text();
  } catch {
    return response;
  }
  if (html.length < 500) return response;

  const overlaid = overlayImportedRecipe(
    {
      ingredients: Array.isArray(recipe.ingredients)
        ? (recipe.ingredients as { name: string; group?: string }[])
        : [],
      steps: Array.isArray(recipe.steps)
        ? (recipe.steps as { text: string; group?: string }[])
        : [],
    },
    html
  );

  return new Response(
    JSON.stringify({
      ...recipe,
      ingredients: overlaid.ingredients ?? recipe.ingredients,
      steps: overlaid.steps ?? recipe.steps,
    }),
    {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
};
