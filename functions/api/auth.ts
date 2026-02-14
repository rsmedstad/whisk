interface Env {
  APP_SECRET: string;
  WHISK_KV: KVNamespace;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { password } = (await request.json()) as { password: string };

    if (!password || !env.APP_SECRET) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Simple comparison (the client can hash if desired, but for a personal
    // app with 2 users a direct compare over HTTPS is fine)
    if (password !== env.APP_SECRET) {
      return new Response(JSON.stringify({ error: "Invalid password" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Generate a simple token (base64 timestamp + random bytes)
    const tokenData = new Uint8Array(32);
    crypto.getRandomValues(tokenData);
    const token = btoa(String.fromCharCode(...tokenData))
      .replace(/[+/=]/g, "")
      .slice(0, 48);

    // Store token in KV with 30-day TTL
    await env.WHISK_KV.put(`session:${token}`, "valid", {
      expirationTtl: 60 * 60 * 24 * 30,
    });

    return new Response(JSON.stringify({ token }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
