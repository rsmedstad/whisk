import {
  loadAIConfig,
  resolveConfig,
  callVisionAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

// POST /api/shopping/scan - OCR handwritten shopping list from photo
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "ocr", env);

  if (!fnConfig) {
    return new Response(
      JSON.stringify({
        items: [],
        message: "Configure a vision-capable AI provider in Settings to enable list scanning.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Read photo from form data
  const formData = await request.formData();
  const photo = formData.get("photo") as File | null;

  if (!photo) {
    return new Response(
      JSON.stringify({ error: "No photo provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Convert to base64
  const arrayBuffer = await photo.arrayBuffer();
  const base64 = btoa(
    Array.from(new Uint8Array(arrayBuffer), (b) => String.fromCharCode(b)).join("")
  );
  const mimeType = photo.type || "image/jpeg";

  const prompt = [
    "You are an OCR assistant for a shopping list app. Read the handwritten or printed shopping list in this image.",
    "Respond with ONLY a JSON object (no markdown) with this structure:",
    '{ "items": [ { "name": "item name", "amount": "quantity or null", "unit": "unit or null", "category": "produce" | "dairy" | "meat" | "pantry" | "frozen" | "bakery" | "beverages" | "other" } ] }',
    "Rules:",
    "- Extract each item as a separate entry",
    "- Normalize item names to common grocery terms",
    "- Guess the category based on the item name",
    "- If amount/unit aren't clear, omit them (use null)",
    "- If you can't read some items, include your best guess",
  ].join("\n");

  try {
    const content = await callVisionAI(fnConfig, env, prompt, base64, mimeType, {
      maxTokens: 1024,
      temperature: 0.2,
    });

    // Parse AI response — strip markdown fences if present
    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const result = JSON.parse(jsonStr);

    return new Response(
      JSON.stringify(result),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        items: [],
        message: err instanceof Error ? err.message : "Failed to scan list",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
};
