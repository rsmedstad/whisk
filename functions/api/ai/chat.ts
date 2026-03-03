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
  const indexData = await env.WHISK_KV.get("recipes:index", "text");
  const recipeIndex: { title: string; tags: string[]; cuisine?: string; prepTime?: number; cookTime?: number; servings?: number; description?: string; cookedCount?: number }[] = indexData ? JSON.parse(indexData) : [];

  // Build system prompt
  const systemParts: string[] = [
    "You are Whisk, a friendly personal recipe assistant. You help users discover, plan, and cook recipes from their personal collection.",
    "IMPORTANT: Only recommend recipes that exist in the user's collection listed below. Never invent or fabricate recipe names. If no recipe matches the request, say so honestly and suggest they browse by different tags or add new recipes.",
    "If the user explicitly asks for new recipe ideas outside their collection, you may suggest new ones. When doing so, always include a full URL to a real recipe on a popular site (e.g. allrecipes.com, seriouseats.com, budgetbytes.com). Clearly note these are not in their collection.",
    "Keep responses concise and practical. Format recipe names exactly as they appear in the collection.",
  ];

  if (seasonalContext) {
    systemParts.push(
      `\n--- Calendar & Seasonal Context ---\n${seasonalContext}`,
      "Use this context to make seasonally appropriate suggestions. Prioritize recipes that match the current season, upcoming holidays, and household size.",
      "For holidays, suggest recipes that fit the occasion. For seasons, consider what ingredients are fresh and what cooking styles suit the weather."
    );
  }

  if (recipeIndex.length > 0) {
    const recipeSummary = recipeIndex
      .map((r) => {
        const parts = [`- ${r.title}`];
        if (r.tags.length > 0) parts.push(`[${r.tags.join(", ")}]`);
        if (r.cuisine) parts.push(`(${r.cuisine})`);
        const totalTime = (r.prepTime ?? 0) + (r.cookTime ?? 0);
        if (totalTime > 0) parts.push(`${totalTime}min`);
        if (r.servings) parts.push(`serves ${r.servings}`);
        if (r.cookedCount) parts.push(`cooked ${r.cookedCount}x`);
        if (r.description) parts.push(`— ${r.description}`);
        return parts.join(" ");
      })
      .join("\n");
    systemParts.push(
      `\n--- User's Recipe Collection (${recipeIndex.length} recipes) ---\n${recipeSummary}`,
      "\nThese are the ONLY recipes the user has. Do not reference any recipes not in this list unless the user asks for new ideas."
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
