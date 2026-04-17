interface Env {
  APP_SECRET: string;
  OWNER_PASSWORD?: string;
  DEMO_MODE?: string;
  WHISK_KV: KVNamespace;
}

interface HouseholdMember {
  id: string;
  name: string;
  isOwner: boolean;
  joinedAt: string;
}

interface Household {
  members: HouseholdMember[];
  updatedAt: string;
}

const RATE_LIMIT_MAX = 10; // failed attempts per window per IP
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

interface RateLimitState {
  count: number;
  resetAt: number; // epoch seconds
}

async function checkAndIncrementRate(
  kv: KVNamespace,
  ip: string
): Promise<{ blocked: boolean; retryAfter: number }> {
  const key = `rl:auth:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const existing = await kv.get<RateLimitState>(key, "json");
  const state: RateLimitState =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_SECONDS };
  if (state.count >= RATE_LIMIT_MAX) {
    return { blocked: true, retryAfter: Math.max(1, state.resetAt - now) };
  }
  return { blocked: false, retryAfter: 0 };
}

async function recordFailedAttempt(kv: KVNamespace, ip: string): Promise<void> {
  const key = `rl:auth:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const existing = await kv.get<RateLimitState>(key, "json");
  const state: RateLimitState =
    existing && existing.resetAt > now
      ? { count: existing.count + 1, resetAt: existing.resetAt }
      : { count: 1, resetAt: now + RATE_LIMIT_WINDOW_SECONDS };
  await kv.put(key, JSON.stringify(state), {
    expirationTtl: Math.max(60, state.resetAt - now),
  });
}

async function clearRateLimit(kv: KVNamespace, ip: string): Promise<void> {
  await kv.delete(`rl:auth:${ip}`);
}

// Constant-time comparison of two strings via SHA-256 digest.
// Hashing first ensures both inputs are the same length, so iteration
// count doesn't leak the length of the secret.
async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= (va[i] ?? 0) ^ (vb[i] ?? 0);
  return diff === 0;
}

// Check if a book (household) already exists — unauthenticated
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const household = await env.WHISK_KV.get<Household>("household", "json");
    const bookExists = !!household && household.members.length > 0;
    return new Response(JSON.stringify({ bookExists }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ bookExists: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const rate = await checkAndIncrementRate(env.WHISK_KV, clientIp);
    if (rate.blocked) {
      return new Response(
        JSON.stringify({ error: "Too many attempts. Try again later." }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rate.retryAfter),
          },
        }
      );
    }

    const body = (await request.json()) as { password: string; name?: string };
    const { password, name } = body;

    if (!password || !env.APP_SECRET) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const isDemoMode = env.DEMO_MODE === "true";

    // In demo mode, accept either APP_SECRET (regular user) or OWNER_PASSWORD (owner)
    const isOwnerLogin =
      isDemoMode &&
      !!env.OWNER_PASSWORD &&
      (await timingSafeEqualStr(password, env.OWNER_PASSWORD));
    const isRegularLogin = await timingSafeEqualStr(password, env.APP_SECRET);

    if (!isOwnerLogin && !isRegularLogin) {
      await recordFailedAttempt(env.WHISK_KV, clientIp);
      return new Response(JSON.stringify({ error: "Invalid password" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Successful auth — reset the rate-limit counter for this IP.
    await clearRateLimit(env.WHISK_KV, clientIp);

    // Load or create household
    let household = await env.WHISK_KV.get<Household>("household", "json");
    if (!household) {
      household = { members: [], updatedAt: new Date().toISOString() };
    }

    const displayName = (name ?? "").trim();
    let member: HouseholdMember | undefined;

    if (displayName) {
      // In demo mode with regular login, never match an existing owner member by name
      // This prevents someone from typing "Ryan" and getting owner access
      if (isDemoMode && !isOwnerLogin) {
        member = household.members.find(
          (m) => m.name.toLowerCase() === displayName.toLowerCase() && !m.isOwner
        );
      } else {
        // Find existing member by name (case-insensitive)
        member = household.members.find(
          (m) => m.name.toLowerCase() === displayName.toLowerCase()
        );
      }

      if (!member) {
        // Check if the name is already taken by another member (prevents duplicates)
        const nameTaken = household.members.some(
          (m) => m.name.toLowerCase() === displayName.toLowerCase()
        );
        if (nameTaken) {
          return new Response(
            JSON.stringify({
              error: "Someone with that name has already joined this book. If this is you, make sure you're using the correct password. Otherwise, please choose a different name.",
            }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }

        // Create new member — first member is the owner
        const idData = new Uint8Array(8);
        crypto.getRandomValues(idData);
        const userId = Array.from(idData)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        member = {
          id: userId,
          name: displayName,
          isOwner: household.members.length === 0,
          joinedAt: new Date().toISOString(),
        };
        household.members.push(member);
        household.updatedAt = new Date().toISOString();
        await env.WHISK_KV.put("household", JSON.stringify(household));
      }
    }

    // Generate session token
    const tokenData = new Uint8Array(32);
    crypto.getRandomValues(tokenData);
    const token = btoa(String.fromCharCode(...tokenData))
      .replace(/[+/=]/g, "")
      .slice(0, 48);

    // In demo mode, only the owner login gets isDemoOwner flag
    const isDemoOwner = isDemoMode && isOwnerLogin;

    // Store session with user identity (backwards-compatible: works with or without name)
    const sessionData = member
      ? JSON.stringify({ userId: member.id, name: member.name, isDemoOwner })
      : isDemoOwner
        ? JSON.stringify({ isDemoOwner: true })
        : "valid";

    const sessionTtl = 60 * 60 * 24 * 30;
    await env.WHISK_KV.put(`session:${token}`, sessionData, {
      expirationTtl: sessionTtl,
    });

    // Track active session tokens per user so we can revoke them on member removal
    if (member) {
      const sessionsKey = `user_sessions:${member.id}`;
      const existing = await env.WHISK_KV.get<string[]>(sessionsKey, "json");
      const tokens = existing ?? [];
      tokens.push(token);
      // Keep only last 10 tokens per user (older ones expire naturally via TTL)
      await env.WHISK_KV.put(sessionsKey, JSON.stringify(tokens.slice(-10)), {
        expirationTtl: sessionTtl,
      });
    }

    return new Response(
      JSON.stringify({
        token,
        userId: member?.id ?? null,
        name: member?.name ?? null,
        isOwner: member?.isOwner ?? false,
        demoMode: isDemoMode,
        isDemoOwner,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
