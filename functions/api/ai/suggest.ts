import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

interface SuggestBody {
  seasonalContext?: string;
  recentRecipeIds?: string[];
}

// POST /api/ai/suggest - Seasonal recipe suggestions
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as SuggestBody;
  const { seasonalContext } = body;

  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "suggestions", env);

  if (!fnConfig) {
    return new Response(
      JSON.stringify({
        suggestions: [],
        message: "Configure an AI provider in Settings to enable suggestions.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Fetch recipe index
  const indexData = await env.WHISK_KV.get("recipe_index", "text");
  const recipeIndex = indexData ? JSON.parse(indexData) : [];

  const systemParts: string[] = [
    "You are Whisk, a recipe suggestion engine. Given the user's recipe collection and current context, suggest 3-5 recipes they should consider making.",
    "Return ONLY a JSON object with a \"suggestions\" key containing an array of objects with: { title, reason, tags, isFromCollection }",
    "Prefer recipes from the user's collection when they match. Include 1-2 new suggestions if relevant.",
  ];

  if (seasonalContext) {
    systemParts.push(
      `\n--- Calendar & Seasonal Context ---\n${seasonalContext}`,
      "Prioritize seasonally appropriate recipes. Consider upcoming holidays, current weather/season, and household size."
    );
  }

  if (recipeIndex.length > 0) {
    const recipeSummary = (recipeIndex as { title: string; tags: string[] }[])
      .map((r) => `- ${r.title} [${r.tags.join(", ")}]`)
      .join("\n");
    systemParts.push(
      `\n--- User's Recipes ---\n${recipeSummary}`
    );
  }

  try {
    const content = await callTextAI(
      fnConfig,
      env,
      [
        { role: "system", content: systemParts.join("\n") },
        { role: "user", content: "What should I make this week?" },
      ],
      { maxTokens: 512, temperature: 0.8, jsonMode: true }
    );

    const parsed = JSON.parse(content);

    return new Response(
      JSON.stringify({ suggestions: parsed.suggestions ?? parsed }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ suggestions: [], message: "Failed to generate suggestions" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
};
