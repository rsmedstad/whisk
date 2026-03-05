// Add 5 Old Fashioned cocktail recipes from @itscocktailhour_ Instagram post
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

// Upload cover photo to R2 for each recipe
async function uploadPhoto(localPath: string, recipeId: string): Promise<string | null> {
  try {
    const file = Bun.file(localPath);
    const body = await file.arrayBuffer();
    const filename = `import-${recipeId}.jpg`;
    const uploadRes = await fetch(`${r2Base}/${filename}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "image/jpeg" },
      body,
    });
    if (uploadRes.ok) {
      console.log(`  Uploaded photo: /photos/${filename}`);
      return `/photos/${filename}`;
    }
    console.log(`  Photo upload failed: ${uploadRes.status}`);
    return null;
  } catch (e) {
    console.log(`  Photo failed: ${(e as Error).message}`);
    return null;
  }
}

const now = new Date().toISOString();
const sourceUrl = "https://www.instagram.com/p/DVL_nliAN0c/";
const baseTags = ["drinks", "american"];
const photoPath = "./photos/old-fashioned-cover.jpg";

const recipes = [
  {
    id: "smores-of",
    title: "S'mores Old Fashioned",
    description: "A campfire-inspired twist on the classic Old Fashioned with marshmallow syrup, vanilla, and chocolate bitters.",
    ingredients: [
      { amount: "2", unit: "oz", name: "bourbon" },
      { amount: "1/4", unit: "oz", name: "marshmallow syrup" },
      { amount: "1/6", unit: "oz", name: "vanilla extract (1 bar spoon)" },
      { amount: "2-3", unit: "", name: "dashes chocolate bitters" },
    ],
    steps: [
      { text: "Add bourbon, marshmallow syrup, vanilla extract, and chocolate bitters to a mixing glass with ice." },
      { text: "Stir until well chilled, about 30 seconds." },
      { text: "Strain into a rocks glass over a large ice cube." },
      { text: "Garnish as desired." },
    ],
  },
  {
    id: "banana-bread-of",
    title: "Banana Bread Old Fashioned",
    description: "A cozy, dessert-forward Old Fashioned featuring banana liqueur, Frangelico, pecan bitters, and brown sugar.",
    ingredients: [
      { amount: "2", unit: "oz", name: "bourbon" },
      { amount: "3/4", unit: "oz", name: "banana liqueur" },
      { amount: "1/2", unit: "oz", name: "Frangelico" },
      { amount: "3", unit: "", name: "dashes pecan bitters" },
      { amount: "1", unit: "tsp", name: "brown sugar" },
    ],
    steps: [
      { text: "Muddle brown sugar with pecan bitters in a rocks glass." },
      { text: "Add bourbon, banana liqueur, and Frangelico." },
      { text: "Add a large ice cube and stir until well chilled." },
      { text: "Garnish as desired." },
    ],
  },
  {
    id: "maple-ginger-of",
    title: "Maple Ginger Old Fashioned",
    description: "A warm, spiced Old Fashioned with maple syrup, orange and cinnamon bitters, topped with a splash of ginger beer.",
    ingredients: [
      { amount: "2", unit: "oz", name: "bourbon" },
      { amount: "3/4", unit: "oz", name: "maple syrup" },
      { amount: "2", unit: "", name: "dashes orange bitters" },
      { amount: "1", unit: "", name: "dash cinnamon bitters" },
      { amount: "", unit: "", name: "splash of ginger beer" },
    ],
    steps: [
      { text: "Add bourbon, maple syrup, orange bitters, and cinnamon bitters to a mixing glass with ice." },
      { text: "Stir until well chilled, about 30 seconds." },
      { text: "Strain into a rocks glass over a large ice cube." },
      { text: "Top with a splash of ginger beer." },
    ],
  },
  {
    id: "belgian-waffle-of",
    title: "Belgian Waffle Old Fashioned",
    description: "A brunch-worthy Old Fashioned with brown butter bourbon, Frangelico, maple syrup, vanilla, and aromatic bitters.",
    ingredients: [
      { amount: "2", unit: "oz", name: "brown butter bourbon" },
      { amount: "1/4", unit: "oz", name: "Frangelico" },
      { amount: "1/2", unit: "oz", name: "maple syrup" },
      { amount: "1/4", unit: "tsp", name: "vanilla extract" },
      { amount: "2-3", unit: "", name: "dashes aromatic bitters" },
    ],
    steps: [
      { text: "Add brown butter bourbon, Frangelico, maple syrup, vanilla extract, and aromatic bitters to a mixing glass with ice." },
      { text: "Stir until well chilled, about 30 seconds." },
      { text: "Strain into a rocks glass over a large ice cube." },
      { text: "Garnish as desired." },
    ],
  },
  {
    id: "red-wine-of",
    title: "Red Wine Old Fashioned",
    description: "A rich, vinous Old Fashioned featuring homemade red wine syrup with cinnamon and cloves, paired with chocolate bitters.",
    ingredients: [
      { amount: "2", unit: "oz", name: "bourbon" },
      { amount: "3/4", unit: "oz", name: "red wine syrup (see notes)" },
      { amount: "3", unit: "", name: "dashes chocolate bitters" },
    ],
    steps: [
      { text: "Add bourbon, red wine syrup, and chocolate bitters to a mixing glass with ice." },
      { text: "Stir until well chilled, about 30 seconds." },
      { text: "Strain into a rocks glass over a large ice cube." },
      { text: "Garnish as desired." },
    ],
    notes: "Red wine syrup: Combine 1 cup red wine, 1 cup brown sugar, 3 cinnamon sticks, and 2 cloves in a saucepan. Bring to a boil, stir to combine, then let cool. Strain before using.",
  },
];

for (const r of recipes) {
  console.log(`Creating: ${r.title}`);

  // Upload photo
  const thumbnailUrl = await uploadPhoto(photoPath, r.id);

  const recipe = {
    id: `r_${r.id}`,
    title: r.title,
    description: r.description,
    ingredients: r.ingredients,
    steps: r.steps,
    tags: [...baseTags],
    sourceUrl,
    servings: 1,
    prepTime: 5,
    cookTime: 0,
    thumbnailUrl,
    photos: thumbnailUrl ? [thumbnailUrl] : [],
    notes: (r as any).notes ?? "",
    favorite: false,
    cookedCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const res = await fetch(`${kvBase}/values/${encodeURIComponent(`recipe:${recipe.id}`)}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(recipe),
  });

  console.log(`  ${res.ok ? "OK" : "FAILED"} (${res.status})`);
}

console.log("\nDone! Now run: bun scripts/rebuild-index.ts");
