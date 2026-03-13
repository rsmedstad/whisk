import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
}

interface InputItem {
  id: string;
  name: string;
  amount?: string | null;
  unit?: string | null;
  category?: string | null;
}

interface SmartItem {
  name: string;
  amount: string | null;
  unit: string | null;
  category: string;
  sourceItemIds: string[];
}

interface SmartListResult {
  smartItems: SmartItem[];
  stats: {
    originalCount: number;
    smartCount: number;
    combinedCount: number;
  };
}

/** Normalize name for pre-processing: lowercase, trim, strip trailing 's' for basic plural handling */
function normalizeKey(name: string): string {
  const n = name.toLowerCase().trim().replace(/\s+/g, " ");
  // Very basic plural handling: "tomatoes" → "tomato", "onions" → "onion"
  return n.replace(/(?:oes|ies|es|s)$/, (m) => {
    if (m === "ies") return "y";
    if (m === "oes") return "o";
    if (m === "es") return "e";
    return "";
  });
}

/** Try to parse a numeric amount (supports fractions like "1/2", "1 1/2") */
function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  // Mixed fraction: "1 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]!) + parseInt(mixed[2]!) / parseInt(mixed[3]!);
  // Simple fraction: "1/2"
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]!) / parseInt(frac[2]!);
  // Decimal or integer
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

/** Format a number back to a readable string (use fractions where clean) */
function formatAmount(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  // Common fractions
  const fracs: [number, string][] = [[0.25, "1/4"], [0.333, "1/3"], [0.5, "1/2"], [0.667, "2/3"], [0.75, "3/4"]];
  const whole = Math.floor(n);
  const remainder = n - whole;
  for (const [val, str] of fracs) {
    if (Math.abs(remainder - val) < 0.05) {
      return whole > 0 ? `${whole} ${str}` : str;
    }
  }
  // Round to 1 decimal
  const rounded = Math.round(n * 10) / 10;
  return rounded.toString();
}

/**
 * Pre-process items: group by normalized name+unit, sum numeric amounts.
 * This handles exact matches without needing LLM.
 */
function preProcess(items: InputItem[]): { merged: SmartItem[]; remaining: InputItem[] } {
  const groups = new Map<string, { items: InputItem[]; totalAmount: number | null; hasNumeric: boolean }>();

  for (const item of items) {
    const key = `${normalizeKey(item.name)}||${(item.unit ?? "").toLowerCase().trim()}`;
    const existing = groups.get(key);
    const parsed = parseAmount(item.amount);

    if (existing) {
      existing.items.push(item);
      if (parsed !== null && existing.hasNumeric) {
        existing.totalAmount = (existing.totalAmount ?? 0) + parsed;
      } else if (parsed !== null) {
        existing.totalAmount = parsed;
        existing.hasNumeric = true;
      }
    } else {
      groups.set(key, { items: [item], totalAmount: parsed, hasNumeric: parsed !== null });
    }
  }

  const merged: SmartItem[] = [];
  const remaining: InputItem[] = [];

  for (const [, group] of groups) {
    const first = group.items[0]!;
    if (group.items.length > 1) {
      // Merged group
      merged.push({
        name: first.name,
        amount: group.totalAmount !== null ? formatAmount(group.totalAmount) : first.amount ?? null,
        unit: first.unit ?? null,
        category: (first.category as string) ?? "other",
        sourceItemIds: group.items.map((i) => i.id),
      });
    } else {
      // Single item — keep for potential LLM semantic dedup
      remaining.push(first);
    }
  }

  return { merged, remaining };
}

// POST /api/shopping/smart-list - Deduplicate and combine shopping items
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const startTime = Date.now();

  const body = (await request.json()) as { items?: InputItem[] };
  const items = body.items;

  if (!Array.isArray(items) || items.length === 0) {
    return new Response(
      JSON.stringify({ smartItems: [], stats: { originalCount: 0, smartCount: 0, combinedCount: 0 } }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Phase 1: Pre-process exact matches (no LLM needed)
  const { merged, remaining } = preProcess(items);

  // If few items remaining, skip LLM — not worth it
  if (remaining.length < 3) {
    const allSmart = [
      ...merged,
      ...remaining.map((i) => ({
        name: i.name,
        amount: i.amount ?? null,
        unit: i.unit ?? null,
        category: (i.category as string) ?? "other",
        sourceItemIds: [i.id],
      })),
    ];
    const result: SmartListResult = {
      smartItems: allSmart,
      stats: { originalCount: items.length, smartCount: allSmart.length, combinedCount: items.length - allSmart.length },
    };
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  }

  // Phase 2: LLM semantic dedup for remaining items
  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);

  if (!fnConfig) {
    // No AI configured — return pre-processed results only
    const allSmart = [
      ...merged,
      ...remaining.map((i) => ({
        name: i.name,
        amount: i.amount ?? null,
        unit: i.unit ?? null,
        category: (i.category as string) ?? "other",
        sourceItemIds: [i.id],
      })),
    ];
    const result: SmartListResult = {
      smartItems: allSmart,
      stats: { originalCount: items.length, smartCount: allSmart.length, combinedCount: items.length - allSmart.length },
    };
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  }

  try {
    const itemList = remaining.map((i) => ({
      id: i.id,
      name: i.name,
      amount: i.amount ?? null,
      unit: i.unit ?? null,
      category: i.category ?? "other",
    }));

    const prompt = [
      "You are a grocery shopping list optimizer. Given a list of shopping items, combine duplicates and similar items.",
      "Respond with ONLY a JSON object (no markdown) with this structure:",
      '{ "groups": [ { "name": "normalized item name", "amount": "combined amount or null", "unit": "unit or null", "category": "category", "sourceIds": ["id1", "id2"] } ] }',
      "",
      "Rules:",
      "- Combine items that are clearly the same ingredient (e.g. 'garlic cloves' + 'cloves of garlic' → 'garlic cloves')",
      "- Sum quantities when units match (e.g. '2 cups milk' + '1 cup milk' → '3 cups milk')",
      "- Convert compatible units when obvious (e.g. '1 lb butter' + '8 oz butter' → '1.5 lb butter')",
      "- Keep genuinely different items separate (e.g. 'green onions' and 'yellow onions' are different)",
      "- Preserve the most specific/descriptive name when combining",
      "- Items with only one source should still appear in the output",
      "- Every source id must appear in exactly one group",
      "",
      "Items to process:",
      JSON.stringify(itemList),
    ].join("\n");

    const content = await callTextAI(fnConfig, env, [
      { role: "user", content: prompt },
    ], {
      maxTokens: 1024,
      temperature: 0.1,
      jsonMode: true,
    });

    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(jsonStr) as { groups?: Array<{ name: string; amount?: string | null; unit?: string | null; category?: string; sourceIds?: string[] }> };

    const llmSmart: SmartItem[] = (parsed.groups ?? []).map((g) => ({
      name: g.name,
      amount: g.amount ?? null,
      unit: g.unit ?? null,
      category: g.category ?? "other",
      sourceItemIds: g.sourceIds ?? [],
    }));

    const allSmart = [...merged, ...llmSmart];
    const totalMs = Date.now() - startTime;

    const result: SmartListResult = {
      smartItems: allSmart,
      stats: { originalCount: items.length, smartCount: allSmart.length, combinedCount: items.length - allSmart.length },
    };

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "X-Whisk-Timing": `total=${totalMs}ms premerged=${merged.length} llm=${llmSmart.length}`,
      },
    });
  } catch (err) {
    // LLM failed — return pre-processed results as fallback
    const errMsg = err instanceof Error ? err.message : "Smart list failed";
    console.error(`[Whisk] SmartList error:`, errMsg);

    const allSmart = [
      ...merged,
      ...remaining.map((i) => ({
        name: i.name,
        amount: i.amount ?? null,
        unit: i.unit ?? null,
        category: (i.category as string) ?? "other",
        sourceItemIds: [i.id],
      })),
    ];
    const result: SmartListResult = {
      smartItems: allSmart,
      stats: { originalCount: items.length, smartCount: allSmart.length, combinedCount: items.length - allSmart.length },
    };
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  }
};
