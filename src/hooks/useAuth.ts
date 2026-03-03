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
  };
}
