import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

interface ChatBody {
  messages: { role: string; content: string }[];
  seasonalContext?: string;
}

// POST /api/ai/chat - Conversational recipe assistant
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as ChatBody;
  const { messages, seasonalContext } = body;
  const lastMessage = messages[messages.length - 1]?.content ?? "";

  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);

  if (!fnConfig) {
    const fallback = seasonalContext
      ? `AI suggestions aren't configured yet. Add an AI provider API key and configure it in Settings to enable this feature.\n\nBased on your calendar context:\n${seasonalContext}\n\nIn the meantime, try browsing your recipes with seasonal tags or searching by ingredient!`
      : `AI suggestions aren't configured yet. Add an AI provider API key and configure it in Settings to enable this feature.\n\nIn the meantime, you can browse your recipes, search by ingredient, and use tags to filter!`;

    return new Response(
      JSON.stringify({ content: fallback }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Fetch recipe index for context
  const indexData = await env.WHISK_KV.get("recipe_index", "text");
  const recipeIndex = indexData ? JSON.parse(indexData) : [];

  // Build system prompt
  const systemParts: string[] = [
    "You are Whisk, a friendly personal recipe assistant. You help users discover, plan, and cook recipes from their personal collection.",
    "Keep responses concise and practical. When suggesting recipes, prefer ones from the user's collection when possible.",
    "If asked about recipes you don't have details on, suggest the user add them or offer general cooking advice.",
  ];

  if (seasonalContext) {
    systemParts.push(
      `\n--- Calendar & Seasonal Context ---\n${seasonalContext}`,
      "Use this context to make seasonally appropriate suggestions. Prioritize recipes that match the current season, upcoming holidays, and household size.",
      "For holidays, suggest recipes that fit the occasion. For seasons, consider what ingredients are fresh and what cooking styles suit the weather."
    );
  }

  if (recipeIndex.length > 0) {
    const recipeSummary = (recipeIndex as { title: string; tags: string[] }[])
      .map((r) => `- ${r.title}${r.tags.length > 0 ? ` (${r.tags.join(", ")})` : ""}`)
      .join("\n");
    systemParts.push(
      `\n--- User's Recipe Collection (${recipeIndex.length} recipes) ---\n${recipeSummary}`
    );
  }

  const allMessages = [
    { role: "system", content: systemParts.join("\n") },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    const content = await callTextAI(fnConfig, env, allMessages, {
      maxTokens: 1024,
      temperature: 0.7,
    });

    return new Response(
      JSON.stringify({ content }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({
        content: `I received your message: "${lastMessage}"\n\nI'm having trouble connecting to the AI service right now. Please try again in a moment.`,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
};
