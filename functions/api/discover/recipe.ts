import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

interface GeneratedRecipe {
  title: string;
  description: string;
  ingredients: { name: string; amount?: string; unit?: string }[];
  steps: { text: string }[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  tags: string[];
}

// POST /api/discover/recipe — Generate a full recipe from an idea
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as { title: string; description: string };
  if (!body.title) {
    return new Response(JSON.stringify({ error: "title is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check KV cache for this recipe idea
  const cacheKey = `discover_recipe:${body.title.toLowerCase().replace(/\s+/g, "_")}`;
  const cached = await env.WHISK_KV.get(cacheKey, "text");
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json" },
    });
  }

  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);

  if (!fnConfig) {
    return new Response(
      JSON.stringify({ error: "No AI provider configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const content = await callTextAI(fnConfig, env, [
      {
        role: "system",
        content: `You are a professional chef creating detailed recipes. Respond with ONLY valid JSON matching this schema:
{
  "title": "Recipe Name",
  "description": "One sentence description",
  "ingredients": [{"name": "ingredient", "amount": "1", "unit": "cup"}],
  "steps": [{"text": "Step instruction"}],
  "prepTime": 15,
  "cookTime": 30,
  "servings": 4,
  "tags": ["dinner", "seasonal"]
}
Include precise measurements. Steps should be clear and actionable. Tags should include relevant categories (dinner, dessert, drinks, etc.) and attributes (quick, healthy, comfort, etc.).`,
      },
      {
        role: "user",
        content: `Create a detailed recipe for: ${body.title}. ${body.description}`,
      },
    ], { maxTokens: 2048, temperature: 0.7, jsonMode: true });

    let jsonStr = content.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const recipe = JSON.parse(jsonStr) as GeneratedRecipe;

    // Validate minimum structure
    if (!recipe.title || !recipe.ingredients?.length || !recipe.steps?.length) {
      throw new Error("Invalid recipe structure");
    }

    const result = JSON.stringify({ recipe });

    // Cache for 30 days
    await env.WHISK_KV.put(cacheKey, result, {
      expirationTtl: 30 * 24 * 60 * 60,
    });

    return new Response(result, {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to generate recipe" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
