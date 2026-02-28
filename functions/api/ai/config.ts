import {
  getAvailableProviders,
  loadAIConfig,
  PROVIDERS,
  type AIConfig,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

// GET /api/ai/config — returns current config + available providers
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const config = await loadAIConfig(env.WHISK_KV);
  const providers = getAvailableProviders(env);

  return new Response(
    JSON.stringify({ config, providers }),
    { headers: { "Content-Type": "application/json" } }
  );
};

// PUT /api/ai/config — save AI configuration
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as AIConfig;

  // Validate mode
  if (body.mode !== "simple" && body.mode !== "advanced") {
    return new Response(
      JSON.stringify({ error: "Invalid mode. Use 'simple' or 'advanced'." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Validate provider references exist in registry
  if (body.defaultProvider && !PROVIDERS[body.defaultProvider]) {
    return new Response(
      JSON.stringify({ error: `Unknown provider: ${body.defaultProvider}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  for (const fn of ["chat", "suggestions", "vision", "ocr"] as const) {
    const override = body[fn];
    if (override?.provider && !PROVIDERS[override.provider]) {
      return new Response(
        JSON.stringify({ error: `Unknown provider for ${fn}: ${override.provider}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  await env.WHISK_KV.put("ai_config", JSON.stringify(body));

  return new Response(
    JSON.stringify({ ok: true }),
    { headers: { "Content-Type": "application/json" } }
  );
};
