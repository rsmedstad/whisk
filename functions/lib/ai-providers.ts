// ── Types ──────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
}

export interface ProviderDef {
  id: string;
  name: string;
  envKey: string;
  format: "openai" | "anthropic" | "gemini";
  baseUrl: string;
  textModels: ModelInfo[];
  visionModels: ModelInfo[];
}

export interface AIFunctionConfig {
  provider: string;
  model: string;
}

export interface AIConfig {
  mode: "simple" | "advanced";
  defaultProvider?: string;
  defaultTextModel?: string;
  defaultVisionModel?: string;
  chat?: AIFunctionConfig;
  suggestions?: AIFunctionConfig;
  vision?: AIFunctionConfig;
  ocr?: AIFunctionConfig;
}

export interface AvailableProvider {
  id: string;
  name: string;
  available: boolean;
  textModels: ModelInfo[];
  visionModels: ModelInfo[];
}

// Env shape accepted by provider functions — the caller's Cloudflare Env
// is structurally compatible (superset of these optional keys).
export interface ProviderEnv {
  GROQ_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  XAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  MISTRAL_API_KEY?: string;
}

// ── Provider Registry ──────────────────────────────────────

export const PROVIDERS: Record<string, ProviderDef> = {
  groq: {
    id: "groq",
    name: "Groq",
    envKey: "GROQ_API_KEY",
    format: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    textModels: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
      { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout" },
      { id: "llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick" },
    ],
    visionModels: [
      { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout" },
      { id: "llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick" },
    ],
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    format: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    textModels: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite" },
    ],
    visionModels: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite" },
    ],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    format: "openai",
    baseUrl: "https://api.deepseek.com",
    textModels: [
      { id: "deepseek-chat", name: "DeepSeek V3.2 (Chat)" },
      { id: "deepseek-reasoner", name: "DeepSeek V3.2 (Reasoner)" },
    ],
    visionModels: [],
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    envKey: "CEREBRAS_API_KEY",
    format: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    textModels: [
      { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout" },
      { id: "llama3.3-70b", name: "Llama 3.3 70B" },
    ],
    visionModels: [],
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    envKey: "MISTRAL_API_KEY",
    format: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    textModels: [
      { id: "mistral-small-latest", name: "Mistral Small" },
      { id: "mistral-medium-latest", name: "Mistral Medium" },
    ],
    visionModels: [
      { id: "pixtral-large-latest", name: "Pixtral Large" },
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    format: "openai",
    baseUrl: "https://api.openai.com/v1",
    textModels: [
      { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4o", name: "GPT-4o" },
    ],
    visionModels: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4o", name: "GPT-4o" },
    ],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    format: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    textModels: [
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
      { id: "claude-sonnet-4-6-20260217", name: "Claude Sonnet 4.6" },
    ],
    visionModels: [
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
      { id: "claude-sonnet-4-6-20260217", name: "Claude Sonnet 4.6" },
    ],
  },
  xai: {
    id: "xai",
    name: "xAI Grok",
    envKey: "XAI_API_KEY",
    format: "openai",
    baseUrl: "https://api.x.ai/v1",
    textModels: [
      { id: "grok-3-mini-fast", name: "Grok 3 Mini Fast" },
      { id: "grok-3-fast", name: "Grok 3 Fast" },
    ],
    visionModels: [
      { id: "grok-2-vision-1212", name: "Grok 2 Vision" },
    ],
  },
};

// ── Helpers ─────────────────────────────────────────────────

function getApiKey(env: ProviderEnv, providerId: string): string | undefined {
  const provider = PROVIDERS[providerId];
  if (!provider) return undefined;
  const key = env[provider.envKey as keyof ProviderEnv];
  return key && key.length > 0 ? key : undefined;
}

export function getAvailableProviders(env: ProviderEnv): AvailableProvider[] {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    available: !!getApiKey(env, p.id),
    textModels: p.textModels,
    visionModels: p.visionModels,
  }));
}

/** Resolve which provider+model to use for a given AI function. */
export function resolveConfig(
  config: AIConfig | null,
  fn: "chat" | "suggestions" | "vision" | "ocr",
  env: ProviderEnv
): AIFunctionConfig | null {
  const isVisionFn = fn === "vision" || fn === "ocr";

  // Advanced mode: use per-function override if available
  if (config?.mode === "advanced") {
    const override = config[fn];
    if (override && getApiKey(env, override.provider)) {
      return override;
    }
  }

  // Simple mode or fallback: use the default provider
  if (config?.defaultProvider && getApiKey(env, config.defaultProvider)) {
    const provider = PROVIDERS[config.defaultProvider];
    if (provider) {
      if (isVisionFn) {
        const model = config.defaultVisionModel ?? provider.visionModels[0]?.id;
        if (model) return { provider: config.defaultProvider, model };
      } else {
        const model = config.defaultTextModel ?? provider.textModels[0]?.id;
        if (model) return { provider: config.defaultProvider, model };
      }
    }
  }

  // No config or configured provider unavailable: auto-detect first available
  for (const p of Object.values(PROVIDERS)) {
    if (!getApiKey(env, p.id)) continue;
    if (isVisionFn && p.visionModels.length === 0) continue;
    const models = isVisionFn ? p.visionModels : p.textModels;
    const firstModel = models[0];
    if (firstModel) {
      return { provider: p.id, model: firstModel.id };
    }
  }

  return null;
}

/** Load saved AI config from KV. */
export async function loadAIConfig(kv: KVNamespace): Promise<AIConfig | null> {
  const raw = await kv.get("ai_config", "text");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AIConfig;
  } catch {
    return null;
  }
}

// ── API Call Interfaces ─────────────────────────────────────

interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}

interface Message {
  role: string;
  content: string;
}

// ── Text Completion ─────────────────────────────────────────

export async function callTextAI(
  fnConfig: AIFunctionConfig,
  env: ProviderEnv,
  messages: Message[],
  options: CallOptions = {}
): Promise<string> {
  const provider = PROVIDERS[fnConfig.provider];
  if (!provider) throw new Error(`Unknown provider: ${fnConfig.provider}`);

  const apiKey = getApiKey(env, fnConfig.provider);
  if (!apiKey) throw new Error(`No API key for ${provider.name}`);

  const { maxTokens = 1024, temperature = 0.7, jsonMode = false } = options;

  switch (provider.format) {
    case "openai":
      return callOpenAIText(provider.baseUrl, apiKey, fnConfig.model, messages, maxTokens, temperature, jsonMode);
    case "anthropic":
      return callAnthropicText(apiKey, fnConfig.model, messages, maxTokens, temperature);
    case "gemini":
      return callGeminiText(provider.baseUrl, apiKey, fnConfig.model, messages, maxTokens, temperature, jsonMode);
  }
}

// ── Vision Completion ───────────────────────────────────────

export async function callVisionAI(
  fnConfig: AIFunctionConfig,
  env: ProviderEnv,
  prompt: string,
  imageBase64: string,
  mimeType: string,
  options: CallOptions = {}
): Promise<string> {
  const provider = PROVIDERS[fnConfig.provider];
  if (!provider) throw new Error(`Unknown provider: ${fnConfig.provider}`);

  const apiKey = getApiKey(env, fnConfig.provider);
  if (!apiKey) throw new Error(`No API key for ${provider.name}`);

  const { maxTokens = 1024, temperature = 0.5 } = options;

  switch (provider.format) {
    case "openai":
      return callOpenAIVision(provider.baseUrl, apiKey, fnConfig.model, prompt, imageBase64, mimeType, maxTokens, temperature);
    case "anthropic":
      return callAnthropicVision(apiKey, fnConfig.model, prompt, imageBase64, mimeType, maxTokens, temperature);
    case "gemini":
      return callGeminiVision(provider.baseUrl, apiKey, fnConfig.model, prompt, imageBase64, mimeType, maxTokens, temperature);
  }
}

// ── OpenAI-Compatible Format (Groq, OpenAI, xAI) ──────────

async function callOpenAIText(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number,
  jsonMode: boolean
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${model} API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]?.message?.content ?? "";
}

async function callOpenAIVision(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  imageBase64: string,
  mimeType: string,
  maxTokens: number,
  temperature: number
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${model} Vision error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]?.message?.content ?? "";
}

// ── Anthropic Format ───────────────────────────────────────

async function callAnthropicText(
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number
): Promise<string> {
  const systemMsgs = messages.filter((m) => m.role === "system");
  const otherMsgs = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: otherMsgs.map((m) => ({ role: m.role, content: m.content })),
  };
  if (systemMsgs.length > 0) {
    body.system = systemMsgs.map((m) => m.content).join("\n\n");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    content: { type: string; text: string }[];
  };
  return data.content.find((c) => c.type === "text")?.text ?? "";
}

async function callAnthropicVision(
  apiKey: string,
  model: string,
  prompt: string,
  imageBase64: string,
  mimeType: string,
  maxTokens: number,
  temperature: number
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: imageBase64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic Vision error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    content: { type: string; text: string }[];
  };
  return data.content.find((c) => c.type === "text")?.text ?? "";
}

// ── Gemini Format ──────────────────────────────────────────

async function callGeminiText(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number,
  jsonMode: boolean
): Promise<string> {
  const systemMsgs = messages.filter((m) => m.role === "system");
  const otherMsgs = messages.filter((m) => m.role !== "system");

  const contents = otherMsgs.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: maxTokens,
    temperature,
  };
  if (jsonMode) {
    generationConfig.responseMimeType = "application/json";
  }

  const body: Record<string, unknown> = { contents, generationConfig };

  if (systemMsgs.length > 0) {
    body.systemInstruction = {
      parts: [{ text: systemMsgs.map((m) => m.content).join("\n\n") }],
    };
  }

  const res = await fetch(
    `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  return data.candidates[0]?.content?.parts[0]?.text ?? "";
}

async function callGeminiVision(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  imageBase64: string,
  mimeType: string,
  maxTokens: number,
  temperature: number
): Promise<string> {
  const res = await fetch(
    `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini Vision error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  return data.candidates[0]?.content?.parts[0]?.text ?? "";
}
