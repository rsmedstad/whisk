interface Env {
  GROQ_API_KEY?: string;
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

  if (!env.GROQ_API_KEY) {
    // Without AI, give a useful contextual placeholder response
    const fallback = seasonalContext
      ? `AI suggestions aren't configured yet. Add a GROQ_API_KEY secret to enable this feature.\n\nBased on your calendar context:\n${seasonalContext}\n\nIn the meantime, try browsing your recipes with seasonal tags or searching by ingredient!`
      : `AI suggestions aren't configured yet. Add a GROQ_API_KEY secret to enable this feature.\n\nIn the meantime, you can browse your recipes, search by ingredient, and use tags to filter!`;

    return new Response(
      JSON.stringify({ content: fallback }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Fetch recipe index for context
  const indexData = await env.WHISK_KV.get("recipe_index", "text");
  const recipeIndex = indexData ? JSON.parse(indexData) : [];

  // Build system prompt with seasonal and recipe context
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

  // Call Groq API
  const groqMessages = [
    { role: "system", content: systemParts.join("\n") },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: groqMessages,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!groqRes.ok) {
      throw new Error(`Groq API error: ${groqRes.status}`);
    }

    const groqData = (await groqRes.json()) as {
      choices: { message: { content: string } }[];
    };

    return new Response(
      JSON.stringify({ content: groqData.choices[0]?.message.content ?? "" }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        content: `I received your message: "${lastMessage}"\n\nI'm having trouble connecting to the AI service right now. Please try again in a moment.`,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
};
