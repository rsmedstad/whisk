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
  subcategory?: string;
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

  // Process in batches of 20 to avoid token limits
  const BATCH_SIZE = 20;
  const allResults: ClassifiedItem[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchPrompt = `Classify these grocery/shopping items into store departments and subcategories.

Valid categories: ${VALID_CATEGORIES.join(", ")}

For each item, also assign a short subcategory label that groups similar items within the department. Examples:
- Produce subcategories: "Fresh Vegetables", "Fresh Fruits", "Fresh Herbs", "Roots & Alliums"
- Pantry subcategories: "Canned Goods", "Dried Spices", "Oils & Vinegars", "Grains & Pasta", "Baking", "Sauces & Condiments", "Nuts & Seeds"
- Dairy subcategories: "Cheese", "Milk & Cream", "Eggs", "Yogurt"
- Meat subcategories: "Poultry", "Beef", "Pork", "Seafood", "Deli"

Use short, consistent labels. Reuse the same subcategory name for similar items.

Items to classify:
${batch.map((item, j) => `${j + 1}. ${item}`).join("\n")}

Respond with ONLY a JSON array. No explanation, no markdown. Example:
[{"name": "cilantro", "category": "produce", "subcategory": "Fresh Herbs"}]`;

    try {
      // Don't use jsonMode — some models (Groq) fail JSON validation with it
      const content = await callTextAI(fnConfig, context.env, [
        { role: "system", content: "You are a grocery store expert. Classify items into the correct store department and subcategory. Respond with ONLY a valid JSON array, no other text." },
        { role: "user", content: batchPrompt },
      ], { maxTokens: 1024, temperature: 0.1 });

      // Extract JSON from response — handle markdown code blocks, leading text, etc.
      let jsonStr = content.trim();
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch?.[1]) {
        jsonStr = codeBlockMatch[1].trim();
      }
      // Find the JSON array even if there's surrounding text
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch?.[0]) {
        jsonStr = arrayMatch[0];
      }

      const parsed = JSON.parse(jsonStr) as ClassifiedItem[];
      const validated = parsed.map((item) => ({
        name: item.name,
        category: VALID_CATEGORIES.includes(item.category) ? item.category : "other",
        subcategory: typeof item.subcategory === "string" ? item.subcategory.trim() : undefined,
      }));
      allResults.push(...validated);
    } catch {
      // Fallback for this batch — use "other" with no subcategory
      allResults.push(...batch.map((name) => ({ name, category: "other" })));
    }
  }

  return new Response(JSON.stringify({ items: allResults }), {
    headers: { "Content-Type": "application/json" },
  });
};
