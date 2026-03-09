import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

interface AutoTagBody {
  title: string;
  description?: string;
  ingredients: string[];
}

// Preset tags excluding speed group (those are derived from time data)
const PRESET_TAGS = [
  // Meal
  "breakfast", "brunch", "dinner", "salad", "dessert", "appetizer", "snack", "side dish",
  // Cuisine
  "italian", "mexican", "chinese", "thai", "indian", "japanese", "korean", "mediterranean", "american", "french",
  // Diet
  "vegetarian", "vegan", "gluten-free", "dairy-free", "keto", "low-carb", "healthy",
  // Method
  "grilling", "baking", "slow cook", "instant pot", "one-pot", "air fryer", "no-cook", "stir-fry",
  // Season
  "summer", "fall", "winter", "spring", "holiday",
];

// POST /api/ai/auto-tag - AI-powered recipe tag suggestions
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as AutoTagBody;

  // Input sanitization: truncate and strip control characters
  const title = typeof body.title === "string" ? body.title.slice(0, 500).replace(/[\x00-\x1f]/g, "") : "";
  const description = typeof body.description === "string" ? body.description.slice(0, 1000).replace(/[\x00-\x1f]/g, "") : undefined;
  const ingredients = (Array.isArray(body.ingredients) ? body.ingredients : [])
    .slice(0, 100)
    .filter((i): i is string => typeof i === "string")
    .map((i) => i.slice(0, 200).replace(/[\x00-\x1f]/g, ""));

  if (!title) {
    return new Response(JSON.stringify({ tags: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);

  if (!fnConfig) {
    return new Response(JSON.stringify({ tags: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Load user-created custom tags from the tag index so AI can reuse them
  let allTags = [...PRESET_TAGS];
  try {
    const tagIndex = await env.WHISK_KV.get("tag_index", "json") as
      | { name: string; type?: string }[]
      | null;
    if (tagIndex) {
      const presetSet = new Set(PRESET_TAGS);
      const customTags = tagIndex
        .map((t) => t.name)
        .filter((n) => !presetSet.has(n));
      allTags = [...PRESET_TAGS, ...customTags];
    }
  } catch {
    // Continue with preset tags only
  }

  const validTags = new Set(allTags);

  const ingredientList = ingredients.length > 0
    ? `\nIngredients: ${ingredients.join(", ")}`
    : "";

  const systemPrompt = [
    "You are a recipe tagging assistant. Given a recipe's title, description, and ingredients, select 2-5 tags from this exact list:",
    "",
    allTags.join(", "),
    "",
    "Rules:",
    "- Only use tags from the list above. Do not invent new tags.",
    "- Select tags that accurately describe the recipe's meal type, cuisine, dietary properties, cooking method, and/or season.",
    "- Do NOT include speed-related tags (under 30 min, quick, weeknight, meal prep) — those are computed separately.",
    '- Return a JSON object: { "tags": ["tag1", "tag2"] }',
  ].join("\n");

  const userPrompt = `Title: ${title}${description ? `\nDescription: ${description}` : ""}${ingredientList}`;

  try {
    const content = await callTextAI(
      fnConfig,
      env,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 256, temperature: 0.3, jsonMode: true }
    );

    const parsed = JSON.parse(content) as { tags?: string[] };
    const tags = (parsed.tags ?? []).filter((t: string) => validTags.has(t));

    return new Response(JSON.stringify({ tags }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ tags: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }
};
