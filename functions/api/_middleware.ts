interface Env {
  WHISK_KV: KVNamespace;
}

// Public routes that don't require auth
const PUBLIC_PATHS = ["/api/auth", "/api/share/"];

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
  if (session !== "valid") {
    try {
      const parsed = JSON.parse(session) as { userId: string; name: string };
      context.data.userId = parsed.userId;
      context.data.userName = parsed.name;
    } catch {
      // Old-format session, no user identity — still valid
    }
  }

  const response = await context.next();

  // Security headers
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
};
