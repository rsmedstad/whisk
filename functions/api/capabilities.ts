interface Env {
  GROQ_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  XAI_API_KEY?: string;
}

// GET /api/capabilities — returns which AI features are available
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  // Any text-capable provider enables chat/suggestions/nutrition
  const hasTextAI = !!(
    env.GROQ_API_KEY ||
    env.OPENAI_API_KEY ||
    env.ANTHROPIC_API_KEY ||
    env.GEMINI_API_KEY ||
    env.XAI_API_KEY
  );

  // Vision requires a provider with image understanding
  const hasVisionAI = !!(
    env.XAI_API_KEY ||
    env.OPENAI_API_KEY ||
    env.ANTHROPIC_API_KEY ||
    env.GEMINI_API_KEY
  );

  return new Response(
    JSON.stringify({
      chat: hasTextAI,
      vision: hasVisionAI,
      suggestions: hasTextAI,
      nutritionEstimate: hasTextAI,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
};
