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

// All preset tag names excluding speed group (those are derived from time data)
const PRESET_TAGS = [
  // Meal
  "breakfast", "brunch", "lunch", "dinner", "dessert", "appetizer", "snack", "side dish",
  // Cuisine
  "italian", "mexican", "chinese", "thai", "indian", "japanese", "korean", "mediterranean", "american", "french",
  // Diet
  "vegetarian", "vegan", "gluten-free", "dairy-free", "keto", "low-carb", "healthy",
  // Method
  "grilling", "baking", "slow cook", "instant pot", "one-pot", "air fryer", "no-cook", "stir-fry",
  // Season
  "summer", "fall", "winter", "spring", "holiday",
];

const VALID_TAGS = new Set(PRESET_TAGS);

// POST /api/ai/auto-tag - AI-powered recipe tag suggestions
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as AutoTagBody;

  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);

  if (!fnConfig) {
    return new Response(JSON.stringify({ tags: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const ingredientList = body.ingredients.length > 0
    ? `\nIngredients: ${body.ingredients.join(", ")}`
    : "";

  const systemPrompt = [
    "You are a recipe tagging assistant. Given a recipe's title, description, and ingredients, select 2-5 tags from this exact list:",
    "",
    PRESET_TAGS.join(", "),
    "",
    "Rules:",
    "- Only use tags from the list above. Do not invent new tags.",
    "- Select tags that accurately describe the recipe's meal type, cuisine, dietary properties, cooking method, and/or season.",
    "- Do NOT include speed-related tags (under 30 min, quick, weeknight, meal prep) — those are computed separately.",
    '- Return a JSON object: { "tags": ["tag1", "tag2"] }',
  ].join("\n");

  const userPrompt = `Title: ${body.title}${body.description ? `\nDescription: ${body.description}` : ""}${ingredientList}`;

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
    const tags = (parsed.tags ?? []).filter((t: string) => VALID_TAGS.has(t));

    return new Response(JSON.stringify({ tags }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ tags: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }
};
