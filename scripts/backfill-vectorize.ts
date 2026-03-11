// One-time script to embed all existing recipes into the Vectorize index.
// Run with: bun scripts/backfill-vectorize.ts

const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";
const VECTORIZE_INDEX = "whisk-recipes";
const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

// Read wrangler OAuth token
const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token found"); process.exit(1); }
const token = tokenMatch[1];

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;

// List all recipe keys
console.log("Fetching recipe list...");
const listRes = await fetch(`${kvBase}/keys?prefix=recipe:&limit=1000`, { headers });
const listData = (await listRes.json()) as { result: { name: string }[] };
const recipeKeys = listData.result
  .map((k) => k.name)
  .filter((k) => k !== "recipes:index" && k.startsWith("recipe:"));

console.log(`Found ${recipeKeys.length} recipes to embed.`);

interface EmbeddingInput {
  id: string;
  title: string;
  text: string;
}

// Fetch all recipes and build embedding texts
const recipes: EmbeddingInput[] = [];
for (const key of recipeKeys) {
  const res = await fetch(`${kvBase}/values/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
  const raw = await res.text();
  try {
    const d = JSON.parse(raw);
    const id = key.replace("recipe:", "");
    const parts: string[] = [d.title ?? "Untitled"];
    if (d.cuisine) parts.push(d.cuisine);
    if (Array.isArray(d.tags) && d.tags.length > 0) parts.push(d.tags.join(", "));
    if (Array.isArray(d.ingredients)) {
      const names = d.ingredients
        .map((i: { name?: string }) => i.name)
        .filter((n: unknown): n is string => !!n);
      if (names.length > 0) parts.push(names.join(", "));
    }
    if (d.description) parts.push(d.description);
    recipes.push({ id, title: d.title ?? "Untitled", text: parts.join(". ").slice(0, 2000) });
  } catch {
    console.log(`  SKIP ${key}: parse error`);
  }
}

console.log(`Parsed ${recipes.length} recipes. Generating embeddings...`);

// Batch embed (Workers AI supports batch input)
const BATCH_SIZE = 50; // Workers AI accepts up to 100 texts per call
let totalUpserted = 0;

for (let i = 0; i < recipes.length; i += BATCH_SIZE) {
  const batch = recipes.slice(i, i + BATCH_SIZE);
  const texts = batch.map((r) => r.text);

  // Call Workers AI embedding endpoint
  const embRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ text: texts }),
    }
  );

  if (!embRes.ok) {
    const errText = await embRes.text();
    console.error(`Embedding API error: ${embRes.status} ${errText}`);
    continue;
  }

  const embData = (await embRes.json()) as { result: { data: number[][] } };
  const vectors = embData.result.data;

  if (!vectors || vectors.length !== batch.length) {
    console.error(`Expected ${batch.length} vectors, got ${vectors?.length ?? 0}`);
    continue;
  }

  // Upsert into Vectorize
  const ndjson = batch
    .map((r, j) => JSON.stringify({
      id: r.id,
      values: vectors[j],
      metadata: { title: r.title },
    }))
    .join("\n");

  const upsertRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${VECTORIZE_INDEX}/upsert`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-ndjson" },
      body: ndjson,
    }
  );

  if (!upsertRes.ok) {
    const errText = await upsertRes.text();
    console.error(`Vectorize upsert error: ${upsertRes.status} ${errText}`);
    continue;
  }

  totalUpserted += batch.length;
  console.log(`  Embedded ${totalUpserted}/${recipes.length} recipes`);
}

console.log(`\nDone! Upserted ${totalUpserted} vectors into Vectorize index "${VECTORIZE_INDEX}".`);
