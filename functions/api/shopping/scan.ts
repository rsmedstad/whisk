interface Env {
  XAI_API_KEY?: string;
}

// POST /api/shopping/scan - OCR handwritten list (placeholder)
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.XAI_API_KEY) {
    return new Response(
      JSON.stringify({
        items: [],
        message: "Configure XAI_API_KEY to enable list scanning.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // TODO: Implement OCR via xAI Grok Vision
  return new Response(
    JSON.stringify({ items: [], message: "Coming soon" }),
    { headers: { "Content-Type": "application/json" } }
  );
};
