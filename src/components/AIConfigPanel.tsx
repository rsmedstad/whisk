import { useState, useEffect } from "react";
import type { AIConfig, AIAvailableProvider, AIFunctionConfig } from "../types";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

interface AIConfigPanelProps {
  config: AIConfig | null;
  providers: AIAvailableProvider[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  onSave: (config: AIConfig) => Promise<boolean>;
}

const AI_FUNCTIONS = [
  { key: "chat" as const, label: "Chat & Suggestions", desc: "Recipe ideas, meal planning help", type: "text" as const },
  { key: "suggestions" as const, label: "Recipe Suggestions", desc: "Seasonal recipe recommendations", type: "text" as const },
  { key: "vision" as const, label: "Photo Identification", desc: "Identify dishes from photos", type: "vision" as const },
  { key: "ocr" as const, label: "Shopping List Scan", desc: "OCR handwritten shopping lists", type: "vision" as const },
] as const;

export function AIConfigPanel({ config, providers, isLoading, isSaving, error, onSave }: AIConfigPanelProps) {
  const [mode, setMode] = useState<"simple" | "advanced">(config?.mode ?? "simple");
  const [defaultProvider, setDefaultProvider] = useState(config?.defaultProvider ?? "");
  const [defaultTextModel, setDefaultTextModel] = useState(config?.defaultTextModel ?? "");
  const [defaultVisionModel, setDefaultVisionModel] = useState(config?.defaultVisionModel ?? "");
  const [overrides, setOverrides] = useState<Record<string, AIFunctionConfig>>({
    chat: config?.chat ?? { provider: "", model: "" },
    suggestions: config?.suggestions ?? { provider: "", model: "" },
    vision: config?.vision ?? { provider: "", model: "" },
    ocr: config?.ocr ?? { provider: "", model: "" },
  });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync from server config when it loads
  useEffect(() => {
    if (config) {
      setMode(config.mode);
      setDefaultProvider(config.defaultProvider ?? "");
      setDefaultTextModel(config.defaultTextModel ?? "");
      setDefaultVisionModel(config.defaultVisionModel ?? "");
      setOverrides({
        chat: config.chat ?? { provider: "", model: "" },
        suggestions: config.suggestions ?? { provider: "", model: "" },
        vision: config.vision ?? { provider: "", model: "" },
        ocr: config.ocr ?? { provider: "", model: "" },
      });
    }
  }, [config]);

  const available = providers.filter((p) => p.available);
  const hasAnyProvider = available.length > 0;

  const getProvider = (id: string) => providers.find((p) => p.id === id);

  // Auto-select first available model when provider changes
  const handleDefaultProviderChange = (providerId: string) => {
    setDefaultProvider(providerId);
    const p = getProvider(providerId);
    setDefaultTextModel(p?.textModels[0]?.id ?? "");
    setDefaultVisionModel(p?.visionModels[0]?.id ?? "");
    setDirty(true);
    setSaved(false);
  };

  const handleOverrideChange = (fn: string, providerId: string) => {
    const p = getProvider(providerId);
    const isVisionFn = fn === "vision" || fn === "ocr";
    const models = isVisionFn ? p?.visionModels : p?.textModels;
    setOverrides((prev) => ({
      ...prev,
      [fn]: { provider: providerId, model: models?.[0]?.id ?? "" },
    }));
    setDirty(true);
    setSaved(false);
  };

  const handleOverrideModelChange = (fn: string, modelId: string) => {
    setOverrides((prev) => ({
      ...prev,
      [fn]: { ...prev[fn]!, provider: prev[fn]!.provider, model: modelId },
    }));
    setDirty(true);
    setSaved(false);
  };

  const handleSave = async () => {
    const newConfig: AIConfig = { mode };

    if (mode === "simple") {
      newConfig.defaultProvider = defaultProvider || undefined;
      newConfig.defaultTextModel = defaultTextModel || undefined;
      newConfig.defaultVisionModel = defaultVisionModel || undefined;
    } else {
      for (const fn of AI_FUNCTIONS) {
        const o = overrides[fn.key];
        if (o?.provider && o?.model) {
          newConfig[fn.key] = o;
        }
      }
    }

    const ok = await onSave(newConfig);
    if (ok) {
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 bg-stone-200 dark:bg-stone-700 rounded" />
          <div className="h-10 bg-stone-100 dark:bg-stone-800 rounded" />
          <div className="h-10 bg-stone-100 dark:bg-stone-800 rounded" />
        </div>
      </Card>
    );
  }

  const activeClass = "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300";
  const inactiveClass = "border-stone-300 text-stone-600 dark:border-stone-600 dark:text-stone-400";

  return (
    <div className="space-y-4">
      {/* Provider availability */}
      <Card>
        <div className="space-y-3">
          <p className="text-sm font-medium dark:text-stone-200">Available Providers</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Providers are enabled by adding their API key as an environment variable in your Cloudflare dashboard.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {providers.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                  p.available
                    ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                    : "border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900 opacity-60"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    p.available ? "bg-green-500" : "bg-stone-300 dark:bg-stone-600"
                  }`}
                />
                <span className={p.available ? "dark:text-green-300" : "text-stone-500 dark:text-stone-500"}>
                  {p.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {!hasAnyProvider && (
        <Card>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            No AI providers are configured. Add at least one API key (e.g. GROQ_API_KEY) as an environment variable to enable AI features.
          </p>
        </Card>
      )}

      {hasAnyProvider && (
        <>
          {/* Mode selector */}
          <Card>
            <div className="space-y-3">
              <p className="text-sm font-medium dark:text-stone-200">Configuration Mode</p>
              <div className="flex gap-2">
                {(["simple", "advanced"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setDirty(true); setSaved(false); }}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border capitalize ${
                      mode === m ? activeClass : inactiveClass
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {mode === "simple"
                  ? "Use one provider for all AI features. Recommended for most setups."
                  : "Choose different providers and models for each AI feature."}
              </p>
            </div>
          </Card>

          {/* Simple mode */}
          {mode === "simple" && (
            <Card>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                    AI Provider
                  </label>
                  <select
                    value={defaultProvider}
                    onChange={(e) => handleDefaultProviderChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-sm dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">Auto-detect (first available)</option>
                    {available.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {defaultProvider && (() => {
                  const p = getProvider(defaultProvider);
                  if (!p) return null;
                  return (
                    <>
                      <div>
                        <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                          Text Model
                          <span className="text-xs text-stone-400 font-normal ml-1">(chat, suggestions)</span>
                        </label>
                        <select
                          value={defaultTextModel}
                          onChange={(e) => { setDefaultTextModel(e.target.value); setDirty(true); setSaved(false); }}
                          className="w-full px-3 py-2 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-sm dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          {p.textModels.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium dark:text-stone-200 block mb-2">
                          Vision Model
                          <span className="text-xs text-stone-400 font-normal ml-1">(photo ID, list scan)</span>
                        </label>
                        {p.visionModels.length > 0 ? (
                          <select
                            value={defaultVisionModel}
                            onChange={(e) => { setDefaultVisionModel(e.target.value); setDirty(true); setSaved(false); }}
                            className="w-full px-3 py-2 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-sm dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
                          >
                            {p.visionModels.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-sm text-amber-600 dark:text-amber-400 py-2">
                            {p.name} does not support vision. Photo identification and list scanning will be unavailable.
                          </p>
                        )}
                      </div>
                    </>
                  );
                })()}

                {!defaultProvider && (
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Auto-detect will use the first available provider. Select a specific provider to choose models.
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* Advanced mode */}
          {mode === "advanced" && (
            <div className="space-y-3">
              {AI_FUNCTIONS.map((fn) => {
                const override = overrides[fn.key] ?? { provider: "", model: "" };
                const isVision = fn.type === "vision";
                const providersForFn = isVision
                  ? available.filter((p) => p.visionModels.length > 0)
                  : available;
                const selectedProvider = getProvider(override.provider);
                const modelsForFn = isVision
                  ? selectedProvider?.visionModels ?? []
                  : selectedProvider?.textModels ?? [];

                return (
                  <Card key={fn.key}>
                    <div className="space-y-2">
                      <div>
                        <p className="text-sm font-medium dark:text-stone-200">{fn.label}</p>
                        <p className="text-xs text-stone-500 dark:text-stone-400">{fn.desc}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={override.provider}
                          onChange={(e) => handleOverrideChange(fn.key, e.target.value)}
                          className="px-3 py-2 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-sm dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          <option value="">Auto</option>
                          {providersForFn.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <select
                          value={override.model}
                          onChange={(e) => handleOverrideModelChange(fn.key, e.target.value)}
                          disabled={!override.provider}
                          className="px-3 py-2 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-sm dark:text-stone-200 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          {!override.provider && <option value="">Auto</option>}
                          {modelsForFn.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </div>
                      {isVision && providersForFn.length === 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          No vision-capable provider is configured. Add an API key for a provider with vision support.
                        </p>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Save / status */}
          <div className="space-y-2">
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            {saved && (
              <p className="text-sm text-green-600 dark:text-green-400">Configuration saved.</p>
            )}
            <Button
              fullWidth
              onClick={handleSave}
              disabled={!dirty || isSaving}
            >
              {isSaving ? "Saving..." : "Save AI Configuration"}
            </Button>
          </div>
        </>
      )}

      {/* Privacy notice */}
      <div className="space-y-1.5">
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Privacy note: When AI features are enabled, recipe data (titles, ingredients, steps) is sent to the configured third-party AI provider. These providers may store, process, or use this data per their own terms.
        </p>
      </div>
    </div>
  );
}
