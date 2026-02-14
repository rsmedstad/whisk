import { useState, useCallback } from "react";
import { api, setToken, clearToken, hasToken } from "../lib/api";

interface LoginResponse {
  token: string;
}

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(hasToken);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const { token } = await api.post<LoginResponse>("/auth", { password });
      setToken(token);
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
    setIsAuthenticated(false);
  }, []);

  return { isAuthenticated, isLoading, error, login, logout };
}
