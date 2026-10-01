// MCP Bearer-token gate. Separate from APP_SECRET / session tokens —
// those must never unlock MCP. Fail closed when WHISK_MCP_TOKEN is missing.
// Timing-safe compare of Authorization: Bearer <token>. Rate-limit failed auth.

export type McpAuthEnv = {
  WHISK_MCP_TOKEN?: string;
  WHISK_KV?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  };
};

export type McpAuthOk = { ok: true };
export type McpAuthFail = { ok: false; status: 401 | 429; error: string };
export type McpAuthResult = McpAuthOk | McpAuthFail;

const MAX_MCP_GUESSES = 30;
const GUESS_WINDOW_SEC = 15 * 60;
const guesses = new Map<string, { n: number; exp: number }>();

export function resetMcpAuthLimiter(): void {
  guesses.clear();
}

function clientKey(req: Request): string {
  return (
    req.headers.get("CF-Connecting-IP") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

/** Timing-safe equality for arbitrary UTF-8 secrets (not hex-only). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.byteLength !== bb.byteLength) {
    // Still walk a fixed buffer so length leaks are harder.
    let dump = 0;
    const pad = aa.byteLength > 0 ? aa : new Uint8Array([0]);
    for (let i = 0; i < pad.byteLength; i++) dump |= pad[i]! ^ pad[i]!;
    void dump;
    return false;
  }
  const subtle = crypto.subtle as unknown as {
    timingSafeEqual?: (x: BufferSource, y: BufferSource) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(aa, bb);
  }
  let out = 0;
  for (let i = 0; i < aa.byteLength; i++) out |= aa[i]! ^ bb[i]!;
  return out === 0;
}

function extractBearer(req: Request): string | null {
  const raw = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m?.[1]?.trim() || null;
}

async function guessCount(env: McpAuthEnv, key: string): Promise<number> {
  const now = Date.now();
  const local = guesses.get(key);
  if (local && local.exp > now) return local.n;
  const raw = env.WHISK_KV ? await env.WHISK_KV.get("mcp-guess:" + key) : null;
  return raw ? Number(raw) || 0 : 0;
}

async function bumpGuess(env: McpAuthEnv, key: string): Promise<number> {
  const n = (await guessCount(env, key)) + 1;
  guesses.set(key, { n, exp: Date.now() + GUESS_WINDOW_SEC * 1000 });
  if (env.WHISK_KV) {
    await env.WHISK_KV.put("mcp-guess:" + key, String(n), {
      expirationTtl: GUESS_WINDOW_SEC,
    });
  }
  return n;
}

export async function authorizeMcp(
  req: Request,
  env: McpAuthEnv
): Promise<McpAuthResult> {
  const secret = env.WHISK_MCP_TOKEN;
  if (!secret) return { ok: false, status: 401, error: "mcp locked" };

  const token = extractBearer(req);
  if (!token) return { ok: false, status: 401, error: "bearer token required" };

  const key = clientKey(req);
  if ((await guessCount(env, key)) >= MAX_MCP_GUESSES) {
    return { ok: false, status: 429, error: "too many attempts" };
  }

  if (!timingSafeEqualString(token, secret)) {
    await bumpGuess(env, key);
    return { ok: false, status: 401, error: "unauthorized" };
  }

  return { ok: true };
}
