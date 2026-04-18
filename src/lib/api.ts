const API_BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("whisk_token");
}

export function setToken(token: string): void {
  localStorage.setItem("whisk_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("whisk_token");
}

export function hasToken(): boolean {
  return !!getToken();
}

// ── Demo guest interceptor ─────────────────────────────────
// When running in a demo and the user isn't the owner, we short-circuit
// mutating requests with synthetic responses so the UI still feels interactive
// but nothing persists server-side. Backend middleware blocks these same
// requests as a defense-in-depth measure.
function isDemoInterceptActive(): boolean {
  return (
    localStorage.getItem("whisk_demo_mode") === "true" &&
    localStorage.getItem("whisk_demo_owner") !== "true"
  );
}

// POST endpoints allowed to reach the backend even for demo guests — they
// return ephemeral data (AI responses, OCR output, scraped recipes) without
// persisting anything. The backend middleware rate-limits these by IP.
const DEMO_PASSTHROUGH_POST = [
  "/ai/chat",
  "/ai/suggest",
  "/identify/",
  "/shopping/scan",
  "/shopping/classify",
  "/import/url",
  "/auth", // admin login modal
];

function isDemoPassthroughPost(path: string): boolean {
  return DEMO_PASSTHROUGH_POST.some((p) => path.startsWith(p));
}

function generateDemoId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "demo-" + Math.random().toString(36).slice(2, 12);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function synthDemoResponse(path: string, method: string, body: unknown): unknown {
  const now = new Date().toISOString();
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  // POST /recipes — create recipe. Hook awaits this and uses .id
  if (method === "POST" && path === "/recipes") {
    return {
      id: generateDemoId(),
      createdAt: now,
      updatedAt: now,
      favorite: false,
      tags: [],
      photos: [],
      ingredients: [],
      steps: [],
      ...input,
    };
  }

  // PUT /recipes/:id — update recipe. Hook stores result in cache
  const recipeIdMatch = /^\/recipes\/([^/]+)$/.exec(path);
  if (method === "PUT" && recipeIdMatch) {
    return {
      id: recipeIdMatch[1],
      updatedAt: now,
      ...input,
    };
  }

  // DELETE anything — uniform success
  if (method === "DELETE") {
    return { ok: true };
  }

  // PUT/PATCH /shopping, /plan, /tags, /ai/config etc. — echo payload
  if (method === "PUT" || method === "PATCH") {
    return body ?? { ok: true };
  }

  // Fallback for any POST
  return { ok: true };
}

class DemoRestrictedError extends Error {
  demoRestricted = true;
  constructor(message = "This feature is not available in the demo") {
    super(message);
    this.name = "DemoRestrictedError";
  }
}

// ── Request core ───────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();

  // Demo-guest interception — short-circuit before any network call
  if (isDemoInterceptActive() && method !== "GET") {
    if (method === "POST" && isDemoPassthroughPost(path)) {
      // Fall through to real fetch
    } else {
      const body = options.body && typeof options.body === "string"
        ? safeJsonParse(options.body)
        : undefined;
      return synthDemoResponse(path, method, body) as T;
    }
  }

  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (
    options.body &&
    typeof options.body === "string" &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401 && path !== "/auth") {
    clearToken();
    window.location.reload();
    throw new Error("Unauthorized");
  }

  if (res.status === 403) {
    // Demo-restricted from server (defense in depth) — surface a typed error
    try {
      const payload = (await res.clone().json()) as { demoRestricted?: boolean; demoRateLimited?: boolean; error?: string };
      if (payload.demoRestricted || payload.demoRateLimited) {
        throw new DemoRestrictedError(payload.error);
      }
    } catch (e) {
      if (e instanceof DemoRestrictedError) throw e;
      // fall through to generic error handling
    }
  }

  if (!res.ok) {
    const text = await res.text();
    let message = text || `Request failed: ${res.status}`;
    try {
      const json = JSON.parse(text) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // Not JSON, use raw text
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  upload: async <T>(path: string, file: Blob, filename: string): Promise<T> => {
    // Demo-guest interception: convert blob to data URL and skip network call
    if (isDemoInterceptActive() && path === "/upload") {
      const dataUrl = await blobToDataUrl(file);
      const ext = filename.split(".").pop() ?? "jpg";
      return { url: dataUrl, key: `photos/demo-${generateDemoId()}.${ext}` } as T;
    }

    const formData = new FormData();
    formData.append("file", file, filename);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },
};

export { DemoRestrictedError };
