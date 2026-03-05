// Fix recipe tags: remove "lunch", add "salad" to salad recipes missing it
const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";

const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const token = config.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if (!token) { console.error("No OAuth token found"); process.exit(1); }

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

const fixes: { id: string; removeTags?: string[]; addTags?: string[] }[] = [
  // Carrot Salad: remove "lunch", already has "salad"
  { id: "r_21fc113d", removeTags: ["lunch"] },
  // Dumpling and Smashed Cucumber Salad: add "salad"
  { id: "r_a10213c2", addTags: ["salad"] },
  // Chicken Caesar Pasta Salad: add "salad"
  { id: "r_4678251f", addTags: ["salad"] },
];

for (const fix of fixes) {
  const recipe = await getRecipe(fix.id);
  const tags = (recipe.tags as string[]) ?? [];
  let newTags = [...tags];

  if (fix.removeTags) {
    newTags = newTags.filter(t => !fix.removeTags!.includes(t));
  }
  if (fix.addTags) {
    for (const t of fix.addTags) {
      if (!newTags.includes(t)) newTags.push(t);
    }
  }

  console.log(`${fix.id} | ${recipe.title}`);
  console.log(`  before: [${tags.join(", ")}]`);
  console.log(`  after:  [${newTags.join(", ")}]`);

  recipe.tags = newTags;
  recipe.updatedAt = new Date().toISOString();
  const ok = await putRecipe(fix.id, recipe);
  console.log(`  ${ok ? "✓" : "✗"}\n`);
}

console.log("Done! Run rebuild-index.ts to update the index.");
