import {
  loadAIConfig,
  resolveConfig,
  callVisionAI,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

const DEAL_PROMPT_RULES = [
  "Respond with ONLY a JSON object (no markdown) with this structure:",
  '{ "deals": [ { "item": "product name", "price": "sale price as string (e.g. $2.99)", "originalPrice": "original price if shown or null", "unit": "per lb, each, per pack, etc. or null", "category": "produce" | "dairy" | "meat" | "pantry" | "snacks" | "frozen" | "bakery" | "beverages" | "other", "notes": "any qualifier like BOGO, limit 2, member price, etc. or null" } ], "storeName": "detected store name or null", "validDates": "sale date range if visible or null" }',
  "Rules:",
  "- Extract every deal/sale item visible",
  "- Normalize product names to common terms",
  "- Include the sale price exactly as shown",
  "- Note any restrictions (member-only, limit, BOGO, etc.)",
  "- If dates are visible, include the valid date range",
].join("\n");

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// POST /api/discover/scan-deals — Extract deals from store flyer photo or URL
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const config = await loadAIConfig(env.WHISK_KV);

  const formData = await request.formData();
  const photo = formData.get("photo") as File | null;
  const url = formData.get("url") as string | null;
  const storeName = formData.get("store") as string | null;
  const storeHint = storeName ? `This is from ${storeName}.` : "";

  // URL-based: fetch the page/image and extract deals
  if (url) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          Accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
        },
      });
      if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);

      const contentType = res.headers.get("content-type") ?? "";

      // If the URL points to an image, use vision AI
      if (contentType.startsWith("image/")) {
        const fnConfig = resolveConfig(config, "vision", env);
        if (!fnConfig) {
          return jsonResponse({ deals: [], message: "Configure a vision AI provider in Settings." });
        }
        const buf = await res.arrayBuffer();
        const base64 = btoa(
          Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join("")
        );
        const prompt = `You are a grocery deals extraction assistant. Analyze this store ad image and extract all visible deals. ${storeHint}\n${DEAL_PROMPT_RULES}`;
        const content = await callVisionAI(fnConfig, env, prompt, base64, contentType, {
          maxTokens: 2048,
          temperature: 0.2,
        });
        return jsonResponse(parseAIResponse(content));
      }

      // HTML page — extract text and use text AI
      const fnConfig = resolveConfig(config, "chat", env) ?? resolveConfig(config, "vision", env);
      if (!fnConfig) {
        return jsonResponse({ deals: [], message: "Configure an AI provider in Settings." });
      }
      const html = await res.text();
      const text = stripHtml(html).slice(0, 12000); // Limit context size
      if (text.length < 100) {
        return jsonResponse({ deals: [], message: "Page content too small — site may require JavaScript." });
      }
      const prompt = `You are a grocery deals extraction assistant. Extract all sale/deal items from this store ad page content. ${storeHint}\n${DEAL_PROMPT_RULES}\n\n--- Page Content ---\n${text}`;
      const content = await callTextAI(fnConfig, env, [
        { role: "user", content: prompt },
      ], { maxTokens: 2048, temperature: 0.2, jsonMode: true });
      return jsonResponse(parseAIResponse(content));
    } catch (err) {
      return jsonResponse({
        deals: [],
        message: err instanceof Error ? err.message : "Failed to fetch URL",
      });
    }
  }

  // Photo-based: original flow
  const fnConfig = resolveConfig(config, "vision", env);
  if (!fnConfig) {
    return jsonResponse({
      deals: [],
      message: "Configure a vision-capable AI provider in Settings to scan deals.",
    });
  }

  if (!photo) {
    return new Response(
      JSON.stringify({ error: "Provide a photo or URL" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const arrayBuffer = await photo.arrayBuffer();
  const base64 = btoa(
    Array.from(new Uint8Array(arrayBuffer), (b) => String.fromCharCode(b)).join("")
  );
  const mimeType = photo.type || "image/jpeg";

  const prompt = `You are a grocery deals extraction assistant. Analyze this store flyer/ad image and extract all visible deals and sales. ${storeHint}\n${DEAL_PROMPT_RULES}`;

  try {
    const content = await callVisionAI(fnConfig, env, prompt, base64, mimeType, {
      maxTokens: 2048,
      temperature: 0.2,
    });
    return jsonResponse(parseAIResponse(content));
  } catch (err) {
    return jsonResponse({
      deals: [],
      message: err instanceof Error ? err.message : "Failed to scan flyer",
    });
  }
};

function parseAIResponse(content: string): Record<string, unknown> {
  const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(jsonStr) as Record<string, unknown>;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
