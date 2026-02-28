import {
  loadAIConfig,
  resolveConfig,
  type ProviderEnv,
} from "../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

// GET /api/capabilities — returns which AI features are available
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const config = await loadAIConfig(env.WHISK_KV);

  // Each capability is available if a provider+model can be resolved for it
  const chat = !!resolveConfig(config, "chat", env);
  const vision = !!resolveConfig(config, "vision", env);
  const suggestions = !!resolveConfig(config, "suggestions", env);
  const nutritionEstimate = chat; // uses same provider as chat

  return new Response(
    JSON.stringify({ chat, vision, suggestions, nutritionEstimate }),
    { headers: { "Content-Type": "application/json" } }
  );
};
