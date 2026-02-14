interface Env {
  GROQ_API_KEY?: string;
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

  if (!env.GROQ_API_KEY) {
    return new Response(
      JSON.stringify({
        suggestions: [],
        message: "Configure GROQ_API_KEY to enable AI suggestions.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Fetch recipe index
  const indexData = await env.WHISK_KV.get("recipe_index", "text");
  const recipeIndex = indexData ? JSON.parse(indexData) : [];

  const systemParts: string[] = [
    "You are Whisk, a recipe suggestion engine. Given the user's recipe collection and current context, suggest 3-5 recipes they should consider making.",
    "Return ONLY a JSON array of objects with: { title, reason, tags, isFromCollection }",
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
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemParts.join("\n") },
          { role: "user", content: "What should I make this week?" },
        ],
        max_tokens: 512,
        temperature: 0.8,
        response_format: { type: "json_object" },
      }),
    });

    if (!groqRes.ok) throw new Error(`Groq API error: ${groqRes.status}`);

    const groqData = (await groqRes.json()) as {
      choices: { message: { content: string } }[];
    };

    const parsed = JSON.parse(groqData.choices[0]?.message.content ?? "[]");

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
