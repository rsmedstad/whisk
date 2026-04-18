import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { getLocal, setLocal } from "../lib/cache";
import type { AICapabilities } from "../types";

const CACHE_KEY = "ai_capabilities";

const NONE: AICapabilities = {
  chat: false,
  vision: false,
  suggestions: false,
  nutritionEstimate: false,
  instagramImport: false,
  unsplash: false,
  browserRendering: false,
  demoMode: false,
};

export interface CapabilitiesState extends AICapabilities {
  isLoaded: boolean;
}

export function useCapabilities(): CapabilitiesState {
  const cached = getLocal<AICapabilities>(CACHE_KEY);
  const [capabilities, setCapabilities] = useState<AICapabilities>(cached ?? NONE);
  const [isLoaded, setIsLoaded] = useState<boolean>(!!cached);

  useEffect(() => {
    api
      .get<AICapabilities>("/capabilities")
      .then((data) => {
        if (data) {
          setCapabilities(data);
          setLocal(CACHE_KEY, data);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoaded(true));
  }, []);

  return { ...capabilities, isLoaded };
}
