import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

// GET /api/discover/ideas — Generate seasonal recipe ideas for browsing
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "seasonal";
  const season = url.searchParams.get("season") ?? "spring";

  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);

  if (!fnConfig) {
    return new Response(
      JSON.stringify({ ideas: getFallbackIdeas(category, season) }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const prompts: Record<string, string> = {
    seasonal: `Suggest 8 recipe ideas that are perfect for ${season}. Include seasonal ingredients and cooking styles. For each recipe, give a short appetizing name (3-5 words max) and a one-sentence description.`,
    quick: "Suggest 8 quick weeknight dinner ideas (under 30 minutes). For each, give a short appetizing name (3-5 words max) and a one-sentence description.",
    trending: "Suggest 8 trending/popular recipe ideas that food lovers are excited about right now. For each, give a short appetizing name (3-5 words max) and a one-sentence description.",
    comfort: "Suggest 8 comforting, hearty recipe ideas. Think soul food, comfort classics, cozy meals. For each, give a short appetizing name (3-5 words max) and a one-sentence description.",
    healthy: "Suggest 8 healthy, nutritious recipe ideas. Focus on whole foods, vegetables, lean proteins. For each, give a short appetizing name (3-5 words max) and a one-sentence description.",
  };

  const defaultPrompt = `Suggest 8 recipe ideas that are perfect for ${season}. Include seasonal ingredients and cooking styles. For each recipe, give a short appetizing name (3-5 words max) and a one-sentence description.`;
  const prompt = prompts[category] ?? defaultPrompt;

  try {
    const content = await callTextAI(fnConfig, env, [
      {
        role: "system",
        content: "You are a creative chef suggesting recipe ideas. Respond with ONLY a JSON array. Each item has: \"title\" (short name), \"description\" (one sentence), \"emoji\" (single food emoji). Example: [{\"title\":\"Lemon Herb Chicken\",\"description\":\"Bright and zesty roasted chicken with fresh herbs.\",\"emoji\":\"🍋\"}]",
      },
      { role: "user", content: prompt },
    ], { maxTokens: 1024, temperature: 0.8, jsonMode: true });

    let jsonStr = content.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    const ideas = Array.isArray(parsed) ? parsed : parsed.ideas ?? [];

    return new Response(
      JSON.stringify({ ideas }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ ideas: getFallbackIdeas(category, season) }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
};

function getFallbackIdeas(category: string, season: string) {
  const seasonal: Record<string, Array<{ title: string; description: string; emoji: string }>> = {
    spring: [
      { title: "Asparagus Risotto", description: "Creamy rice with fresh spring asparagus.", emoji: "\uD83C\uDF3F" },
      { title: "Strawberry Spinach Salad", description: "Sweet berries with peppery greens.", emoji: "\uD83C\uDF53" },
      { title: "Lemon Herb Chicken", description: "Bright and zesty roasted chicken.", emoji: "\uD83C\uDF4B" },
      { title: "Pea Soup", description: "Vibrant green soup with mint.", emoji: "\uD83E\uDD63" },
    ],
    summer: [
      { title: "Grilled Peach Salad", description: "Smoky sweet peaches on fresh greens.", emoji: "\uD83C\uDF51" },
      { title: "Fish Tacos", description: "Light and crispy with mango salsa.", emoji: "\uD83C\uDF2E" },
      { title: "Watermelon Gazpacho", description: "Refreshing chilled summer soup.", emoji: "\uD83C\uDF49" },
      { title: "Corn on the Cob", description: "Classic grilled corn with herb butter.", emoji: "\uD83C\uDF3D" },
    ],
    fall: [
      { title: "Butternut Squash Soup", description: "Velvety smooth with warm spices.", emoji: "\uD83C\uDF83" },
      { title: "Apple Cider Pork", description: "Tender pork braised in apple cider.", emoji: "\uD83C\uDF4E" },
      { title: "Pumpkin Pasta", description: "Creamy pumpkin sauce on fresh pasta.", emoji: "\uD83C\uDF5D" },
      { title: "Maple Roasted Vegetables", description: "Caramelized root vegetables.", emoji: "\uD83C\uDF41" },
    ],
    winter: [
      { title: "Beef Stew", description: "Hearty slow-cooked comfort in a bowl.", emoji: "\uD83E\uDD69" },
      { title: "French Onion Soup", description: "Rich broth with melted gruyere.", emoji: "\uD83E\uDDC5" },
      { title: "Citrus Salmon", description: "Pan-seared with winter citrus glaze.", emoji: "\uD83C\uDF4A" },
      { title: "Pot Pie", description: "Flaky crust over creamy chicken filling.", emoji: "\uD83E\uDD67" },
    ],
  };

  if (category === "seasonal") {
    return seasonal[season] ?? seasonal["spring"];
  }

  return seasonal["spring"];
}
