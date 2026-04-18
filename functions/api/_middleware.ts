interface Env {
  WHISK_KV: KVNamespace;
  DEMO_MODE?: string;
}

// Public routes that don't require auth.
// image-proxy is loaded by <img> tags which can't send bearer tokens;
// it's already domain-allowlisted inside the handler, so it's safe to expose.
// /api/auth handles both GET (bookExists) and POST (login), both public.
const PUBLIC_PATHS = ["/api/auth", "/api/image-proxy"];

// Share routes: GET (view a shared recipe) is public; POST /api/share/create
// needs auth so demo guests can't create server-persisted share links.
function isPublicShareRead(pathname: string, method: string): boolean {
  return method === "GET" && pathname.startsWith("/api/share/");
}

// In demo mode, these POST endpoints are allowed for unauthenticated guests.
// All are ephemeral — they never persist data to KV or R2.
const DEMO_GUEST_POST_ALLOWED = [
  "/api/ai/chat",
  "/api/ai/suggest",
  "/api/identify/",
  "/api/shopping/scan",
  "/api/import/url", // scrapes only, doesn't save
];

// Per-IP rate limit for demo-guest ephemeral POSTs (AI + scraping)
// Protects free-tier compute from being drained by bots/crawlers.
const DEMO_RATE_MAX = 40;
const DEMO_RATE_WINDOW_SECONDS = 60 * 60; // 1 hour

interface DemoRateState {
  count: number;
  resetAt: number;
}

async function incrementDemoRate(
  kv: KVNamespace,
  ip: string
): Promise<{ blocked: boolean; retryAfter: number }> {
  const key = `rl:demo:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const existing = await kv.get<DemoRateState>(key, "json");
  const state: DemoRateState =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + DEMO_RATE_WINDOW_SECONDS };
  if (state.count >= DEMO_RATE_MAX) {
    return { blocked: true, retryAfter: Math.max(1, state.resetAt - now) };
  }
  state.count++;
  await kv.put(key, JSON.stringify(state), {
    expirationTtl: Math.max(60, state.resetAt - now),
  });
  return { blocked: false, retryAfter: 0 };
}

function addSecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;
  const method = context.request.method;
  const isDemoMode = context.env.DEMO_MODE === "true";

  // Skip auth for public routes
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return context.next();
  }
  if (isPublicShareRead(pathname, method)) {
    return context.next();
  }

  // Parse auth header (may be absent in demo mode)
  const authHeader = context.request.headers.get("Authorization");
  let hasValidToken = false;
  let isDemoOwner = false;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const session = await context.env.WHISK_KV.get(`session:${token}`);
    if (session) {
      hasValidToken = true;
      if (session !== "valid") {
        try {
          const parsed = JSON.parse(session) as {
            userId?: string;
            name?: string;
            isDemoOwner?: boolean;
          };
          if (parsed.userId) context.data.userId = parsed.userId;
          if (parsed.name) context.data.userName = parsed.name;
          if (parsed.isDemoOwner) isDemoOwner = true;
        } catch {
          // Old-format session, no user identity — still valid
        }
      }
    }
  }

  // Non-demo mode: valid token required for everything beyond public routes
  if (!isDemoMode) {
    if (!hasValidToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return addSecurityHeaders(await context.next());
  }

  // Demo mode + owner: full access (admin login via OWNER_PASSWORD)
  if (isDemoOwner) {
    return addSecurityHeaders(await context.next());
  }

  // Demo guest path: unauthenticated OR non-owner token — same restrictions.
  // Allow all GETs (browsing is free).
  if (method === "GET") {
    return addSecurityHeaders(await context.next());
  }

  // Allow ephemeral POSTs with per-IP rate limiting.
  const isEphemeralAI = DEMO_GUEST_POST_ALLOWED.some((p) => pathname.startsWith(p));
  if (isEphemeralAI && method === "POST") {
    const ip = context.request.headers.get("CF-Connecting-IP") ?? "unknown";
    const rate = await incrementDemoRate(context.env.WHISK_KV, ip);
    if (rate.blocked) {
      return new Response(
        JSON.stringify({
          error: "Demo usage limit reached. Try again later, or set up your own Whisk to remove limits.",
          demoRateLimited: true,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rate.retryAfter),
          },
        }
      );
    }
    return addSecurityHeaders(await context.next());
  }

  // All other writes blocked for demo guests (frontend fakes them locally).
  return new Response(
    JSON.stringify({
      error: "This feature isn't available in the demo. Set up your own Whisk to unlock all features!",
      demoRestricted: true,
    }),
    {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }
  );
};
