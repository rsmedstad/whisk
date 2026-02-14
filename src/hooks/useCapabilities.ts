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
};

export function useCapabilities() {
  const [capabilities, setCapabilities] = useState<AICapabilities>(
    () => getLocal<AICapabilities>(CACHE_KEY) ?? NONE
  );

  useEffect(() => {
    api
      .get<AICapabilities>("/capabilities")
      .then((data) => {
        if (data) {
          setCapabilities(data);
          setLocal(CACHE_KEY, data);
        }
      })
      .catch(() => {});
  }, []);

  return capabilities;
}
