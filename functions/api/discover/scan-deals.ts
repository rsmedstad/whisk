import {
  loadAIConfig,
  resolveConfig,
  callVisionAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

// POST /api/discover/scan-deals — Extract deals from store flyer photo
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "vision", env);

  if (!fnConfig) {
    return new Response(
      JSON.stringify({
        deals: [],
        message: "Configure a vision-capable AI provider in Settings to enable flyer scanning.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const formData = await request.formData();
  const photo = formData.get("photo") as File | null;
  const storeName = formData.get("store") as string | null;

  if (!photo) {
    return new Response(
      JSON.stringify({ error: "No photo provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const arrayBuffer = await photo.arrayBuffer();
  const base64 = btoa(
    Array.from(new Uint8Array(arrayBuffer), (b) => String.fromCharCode(b)).join("")
  );
  const mimeType = photo.type || "image/jpeg";

  const storeHint = storeName ? `This flyer is from ${storeName}.` : "";

  const prompt = [
    `You are a grocery deals extraction assistant. Analyze this store flyer/ad image and extract all visible deals and sales. ${storeHint}`,
    "Respond with ONLY a JSON object (no markdown) with this structure:",
    '{ "deals": [ { "item": "product name", "price": "sale price as string (e.g. $2.99)", "originalPrice": "original price if shown or null", "unit": "per lb, each, per pack, etc. or null", "category": "produce" | "dairy" | "meat" | "pantry" | "snacks" | "frozen" | "bakery" | "beverages" | "other", "notes": "any qualifier like BOGO, limit 2, member price, etc. or null" } ], "storeName": "detected store name or null", "validDates": "sale date range if visible or null" }',
    "Rules:",
    "- Extract every deal/sale item visible in the image",
    "- Normalize product names to common terms",
    "- Include the sale price exactly as shown",
    "- Note any restrictions (member-only, limit, BOGO, etc.)",
    "- If dates are visible, include the valid date range",
  ].join("\n");

  try {
    const content = await callVisionAI(fnConfig, env, prompt, base64, mimeType, {
      maxTokens: 2048,
      temperature: 0.2,
    });

    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const result = JSON.parse(jsonStr);

    return new Response(
      JSON.stringify(result),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        deals: [],
        message: err instanceof Error ? err.message : "Failed to scan flyer",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
};
