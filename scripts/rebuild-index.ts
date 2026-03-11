// Rebuild the recipes:index from all recipe:* KV entries
const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";

const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token found"); process.exit(1); }
const token = tokenMatch[1];

const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const headers = { Authorization: `Bearer ${token}` };

// List all recipe keys
const listRes = await fetch(`${base}/keys?prefix=recipe:&limit=1000`, { headers });
const listData = (await listRes.json()) as { result: { name: string }[] };
const recipeKeys = listData.result
  .map((k) => k.name)
  .filter((k) => k !== "recipes:index" && k.startsWith("recipe:"));

console.log(`Found ${recipeKeys.length} recipes, rebuilding index...`);

function computeComplexity(totalMinutes: number, ingredientCount: number, stepCount: number): "simple" | "moderate" | "elaborate" {
  const t = totalMinutes <= 0 ? 1 : totalMinutes <= 35 ? 0 : totalMinutes <= 60 ? 1 : 2;
  const i = ingredientCount <= 7 ? 0 : ingredientCount <= 12 ? 1 : 2;
  const s = stepCount <= 5 ? 0 : stepCount <= 10 ? 1 : 2;
  const score = t + i + s;
  return score <= 2 ? "simple" : score <= 4 ? "moderate" : "elaborate";
}

interface IndexEntry {
  id: string;
  title: string;
  tags: string[];
  cuisine?: string;
  favorite: boolean;
  favoritedBy?: string[];
  updatedAt: string;
  thumbnailUrl?: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  description?: string;
  cookedCount?: number;
  lastCookedAt?: string;
  avgRating?: number;
  ratingCount?: number;
  spirits?: string[];
  ingredientCount?: number;
  stepCount?: number;
  complexity?: "simple" | "moderate" | "elaborate";
}

const index: IndexEntry[] = [];

for (const key of recipeKeys) {
  const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, { headers });
  const text = await res.text();
  try {
    const d = JSON.parse(text);
    const id = key.replace("recipe:", "");
    const ingCount = Array.isArray(d.ingredients) ? d.ingredients.length : 0;
    const stpCount = Array.isArray(d.steps) ? d.steps.length : 0;
    const totalMin = (d.prepTime ?? 0) + (d.cookTime ?? 0);
    index.push({
      id,
      title: d.title ?? "Untitled",
      tags: d.tags ?? [],
      cuisine: d.cuisine,
      favorite: d.favorite ?? false,
      favoritedBy: d.favoritedBy,
      updatedAt: d.updatedAt ?? new Date().toISOString(),
      thumbnailUrl: d.thumbnailUrl,
      prepTime: d.prepTime,
      cookTime: d.cookTime,
      servings: d.servings,
      description: d.description,
      cookedCount: d.cookedCount,
      lastCookedAt: d.lastCookedAt,
      avgRating: d.ratings ? Math.round((Object.values(d.ratings as Record<string, number>).reduce((a: number, b: number) => a + b, 0) / Object.values(d.ratings as Record<string, number>).length) * 10) / 10 : undefined,
      ratingCount: d.ratings ? Object.keys(d.ratings as Record<string, number>).length : undefined,
      spirits: d.spirits,
      ingredientCount: ingCount,
      stepCount: stpCount,
      complexity: computeComplexity(totalMin, ingCount, stpCount),
    });
  } catch (e) {
    console.log(`  SKIP ${key}: parse error`);
  }
}

// Sort by updatedAt descending
index.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

console.log(`Built index with ${index.length} entries`);

// Write back to KV
const putRes = await fetch(`${base}/values/${encodeURIComponent("recipes:index")}`, {
  method: "PUT",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify(index),
});

if (putRes.ok) {
  console.log("Index updated successfully!");
} else {
  const err = await putRes.text();
  console.error("Failed to update index:", err);
}
