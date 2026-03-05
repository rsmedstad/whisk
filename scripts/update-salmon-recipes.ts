// Update Citrus Salmon w/ Feta (missing all data) and Festive Salmon (add sourceUrl)
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
  return res.json() as Promise<Record<string, unknown>>;
}

async function putRecipe(id: string, data: Record<string, unknown>) {
  const res = await fetch(`${kvBase}/values/${encodeURIComponent(`recipe:${id}`)}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.ok;
}

const now = new Date().toISOString();

// 1. Update Citrus Salmon w/ Feta (r_509b6333)
console.log("Updating Citrus Salmon w/ Feta...");
const citrus = await getRecipe("r_509b6333");
const citrusUpdated = {
  ...citrus,
  title: "Citrus Salmon w/ Feta Sauce & Roasted Veggies",
  description: "Baked salmon brushed with lemon-dill oil, served over roasted veggies with a creamy whipped feta sauce.",
  sourceUrl: "https://www.caileeeats.com/recipes/citrus-salmon-with-creamy-feta-sauce",
  ingredients: [
    // Salmon
    { amount: "4", unit: "", name: "6oz pieces of salmon" },
    { amount: "1", unit: "tbsp", name: "olive oil" },
    { amount: "1/2", unit: "tsp", name: "salt & pepper" },
    { amount: "1", unit: "", name: "small lemon, juiced" },
    { amount: "1", unit: "tsp", name: "fresh dill, chopped" },
    // Feta sauce
    { amount: "3/4", unit: "cup", name: "crumbled feta (from feta in brine)" },
    { amount: "1/2", unit: "cup", name: "plain Greek yogurt" },
    { amount: "1/2", unit: "", name: "lemon, juiced" },
    { amount: "1", unit: "clove", name: "garlic" },
    { amount: "1", unit: "tbsp", name: "fresh dill" },
    { amount: "1-2", unit: "tbsp", name: "water to thin" },
    // Roasted veggies
    { amount: "1", unit: "", name: "red bell pepper, cut into chunks" },
    { amount: "2", unit: "", name: "small zucchini, sliced into half moons" },
    { amount: "1", unit: "", name: "red onion, cut into chunks" },
    { amount: "1", unit: "cup", name: "cherry tomatoes, cut in half" },
    { amount: "1", unit: "tbsp", name: "olive oil" },
    { amount: "", unit: "", name: "dried oregano, salt & pepper" },
  ],
  steps: [
    "Preheat the oven to 425°F. Add all the cut veggies to a large baking sheet and toss with olive oil, oregano, salt, and pepper. Roast for 25-30 minutes until fully cooked and starting to crisp.",
    "While the veggies roast, pat the salmon dry and place it on a cutting board.",
    "In a small bowl, mix the olive oil, salt, pepper, lemon juice, and chopped dill. Brush this mixture over the top of each piece of salmon.",
    "Bake or air-fry salmon at 400°F for 10-12 minutes or until fully cooked.",
    "Meanwhile, make the feta sauce. In a blender or food processor, combine the feta, Greek yogurt, lemon juice, garlic, and dill. Blend until smooth, adding a tablespoon of water as needed for creaminess.",
    "To each plate, add a generous helping of veggies and a piece of salmon, then top the salmon with creamy feta sauce.",
  ],
  prepTime: 15,
  cookTime: 30,
  servings: 4,
  tags: ["dinner"],
  updatedAt: now,
  lastCrawledAt: now,
};

let ok = await putRecipe("r_509b6333", citrusUpdated);
console.log(ok ? "  Done" : "  FAILED");

// 2. Add sourceUrl to Festive Baked Salmon (r_2c5af527)
console.log("Updating Festive Baked Salmon sourceUrl...");
const festive = await getRecipe("r_2c5af527");
const festiveUpdated = {
  ...festive,
  sourceUrl: "https://www.instagram.com/p/DSpoPDpDEVS/",
  updatedAt: now,
};

ok = await putRecipe("r_2c5af527", festiveUpdated);
console.log(ok ? "  Done" : "  FAILED");

console.log("\nRun rebuild-index.ts to update the index.");
