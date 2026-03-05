// Update Baked Salmon (r_2c5af527) with data parsed from Instagram caption
const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";

const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token found"); process.exit(1); }
const token = tokenMatch[1];

const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const headers = { Authorization: `Bearer ${token}` };

async function getRecipe(id: string) {
  const res = await fetch(`${kvBase}/values/${encodeURIComponent(`recipe:${id}`)}`, { headers });
  return res.json();
}

async function putRecipe(id: string, data: Record<string, unknown>) {
  const res = await fetch(`${kvBase}/values/${encodeURIComponent(`recipe:${id}`)}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.ok;
}

const existing = await getRecipe("r_2c5af527") as Record<string, unknown>;
const now = new Date().toISOString();

const salmonData = {
  title: "Festive Baked Salmon with Cranberry Orange Glaze",
  description: "A simple, elegant dish that feels special enough for the holidays while still supporting your wellness goals. High in protein, heart-healthy fats, and full of seasonal flavor.",
  sourceUrl: "https://www.instagram.com/p/DSpoPDpDEVS/",
  ingredients: [
    { amount: "4", unit: "", name: "salmon fillets" },
    { amount: "", unit: "", name: "salt and pepper" },
    { amount: "1", unit: "tbsp", name: "olive oil" },
    { amount: "1/2", unit: "cup", name: "fresh or frozen cranberries" },
    { amount: "1", unit: "", name: "orange, juiced and zested" },
    { amount: "1", unit: "tbsp", name: "maple syrup or honey" },
    { amount: "1", unit: "tsp", name: "Dijon mustard" },
  ],
  steps: [
    "Preheat oven to 400°F. Season salmon with salt, pepper, and olive oil. Place on a lined baking sheet.",
    "In a small saucepan, combine cranberries, orange juice, zest, maple syrup, and Dijon mustard. Simmer for 5-7 minutes until cranberries burst and sauce thickens slightly.",
    "Spoon the glaze over the salmon fillets.",
    "Bake for 12-15 minutes until salmon flakes easily with a fork.",
    "Serve with your favorite side — roasted veggies, rice, or a fresh salad.",
  ],
  prepTime: 10,
  cookTime: 15,
  servings: 4,
  tags: ["dinner"],
};

const merged = {
  ...existing,
  ...salmonData,
  updatedAt: now,
  lastCrawledAt: now,
};

const ok = await putRecipe("r_2c5af527", merged);
console.log(`${ok ? "✓" : "✗"} r_2c5af527 — Baked Salmon updated with full recipe data`);
