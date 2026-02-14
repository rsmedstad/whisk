interface Env {
  WHISK_KV: KVNamespace;
}

// POST /api/import/url - Scrape recipe from URL using JSON-LD
export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  try {
    const { url } = (await request.json()) as { url: string };

    if (!url) {
      return new Response(JSON.stringify({ error: "URL required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Whisk Recipe Importer/1.0",
        Accept: "text/html",
      },
    });

    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

    const html = await res.text();

    // Extract JSON-LD
    const jsonLdMatch = html.match(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
    );

    if (!jsonLdMatch) {
      return new Response(
        JSON.stringify({ error: "No structured recipe data found" }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    let recipeData = null;
    for (const match of jsonLdMatch) {
      try {
        const json = match.replace(
          /<script[^>]*>|<\/script>/gi,
          ""
        );
        const parsed = JSON.parse(json);
        const data = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of data) {
          if (
            item["@type"] === "Recipe" ||
            (Array.isArray(item["@type"]) && item["@type"].includes("Recipe")) ||
            item["@graph"]?.find((g: Record<string, unknown>) => g["@type"] === "Recipe")
          ) {
            recipeData = item["@type"] === "Recipe" || (Array.isArray(item["@type"]) && item["@type"].includes("Recipe"))
              ? item
              : item["@graph"].find((g: Record<string, unknown>) => g["@type"] === "Recipe");
            break;
          }
        }
        if (recipeData) break;
      } catch {
        continue;
      }
    }

    if (!recipeData) {
      return new Response(
        JSON.stringify({ error: "No recipe found in page data" }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse recipe
    const recipe = {
      title: recipeData.name ?? "",
      description: recipeData.description ?? "",
      ingredients: parseIngredients(recipeData.recipeIngredient ?? []),
      steps: parseSteps(recipeData.recipeInstructions ?? []),
      prepTime: parseDuration(recipeData.prepTime),
      cookTime: parseDuration(recipeData.cookTime),
      servings: parseInt(recipeData.recipeYield?.[0] ?? recipeData.recipeYield ?? "0") || undefined,
      thumbnailUrl: typeof recipeData.image === "string"
        ? recipeData.image
        : recipeData.image?.url ?? recipeData.image?.[0] ?? undefined,
    };

    return new Response(JSON.stringify(recipe), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to import recipe" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

function parseIngredients(raw: string[]): { name: string; amount?: string; unit?: string }[] {
  return raw.map((str: string) => {
    // Simple parsing: try to extract amount and unit
    const match = str.match(/^([\d\s/½⅓⅔¼¾⅛]+)\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|cloves?|cans?|packages?|bunche?s?|pieces?)?\s*(.+)/i);
    if (match) {
      return {
        amount: match[1]?.trim(),
        unit: match[2]?.trim(),
        name: match[3]?.trim() ?? str,
      };
    }
    return { name: str.trim() };
  });
}

function parseSteps(raw: unknown[]): { text: string }[] {
  return raw.map((step: unknown) => {
    if (typeof step === "string") return { text: step };
    if (typeof step === "object" && step !== null) {
      const s = step as Record<string, unknown>;
      return { text: (s.text as string) ?? (s.name as string) ?? "" };
    }
    return { text: String(step) };
  });
}

function parseDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  // Parse ISO 8601 duration: PT30M, PT1H30M, PT45M
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return undefined;
  const hours = parseInt(match[1] ?? "0");
  const minutes = parseInt(match[2] ?? "0");
  return hours * 60 + minutes || undefined;
}
