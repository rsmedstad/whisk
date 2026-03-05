// Update Chuck Roast Tacos (r_75e20e0e) from scraped data + download photo
// Then update Baked Salmon (r_2c5af527) from Instagram via Apify
const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";
const R2_BUCKET = "whisk-photos";

const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) { console.error("No OAuth token found"); process.exit(1); }
const token = tokenMatch[1];

const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;
const r2Base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects`;
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

async function downloadAndUploadPhoto(imageUrl: string, recipeId: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const filename = `import-${recipeId.replace("r_", "")}.${ext}`;
    const body = await res.arrayBuffer();
    const uploadRes = await fetch(`${r2Base}/${filename}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": contentType },
      body,
    });
    if (uploadRes.ok) {
      console.log(`  Uploaded photo: /photos/${filename}`);
      return `/photos/${filename}`;
    }
    console.log(`  Photo upload failed: ${uploadRes.status}`);
    return null;
  } catch (e) {
    console.log(`  Photo download failed: ${(e as Error).message}`);
    return null;
  }
}

// ===== Chuck Roast Tacos =====
console.log("\n=== Updating Chuck Roast Tacos (r_75e20e0e) ===");

const chuckRoastData = {
  title: "Viral Chuck Roast Tacos",
  description: "These Chuck Roast Tacos are the perfect, crowd-pleasing meal with crispy shredded beef, homemade guacamole, and your favorite toppings.",
  sourceUrl: "https://oliviaadriance.com/viral-chuck-roast-tacos/",
  ingredients: [
    { amount: "1", unit: "", name: "boneless beef chuck roast, about 4 pounds" },
    { amount: "", unit: "", name: "salt and pepper to season" },
    { amount: "2", unit: "tbsp", name: "taco seasoning" },
    { amount: "3", unit: "", name: "large avocados" },
    { amount: "2", unit: "", name: "limes, juiced" },
    { amount: "1/2", unit: "", name: "orange, juiced (optional, can substitute more lime juice)" },
    { amount: "2-3", unit: "tbsp", name: "red onion, finely chopped" },
    { amount: "1/4", unit: "cup", name: "fresh cilantro, chopped" },
    { amount: "1/4", unit: "tsp", name: "pepper" },
    { amount: "", unit: "", name: "tortillas" },
    { amount: "", unit: "", name: "white onion, finely chopped" },
    { amount: "", unit: "", name: "fresh cilantro, chopped" },
    { amount: "", unit: "", name: "salsa macha, or your favorite salsa" },
  ],
  steps: [
    "Preheat your oven to 325°F. Season your chuck roast generously on both sides with salt, pepper, and taco seasoning. Add to a Dutch Oven or baking dish, and cover with either the dish lid or a piece of aluminum foil. Bake at 325°F for 3.5 to 4 hours or until the meat is very tender and falling apart.",
    "Remove the roast from the oven and shred it into large chunks using two forks. If the roast is not pulling apart easily, put it back in the oven for 30 minutes.",
    "Raise the oven heat to 425°F.",
    "Toss the shredded pieces of roast around in the rendered fat and place it back in the oven, uncovered, for 20-25 minutes or until you see some nice crispy ends. This is the good part!",
    "While the roast is finishing, make your guacamole. Mash your avocado and combine with lime juice, orange juice (if using), salt, and pepper. Taste and add more lime and salt if needed. Stir in your chopped red onion and cilantro.",
    "Heat your tortillas.",
    "Assemble your tacos by adding a layer of guacamole, chuck roast, and your toppings of choice such as white onion, cilantro, and salsa macha.",
    "Serve and enjoy!",
  ],
  prepTime: 15,
  cookTime: 270,
  servings: 6,
  tags: ["dinner"],
};

{
  const existing = await getRecipe("r_75e20e0e") as Record<string, unknown>;
  const now = new Date().toISOString();
  const photo = await downloadAndUploadPhoto(
    "https://oliviaadriance.com/wp-content/uploads/2024/04/Final_2_Viral_Chuck_Roast_Tacos.jpg",
    "r_75e20e0e"
  );
  const merged = {
    ...existing,
    ...chuckRoastData,
    thumbnailUrl: photo ?? existing.thumbnailUrl,
    updatedAt: now,
    lastCrawledAt: now,
  };
  const ok = await putRecipe("r_75e20e0e", merged);
  console.log(`  ${ok ? "✓" : "✗"} r_75e20e0e`);
}

// ===== Baked Salmon via Apify Instagram Scraper =====
console.log("\n=== Fetching Baked Salmon from Instagram via Apify (r_2c5af527) ===");

const APIFY_TOKEN = "apify_api_9FOT1NtQ32BA4zCoCfK07lCOCXxBya2aMNez";
const igUrl = "https://www.instagram.com/p/DSpoPDpDEVS/";

// Use apify~instagram-scraper (same actor as the app's import/url endpoint)
const apifyRes = await fetch(
  `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: [igUrl],
      resultsType: "posts",
      resultsLimit: 1,
      searchType: "hashtag",
    }),
  }
);

if (!apifyRes.ok) {
  console.log(`  Apify run failed: ${apifyRes.status} ${(await apifyRes.text()).slice(0, 300)}`);
  process.exit(1);
}

const items = (await apifyRes.json()) as Array<{
  caption?: string;
  ownerUsername?: string;
  displayUrl?: string;
  images?: string[];
  childPosts?: { displayUrl?: string }[];
  [key: string]: unknown;
}>;
console.log(`  Got ${items.length} results from Apify`);

const post = items[0];
if (!post) {
  console.log("  No Instagram post data returned");
  process.exit(1);
}

console.log(`  Caption preview: ${(post.caption ?? "").slice(0, 200)}...`);
console.log(`  Image URL: ${(post.displayUrl ?? post.images?.[0] ?? "none").slice(0, 80)}`);

// Parse the Instagram caption into recipe data
// Instagram recipe posts typically have ingredients and instructions in the caption
const caption = post.caption ?? "";
const imageUrl = post.displayUrl ?? post.images?.[0] ?? "";

// Try to extract recipe from caption text
const lines = caption.split("\n").map((l: string) => l.trim()).filter((l: string) => l);

// Find ingredients section and instructions section
let inIngredients = false;
let inInstructions = false;
const ingredients: { amount: string; unit: string; name: string }[] = [];
const steps: string[] = [];
let description = "";

for (const line of lines) {
  const lower = line.toLowerCase();
  if (lower.includes("ingredient")) { inIngredients = true; inInstructions = false; continue; }
  if (lower.includes("instruction") || lower.includes("direction") || lower.includes("method") || lower.includes("steps")) {
    inIngredients = false; inInstructions = true; continue;
  }

  if (inIngredients && line.length > 2) {
    // Try to parse "amount unit name" pattern
    const match = line.replace(/^[-•·▪️🔸]\s*/, "").match(/^([\d/½¼¾⅓⅔]+(?:\s*[-–]\s*[\d/½¼¾⅓⅔]+)?)\s*(tbsp|tsp|cup|cups|oz|lb|lbs|tablespoons?|teaspoons?|pound|pounds|can|cloves?|stalks?|inch|inches)?\s*(.+)/i);
    if (match) {
      ingredients.push({ amount: match[1]!, unit: match[2] ?? "", name: match[3]!.trim() });
    } else {
      ingredients.push({ amount: "", unit: "", name: line.replace(/^[-•·▪️🔸]\s*/, "").trim() });
    }
  }

  if (inInstructions && line.length > 5) {
    steps.push(line.replace(/^\d+[.)]\s*/, "").replace(/^[-•·▪️🔸]\s*/, "").trim());
  }
}

// First non-empty lines before any section header = description
if (!description && lines.length > 0) {
  const descLines: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("ingredient") || lower.includes("instruction") || lower.includes("recipe")) break;
    if (line.length > 10) descLines.push(line);
    if (descLines.length >= 2) break;
  }
  description = descLines.join(" ").slice(0, 300);
}

console.log(`\n  Parsed: ${ingredients.length} ingredients, ${steps.length} steps`);
console.log(`  Description: ${description.slice(0, 100)}...`);

if (ingredients.length > 0 || steps.length > 0) {
  const existing = await getRecipe("r_2c5af527") as Record<string, unknown>;
  const now = new Date().toISOString();

  let photo: string | null = null;
  if (imageUrl) {
    photo = await downloadAndUploadPhoto(imageUrl, "r_2c5af527");
  }

  const salmonData: Record<string, unknown> = {
    title: "Baked Salmon with Cranberry Orange Glaze",
    sourceUrl: igUrl,
  };
  if (description) salmonData.description = description;
  if (ingredients.length > 0) salmonData.ingredients = ingredients;
  if (steps.length > 0) salmonData.steps = steps;

  const merged = {
    ...existing,
    ...salmonData,
    thumbnailUrl: photo ?? existing.thumbnailUrl,
    updatedAt: now,
    lastCrawledAt: now,
  };

  const ok = await putRecipe("r_2c5af527", merged);
  console.log(`  ${ok ? "✓" : "✗"} r_2c5af527`);
} else {
  console.log("  Could not parse recipe from Instagram caption. Raw caption:");
  console.log(caption.slice(0, 500));
  console.log("\n  Updating with source URL and photo only...");

  const existing = await getRecipe("r_2c5af527") as Record<string, unknown>;
  const now = new Date().toISOString();
  let photo: string | null = null;
  if (imageUrl) photo = await downloadAndUploadPhoto(imageUrl, "r_2c5af527");

  const merged = {
    ...existing,
    title: existing.title || "Baked Salmon with Cranberry Orange Glaze",
    sourceUrl: igUrl,
    thumbnailUrl: photo ?? existing.thumbnailUrl,
    updatedAt: now,
    lastCrawledAt: now,
  };
  const ok = await putRecipe("r_2c5af527", merged);
  console.log(`  ${ok ? "✓" : "✗"} r_2c5af527 (photo + source URL only)`);
}

console.log("\nDone! Run rebuild-index.ts next to update the index.");
