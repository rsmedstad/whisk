interface Env {
  WHISK_KV: KVNamespace;
  DEMO_MODE?: string;
}

// Public routes that don't require auth
const PUBLIC_PATHS = ["/api/auth", "/api/share/"];

// Endpoints restricted to demo owner when DEMO_MODE is enabled
const DEMO_RESTRICTED_PATHS = [
  "/api/recipes",       // POST (create) — GET is allowed, checked by method below
  "/api/import/",       // All import endpoints
  "/api/identify/",     // Photo identification
  "/api/ai/",           // All AI endpoints (chat, suggest, auto-tag, group-steps)
  "/api/discover/feed", // POST/PATCH/DELETE feed management
];

// These paths + methods are always allowed even in demo mode
function isDemoAllowed(pathname: string, method: string): boolean {
  // GET requests are always allowed (reading/browsing)
  if (method === "GET") return true;

  // Shopping list operations are always allowed
  if (pathname.startsWith("/api/shopping")) return true;

  // Meal plan operations are always allowed (read + write)
  if (pathname.startsWith("/api/plan")) return true;

  // Tags are read-only for demo, but PUT is needed for normal operation
  // Allow tags since they're lightweight
  if (pathname.startsWith("/api/tags")) return true;

  // Capabilities is GET-only, already covered above

  return false;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  // Skip auth for public routes
  if (PUBLIC_PATHS.some((p) => url.pathname.startsWith(p))) {
    return context.next();
  }

  // Check auth header
  const authHeader = context.request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = authHeader.slice(7);
  const session = await context.env.WHISK_KV.get(`session:${token}`);

  if (!session) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse user identity from session (backwards-compatible with old "valid" format)
  let isDemoOwner = false;
  if (session !== "valid") {
    try {
      const parsed = JSON.parse(session) as { userId?: string; name?: string; isDemoOwner?: boolean };
      if (parsed.userId) context.data.userId = parsed.userId;
      if (parsed.name) context.data.userName = parsed.name;
      if (parsed.isDemoOwner) isDemoOwner = true;
    } catch {
      // Old-format session, no user identity — still valid
    }
  }

  // Demo mode: restrict expensive endpoints to owner only
  const isDemoMode = context.env.DEMO_MODE === "true";
  if (isDemoMode && !isDemoOwner) {
    const method = context.request.method;
    const pathname = url.pathname;

    if (!isDemoAllowed(pathname, method)) {
      // Check if this path is restricted
      const isRestricted = DEMO_RESTRICTED_PATHS.some((p) => pathname.startsWith(p));

      // Also restrict individual recipe mutations (PUT/DELETE /api/recipes/:id)
      const isRecipeMutation =
        pathname.match(/^\/api\/recipes\/[^/]+$/) && (method === "PUT" || method === "DELETE");

      if (isRestricted || isRecipeMutation) {
        return new Response(
          JSON.stringify({
            error: "This feature is not available in the demo. Set up your own Whisk to unlock all features!",
            demoRestricted: true,
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }
  }

  const response = await context.next();

  // Security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
};
