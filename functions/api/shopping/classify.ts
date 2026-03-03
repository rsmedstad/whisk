import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

interface ClassifyRequest {
  items: string[];
}

interface ClassifiedItem {
  name: string;
  category: string;
}

const VALID_CATEGORIES = [
  "produce", "dairy", "meat", "pantry", "snacks",
  "frozen", "bakery", "beverages", "other",
];

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json()) as ClassifyRequest;
  const { items } = body;

  if (!items || items.length === 0) {
    return new Response(JSON.stringify({ items: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const config = await loadAIConfig(context.env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", context.env);

  if (!fnConfig) {
    return new Response(
      JSON.stringify({ items: items.map((name) => ({ name, category: "other" })) }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const prompt = `Classify these grocery/shopping items into store departments. Valid categories: ${VALID_CATEGORIES.join(", ")}.

Items to classify:
${items.map((item, i) => `${i + 1}. ${item}`).join("\n")}

Respond with ONLY a JSON array of objects with "name" and "category" fields. Example:
[{"name": "almonds", "category": "pantry"}, {"name": "banana", "category": "produce"}]`;

  try {
    const content = await callTextAI(fnConfig, context.env, [
      { role: "system", content: "You are a grocery store expert. Classify items into the correct store department. Respond with only valid JSON." },
      { role: "user", content: prompt },
    ], { maxTokens: 512, temperature: 0.1, jsonMode: true });

    // Parse the JSON response, extracting from markdown code blocks if needed
    let jsonStr = content.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as ClassifiedItem[];
    // Validate categories
    const validated = parsed.map((item) => ({
      name: item.name,
      category: VALID_CATEGORIES.includes(item.category) ? item.category : "other",
    }));

    return new Response(JSON.stringify({ items: validated }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // Fallback to "other" if AI fails
    return new Response(
      JSON.stringify({ items: items.map((name) => ({ name, category: "other" })) }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
};
