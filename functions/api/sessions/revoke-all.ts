interface Env {
  WHISK_KV: KVNamespace;
}

// POST /api/sessions/revoke-all — Sign out the caller from every device.
// Middleware has already validated the bearer token and injected userId.
export const onRequestPost: PagesFunction<Env> = async ({ env, data, request }) => {
  const userId = (data as Record<string, string>).userId;
  const authHeader = request.headers.get("Authorization") ?? "";
  const currentToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  // Legacy sessions ("valid" format) don't have a userId. In that case
  // there's no per-user token list to wipe, so kill the calling token only.
  if (!userId) {
    if (currentToken) await env.WHISK_KV.delete(`session:${currentToken}`);
    return new Response(JSON.stringify({ revoked: currentToken ? 1 : 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionsKey = `user_sessions:${userId}`;
  const tokens = (await env.WHISK_KV.get<string[]>(sessionsKey, "json")) ?? [];
  // Make sure the current token is included even if it got trimmed out of
  // the per-user list (which only keeps the last 10).
  const all = new Set(tokens);
  if (currentToken) all.add(currentToken);
  await Promise.all([...all].map((t) => env.WHISK_KV.delete(`session:${t}`)));
  await env.WHISK_KV.delete(sessionsKey);
  return new Response(JSON.stringify({ revoked: all.size }), {
    headers: { "Content-Type": "application/json" },
  });
};
