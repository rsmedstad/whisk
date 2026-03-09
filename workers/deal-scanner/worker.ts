// Cloudflare Worker with cron trigger for scheduled deal scanning.
// Deployed separately from the main Whisk Pages app.
//
// Setup:
//   cd workers/deal-scanner
//   npx wrangler deploy
//
// Required env vars (set via `npx wrangler secret put`):
//   WHISK_URL    — Base URL of your Whisk deployment (e.g. https://whisk-15t.pages.dev)
//   CRON_SECRET  — Shared secret matching the CRON_SECRET in the main app

interface Env {
  WHISK_URL: string;
  CRON_SECRET: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const url = `${env.WHISK_URL.replace(/\/$/, "")}/api/deals/cron`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cron-Secret": env.CRON_SECRET,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Deal scanner cron failed: ${res.status} — ${body}`);
      return;
    }

    const result = await res.json();
    console.log("Deal scanner cron result:", JSON.stringify(result));
  },

  // Optional: allow manual trigger via HTTP
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Send POST to trigger deal scan", { status: 405 });
    }

    const secret = request.headers.get("X-Cron-Secret");
    if (secret !== env.CRON_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = `${env.WHISK_URL.replace(/\/$/, "")}/api/deals/cron`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cron-Secret": env.CRON_SECRET,
      },
    });

    const result = await res.json();
    return new Response(JSON.stringify(result), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  },
};
