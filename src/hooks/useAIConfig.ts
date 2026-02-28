import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { getLocal, setLocal } from "../lib/cache";
import type { AIConfig, AIConfigResponse, AIAvailableProvider } from "../types";

const CACHE_KEY = "ai_config";

interface UseAIConfigReturn {
  config: AIConfig | null;
  providers: AIAvailableProvider[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveConfig: (config: AIConfig) => Promise<boolean>;
  refresh: () => void;
}

export function useAIConfig(): UseAIConfigReturn {
  const [config, setConfig] = useState<AIConfig | null>(() => {
    const cached = getLocal<AIConfigResponse>(CACHE_KEY);
    return cached?.config ?? null;
  });
  const [providers, setProviders] = useState<AIAvailableProvider[]>(() => {
    const cached = getLocal<AIConfigResponse>(CACHE_KEY);
    return cached?.providers ?? [];
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(() => {
    setIsLoading(true);
    api
      .get<AIConfigResponse>("/ai/config")
      .then((data) => {
        if (data) {
          setConfig(data.config);
          setProviders(data.providers);
          setLocal(CACHE_KEY, data);
        }
      })
      .catch(() => {
        setError("Failed to load AI configuration");
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveConfig = useCallback(async (newConfig: AIConfig): Promise<boolean> => {
    setIsSaving(true);
    setError(null);
    try {
      await api.put("/ai/config", newConfig);
      setConfig(newConfig);
      const cached = getLocal<AIConfigResponse>(CACHE_KEY);
      setLocal(CACHE_KEY, { config: newConfig, providers: cached?.providers ?? providers });
      return true;
    } catch {
      setError("Failed to save AI configuration");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [providers]);

  return { config, providers, isLoading, isSaving, error, saveConfig, refresh: fetchConfig };
}
