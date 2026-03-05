// Update recipes with missing data (scraped from source URLs)
// Uses Cloudflare Browser Rendering for JS-heavy sites
const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";
const R2_BUCKET = "whisk-photos";
const CF_BR_TOKEN = "bTGYbQr7uEL2rHeqkkntkvFL-kdfKVn7WlhJx7RA";

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

const updates: { id: string; data: Record<string, unknown>; imageUrl?: string }[] = [
  // Shredded Chicken Tacos
  {
    id: "r_24d84493",
    imageUrl: "https://therecipecritic.com/wp-content/uploads/2022/11/shredded-chicken-tacos-2.jpg",
    data: {
      title: "Shredded Chicken Tacos",
      description: "Shredded chicken tacos with perfectly seasoned chicken, salsa, and lime juice, ready in just 10 minutes.",
      sourceUrl: "https://therecipecritic.com/shredded-chicken-tacos/",
      ingredients: [
        { amount: "4", unit: "cups", name: "boneless skinless chicken breasts, cooked and shredded" },
        { amount: "2", unit: "tbsp", name: "olive oil" },
        { amount: "1", unit: "tsp", name: "garlic, minced" },
        { amount: "2", unit: "tsp", name: "onion powder" },
        { amount: "2", unit: "tsp", name: "chili powder" },
        { amount: "1", unit: "tsp", name: "cumin" },
        { amount: "1/2", unit: "tsp", name: "kosher salt" },
        { amount: "1", unit: "cup", name: "chunky salsa or salsa verde" },
        { amount: "1/4", unit: "cup", name: "chicken broth" },
        { amount: "", unit: "", name: "flour tortillas" },
        { amount: "1", unit: "", name: "lime, juiced" },
      ],
      steps: [
        "Heat olive oil in a large skillet and saute minced garlic for 30 seconds.",
        "Add shredded chicken, onion powder, cumin, chili powder, and salt. Cook for 1 minute.",
        "Stir in salsa, chicken broth, and lime juice.",
        "Heat through for about 5 minutes, stirring occasionally. Season with additional salt if needed.",
        "Serve in warm tortillas with your favorite toppings.",
      ],
      prepTime: 10,
      cookTime: 5,
      servings: 6,
      tags: ["dinner", "mexican"],
    },
  },
  // Chicken Caesar Pasta Salad
  {
    id: "r_4678251f",
    imageUrl: "https://www.justataste.com/wp-content/uploads/2019/03/chicken-caesar-pasta-salad-recipe.jpg",
    data: {
      title: "Chicken Caesar Pasta Salad",
      description: "A refreshing 20-minute meal with pasta, romaine lettuce, rotisserie chicken, and a homemade Caesar dressing.",
      sourceUrl: "https://www.justataste.com/chicken-caesar-pasta-salad-recipe/",
      ingredients: [
        { amount: "2", unit: "tsp", name: "Dijon mustard" },
        { amount: "2", unit: "tbsp", name: "fresh lemon juice" },
        { amount: "2", unit: "tsp", name: "Worcestershire sauce" },
        { amount: "3/4", unit: "cup", name: "mayonnaise" },
        { amount: "2", unit: "tsp", name: "minced garlic" },
        { amount: "1", unit: "tsp", name: "anchovy paste" },
        { amount: "1/3", unit: "cup", name: "finely grated Parmesan cheese" },
        { amount: "8", unit: "oz", name: "uncooked pasta (rotini or penne)" },
        { amount: "2", unit: "", name: "hearts of Romaine lettuce, chopped" },
        { amount: "", unit: "", name: "shredded rotisserie chicken" },
        { amount: "", unit: "", name: "croutons (optional)" },
        { amount: "", unit: "", name: "Parmesan cheese for serving" },
      ],
      steps: [
        "Whisk together Dijon mustard, lemon juice, Worcestershire sauce, mayonnaise, minced garlic, and anchovy paste until well combined. Stir in grated Parmesan cheese and pepper.",
        "Bring a large pot of salted water to a boil and cook pasta until al dente, about 10 minutes. Drain and transfer to a large serving bowl.",
        "Cut Romaine hearts into 1-inch pieces and add to the bowl with the pasta along with the chicken.",
        "Add the dressing and toss to combine. Top with croutons if desired and garnish with Parmesan cheese.",
      ],
      prepTime: 10,
      cookTime: 10,
      servings: 6,
      tags: ["dinner", "salad", "pasta"],
    },
  },
  // Steak Fajitas w/ Onions & Peppers
  {
    id: "r_7acf9555",
    imageUrl: "https://addapinch.com/wp-content/uploads/2016/08/steak-fajitas-recipe-addapinch-1245.jpg",
    data: {
      title: "Steak Fajitas w/ Onions & Peppers",
      description: "Quick and easy steak fajitas with marinated beef, peppers, and onions served with warm tortillas.",
      sourceUrl: "https://addapinch.com/steak-fajitas-recipe/",
      ingredients: [
        { amount: "2", unit: "lb", name: "skirt or flank steak, sliced into 1/2-inch strips" },
        { amount: "1", unit: "", name: "red bell pepper, sliced into thin strips" },
        { amount: "1", unit: "", name: "green bell pepper, sliced into thin strips" },
        { amount: "1", unit: "", name: "medium onion, sliced into thin strips" },
        { amount: "3", unit: "tbsp", name: "olive oil" },
        { amount: "1", unit: "tbsp", name: "lime juice" },
        { amount: "1/2", unit: "tsp", name: "chili powder" },
        { amount: "1", unit: "tsp", name: "ground cumin" },
        { amount: "1", unit: "pinch", name: "cayenne pepper" },
        { amount: "1/2", unit: "tsp", name: "kosher salt" },
        { amount: "1/2", unit: "tsp", name: "ground black pepper" },
        { amount: "2", unit: "cloves", name: "garlic, minced" },
        { amount: "6", unit: "", name: "tortillas" },
        { amount: "", unit: "", name: "sour cream, guacamole, salsa for serving" },
      ],
      steps: [
        "Place steak in a sealable bag and peppers and onion in another. Combine olive oil, lime juice, chili powder, cumin, cayenne, salt, pepper, and garlic in a jar. Shake well and divide among bags. Refrigerate 1 hour to overnight.",
        "Heat a large skillet over medium-high heat. Cook vegetables until tender-crisp, about 5 minutes. Remove to a plate.",
        "Cook steak strips in the same skillet for 7-10 minutes until done to your liking.",
        "Return vegetables to the skillet with any reserved marinade. Serve with warm tortillas and desired toppings.",
      ],
      prepTime: 10,
      cookTime: 15,
      servings: 6,
      tags: ["dinner", "mexican"],
    },
  },
];

// Scrape remaining recipes via Cloudflare Browser Rendering + JSON-LD extraction
interface RecipeData {
  name?: string;
  description?: string;
  image?: unknown;
  recipeIngredient?: string[];
  recipeInstructions?: unknown[];
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  recipeYield?: string | string[];
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#8217;/g, "'").replace(/&#8211;/g, "-")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/\s+/g, " ").trim();
}

function extractJsonLd(html: string): RecipeData | null {
  const matches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (!matches) return null;
  for (const m of matches) {
    try {
      const json = m.replace(/<script[^>]*>|<\/script>/gi, "");
      const parsed = JSON.parse(json);
      const found = findRecipe(parsed);
      if (found) return found as RecipeData;
    } catch { continue; }
  }
  return null;
}

function findRecipe(data: unknown): unknown | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) { const f = findRecipe(item); if (f) return f; }
    return null;
  }
  const obj = data as Record<string, unknown>;
  const type = obj["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return obj;
  if (Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"] as unknown[]) { const f = findRecipe(item); if (f) return f; }
  }
  return null;
}

function parseDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return undefined;
  return (parseInt(m[1] ?? "0") * 60 + parseInt(m[2] ?? "0")) || undefined;
}

function parseIngredient(str: string): { amount: string; unit: string; name: string } {
  const m = str.match(
    /^([\d\s/½⅓⅔¼¾⅛⅜⅝⅞.]+)\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|cloves?|cans?|stalks?|pinche?s?|dashes?|pieces?|slices?|sticks?|heads?|sprigs?|bunche?s?|packages?)?\s+(.+)/i
  );
  if (m) return { amount: m[1]!.trim(), unit: (m[2] ?? "").trim(), name: m[3]!.trim() };
  return { amount: "", unit: "", name: str.trim() };
}

function extractImageUrl(img: unknown): string | undefined {
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return typeof img[0] === "string" ? img[0] : (img[0] as Record<string, string>)?.url;
  if (typeof img === "object" && img !== null) return (img as Record<string, string>).url;
  return undefined;
}

async function scrapeWithBrowserRendering(url: string): Promise<{ data: Record<string, unknown>; imageUrl?: string } | null> {
  console.log(`  Fetching via Browser Rendering: ${url}`);
  const brRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/content`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CF_BR_TOKEN}` },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: "networkidle2", timeout: 25000 },
        rejectResourceTypes: ["font", "media"],
      }),
    }
  );
  if (!brRes.ok) { console.log(`  Browser Rendering failed: ${brRes.status}`); return null; }

  let html = await brRes.text();
  if (html.startsWith("{")) {
    html = (JSON.parse(html) as { result?: string }).result ?? "";
  }
  if (html.length < 500) { console.log(`  HTML too short (${html.length} chars)`); return null; }

  const recipe = extractJsonLd(html);
  if (!recipe) { console.log("  No JSON-LD recipe data found"); return null; }

  console.log(`  Found recipe: ${recipe.name}`);
  const imageUrl = extractImageUrl(recipe.image);

  const ingredients = (recipe.recipeIngredient ?? []).map((s) => parseIngredient(stripHtml(s)));

  const steps: string[] = [];
  for (const step of recipe.recipeInstructions ?? []) {
    if (typeof step === "string") steps.push(stripHtml(step));
    else if (typeof step === "object" && step !== null) {
      const s = step as Record<string, unknown>;
      steps.push(stripHtml((s.text as string) ?? (s.name as string) ?? ""));
    }
  }

  const servingsRaw = Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield;

  return {
    imageUrl,
    data: {
      title: recipe.name ? stripHtml(recipe.name) : undefined,
      description: recipe.description ? stripHtml(recipe.description) : undefined,
      sourceUrl: url,
      ingredients,
      steps: steps.filter(Boolean),
      prepTime: parseDuration(recipe.prepTime) ?? parseDuration(recipe.totalTime),
      cookTime: parseDuration(recipe.cookTime),
      servings: parseInt(servingsRaw ?? "0") || undefined,
    },
  };
}

// Scrape the two remaining recipes via Browser Rendering
const browserRecipes = [
  { id: "r_df800052", url: "https://www.savorynothings.com/steak-and-potato-sheet-pan-dinner/", tags: ["dinner"] },
  { id: "r_e04c2bac", url: "https://www.chilipeppermadness.com/recipes/stuffed-peppers/", tags: ["dinner"] },
];

for (const br of browserRecipes) {
  const scraped = await scrapeWithBrowserRendering(br.url);
  if (scraped) {
    updates.push({
      id: br.id,
      imageUrl: scraped.imageUrl,
      data: { ...scraped.data, tags: br.tags },
    });
  } else {
    console.log(`  Skipping ${br.id} — could not scrape`);
  }
}

for (const update of updates) {
  console.log(`\nUpdating ${update.id}: ${(update.data.title as string) ?? "(adding data)"}...`);

  const existing = await getRecipe(update.id) as Record<string, unknown>;
  const now = new Date().toISOString();

  let thumbnailUrl = existing.thumbnailUrl as string | undefined;
  if (update.imageUrl) {
    const uploaded = await downloadAndUploadPhoto(update.imageUrl, update.id);
    if (uploaded) thumbnailUrl = uploaded;
  }

  const merged = {
    ...existing,
    ...update.data,
    thumbnailUrl: thumbnailUrl ?? existing.thumbnailUrl,
    updatedAt: now,
    lastCrawledAt: update.data.sourceUrl ? now : existing.lastCrawledAt,
  };

  const ok = await putRecipe(update.id, merged);
  console.log(`  ${ok ? "Done" : "FAILED"} ${update.id}`);
}

console.log("\nDone! Run rebuild-index.ts next to update the index.");
