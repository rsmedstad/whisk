import {
  loadAIConfig,
  resolveConfig,
  type ProviderEnv,
} from "../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
  APIFY_API_TOKEN?: string;
  UNSPLASH_ACCESS_KEY?: string;
  CF_ACCOUNT_ID?: string;
  CF_BR_TOKEN?: string;
  DEMO_MODE?: string;
}

// GET /api/capabilities — returns which AI features are available
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const config = await loadAIConfig(env.WHISK_KV);

  // Each capability is available if a provider+model can be resolved for it
  const chat = !!resolveConfig(config, "chat", env);
  const vision = !!resolveConfig(config, "vision", env);
  const suggestions = !!resolveConfig(config, "suggestions", env);
  const nutritionEstimate = chat; // uses same provider as chat
  const instagramImport = !!env.APIFY_API_TOKEN;
  const unsplash = !!env.UNSPLASH_ACCESS_KEY;
  const browserRendering = !!(env.CF_ACCOUNT_ID && env.CF_BR_TOKEN);
  const demoMode = env.DEMO_MODE === "true";

  return new Response(
    JSON.stringify({ chat, vision, suggestions, nutritionEstimate, instagramImport, unsplash, browserRendering, demoMode }),
    { headers: { "Content-Type": "application/json" } }
  );
};
