interface Env {
  WHISK_KV: KVNamespace;
}

// Validate plan/week ID format to prevent KV key injection
// Accepts "current" or week identifiers like "2026-W10", "2026-W01"
const VALID_PLAN_ID = /^(current|\d{4}-W\d{2})$/;

// GET /api/plan?week=YYYY-WXX
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const week = url.searchParams.get("week") ?? "current";

  if (!VALID_PLAN_ID.test(week)) {
    return new Response(JSON.stringify({ error: "Invalid week format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const plan = await env.WHISK_KV.get(`plan:${week}`, "json");
  return new Response(JSON.stringify(plan), {
    headers: { "Content-Type": "application/json" },
  });
};

// PUT /api/plan
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as { id: string };

  if (typeof body.id !== "string" || !VALID_PLAN_ID.test(body.id)) {
    return new Response(JSON.stringify({ error: "Invalid plan ID format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  await env.WHISK_KV.put(`plan:${body.id}`, JSON.stringify(body));
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
};
