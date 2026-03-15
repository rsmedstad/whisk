import { useState, useCallback } from "react";
import { api, setToken, clearToken, hasToken } from "../lib/api";
import type { AuthResponse } from "../types";

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(hasToken);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (password: string, name?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.post<AuthResponse>("/auth", { password, name });
      setToken(res.token);
      // Store user identity locally
      if (res.userId) {
        localStorage.setItem("whisk_user_id", res.userId);
      }
      if (res.name) {
        localStorage.setItem("whisk_display_name", res.name);
      }
      // Store demo mode state
      if (res.demoMode) {
        localStorage.setItem("whisk_demo_mode", "true");
        localStorage.setItem("whisk_demo_owner", res.isDemoOwner ? "true" : "false");
      } else {
        localStorage.removeItem("whisk_demo_mode");
        localStorage.removeItem("whisk_demo_owner");
      }
      setIsAuthenticated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    localStorage.removeItem("whisk_user_id");
    localStorage.removeItem("whisk_demo_mode");
    localStorage.removeItem("whisk_demo_owner");
    setIsAuthenticated(false);
  }, []);

  return {
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    userId: localStorage.getItem("whisk_user_id"),
    userName: localStorage.getItem("whisk_display_name"),
    isDemoMode: localStorage.getItem("whisk_demo_mode") === "true",
    isDemoOwner: localStorage.getItem("whisk_demo_owner") === "true",
  };
}
