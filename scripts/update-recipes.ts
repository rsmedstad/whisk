// Update blank/placeholder recipes with scraped data and download images
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

    // Upload to R2 via Cloudflare API
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
  {
    id: "r_21fc113d",
    imageUrl: "https://i0.wp.com/smittenkitchen.com/wp-content/uploads//2014/10/carrot-salad-with-tahini-and-crisped-chickpeas1.jpg?fit=640%2C427&ssl=1",
    data: {
      title: "Carrot Salad with Tahini and Crisped Chickpeas",
      description: "A vibrant salad combining grated carrots with a lemony tahini dressing, topped with roasted cumin-seasoned chickpeas and salted pistachios.",
      sourceUrl: "https://smittenkitchen.com/2014/05/carrot-salad-with-tahini-and-crisped-chickpeas",
      ingredients: [
        { amount: "1 3/4", unit: "cups", name: "cooked chickpeas (or 1 15-oz can, drained and patted dry)" },
        { amount: "1", unit: "tbsp", name: "olive oil (for chickpeas)" },
        { amount: "1/2", unit: "tsp", name: "coarse sea salt" },
        { amount: "1/4", unit: "tsp", name: "ground cumin" },
        { amount: "1", unit: "lb", name: "carrots, peeled and coarsely grated" },
        { amount: "1/4", unit: "cup", name: "coarsely chopped parsley" },
        { amount: "1/4", unit: "cup", name: "shelled salted pistachios, coarsely chopped" },
        { amount: "1", unit: "", name: "garlic clove, minced" },
        { amount: "1/4", unit: "cup", name: "lemon juice" },
        { amount: "3", unit: "tbsp", name: "well-stirred tahini" },
        { amount: "2", unit: "tbsp", name: "water, plus more if needed" },
        { amount: "2", unit: "tbsp", name: "olive oil" },
        { amount: "", unit: "", name: "salt and red pepper flakes to taste" },
      ],
      steps: [
        "Heat oven to 425°F. Toss chickpeas with one tablespoon olive oil, salt and cumin until coated.",
        "Spread chickpeas on baking sheet and roast until browned and crisp, 15-20 minutes, tossing occasionally. Set aside.",
        "Whisk together minced garlic, lemon juice, tahini, water, and olive oil until smooth. Add more water if needed to thin. Taste and adjust seasoning.",
        "Place grated carrots in large bowl and toss with parsley. Mix in 2/3 of the dressing, adding more if desired.",
        "Add more salt and pepper if needed. Sprinkle with chickpeas and pistachios before serving.",
        "Store salad in refrigerator for up to two days, but add chickpeas and pistachios right before serving to maintain crispness.",
      ],
      prepTime: 15,
      cookTime: 20,
      servings: 4,
      tags: ["lunch", "salad", "side dish"],
    },
  },
  {
    id: "r_6e131cfc",
    imageUrl: "https://www.justataste.com/wp-content/uploads/2018/04/beef-broccoli-sauce-1.jpg",
    data: {
      title: "Easy Beef and Broccoli",
      description: "Skip the takeout and whip up a fast and fresh beef and broccoli in 20 minutes or less.",
      sourceUrl: "https://www.justataste.com/easy-beef-and-broccoli-recipe/",
      ingredients: [
        { amount: "3", unit: "tbsp", name: "cornstarch, divided" },
        { amount: "1", unit: "lb", name: "flank steak, cut into thin 1-inch pieces" },
        { amount: "1/2", unit: "cup", name: "low sodium soy sauce" },
        { amount: "3", unit: "tbsp", name: "packed light brown sugar" },
        { amount: "1", unit: "tbsp", name: "minced garlic" },
        { amount: "2", unit: "tsp", name: "grated fresh ginger" },
        { amount: "2", unit: "tbsp", name: "vegetable oil, divided" },
        { amount: "4", unit: "cups", name: "small broccoli florets" },
        { amount: "1/2", unit: "cup", name: "sliced white onions" },
      ],
      steps: [
        "Whisk together 2 tablespoons cornstarch with 3 tablespoons water. Add the beef and toss to combine.",
        "In a separate bowl, whisk together remaining 1 tablespoon cornstarch with soy sauce, brown sugar, garlic, and ginger. Set sauce aside.",
        "Heat a large nonstick pan over medium heat. Add 1 tablespoon oil, then add the beef and cook, stirring constantly, until almost cooked through. Transfer beef to a plate.",
        "Add remaining 1 tablespoon oil, then add broccoli and onions. Cook, stirring occasionally, until broccoli is tender, about 4 minutes.",
        "Return beef to pan, add prepared sauce. Bring to a boil and cook, stirring, for 1 minute until sauce thickens. Serve with rice or noodles.",
      ],
      prepTime: 10,
      cookTime: 10,
      servings: 4,
      tags: ["dinner"],
    },
  },
  {
    id: "r_89e234e4",
    imageUrl: "https://cdn.momsdish.com/wp-content/uploads/2021/04/Chicken-Quesadillas012-scaled.jpg",
    data: {
      title: "Chicken Quesadillas",
      description: "Easy chicken quesadillas with veggies, seasoned chicken, and melted cheese.",
      sourceUrl: "https://momsdish.com/chicken-quesadillas",
      ingredients: [
        { amount: "1", unit: "tbsp", name: "oil" },
        { amount: "1", unit: "lb", name: "chicken breast, cut into small pieces" },
        { amount: "1", unit: "tbsp", name: "taco seasoning" },
        { amount: "1/2", unit: "", name: "bell pepper, diced" },
        { amount: "1/2", unit: "", name: "yellow onion, diced" },
        { amount: "2", unit: "tbsp", name: "unsalted butter" },
        { amount: "6", unit: "", name: "flour tortillas" },
        { amount: "2", unit: "cups", name: "Mexican cheese" },
      ],
      steps: [
        "Preheat a skillet with oil on medium heat. Add chicken and taco seasoning. Cook for 4 minutes.",
        "Add bell pepper and onion, cook for another 5 minutes until chicken and veggies are cooked through. Set aside.",
        "On a clean skillet, add butter and place a tortilla on top. Add cheese and chicken mixture to one half. Top with more cheese and fold the tortilla over.",
        "Cook until golden on one side, then flip and cook until golden on the other side and cheese is melted. Repeat with remaining tortillas.",
        "Serve warm with salsa, sour cream, or guacamole.",
      ],
      prepTime: 10,
      cookTime: 20,
      servings: 6,
      tags: ["dinner"],
    },
  },
  {
    id: "r_01762991",
    imageUrl: "https://christieathome.com/wp-content/uploads/2021/07/Egg-Fried-Rice-5.jpg",
    data: {
      title: "Egg Fried Rice",
      description: "A simple 10-minute fried rice made with just 6 ingredients including eggs, soy sauce, and sesame oil.",
      sourceUrl: "https://christieathome.com/blog/egg-fried-rice/",
      ingredients: [
        { amount: "3", unit: "cups", name: "cooked rice (day-old, chilled)" },
        { amount: "3", unit: "", name: "large eggs" },
        { amount: "3", unit: "tbsp", name: "soy sauce" },
        { amount: "1", unit: "tbsp", name: "sesame oil" },
        { amount: "3", unit: "stalks", name: "green onions, chopped" },
        { amount: "2", unit: "tbsp", name: "vegetable oil" },
      ],
      steps: [
        "Heat vegetable oil in a large pan or wok over medium-high heat.",
        "Scramble eggs in the pan until cooked through, then remove and set aside.",
        "Add rice to the pan, breaking up clumps, and stir-fry for 2-3 minutes.",
        "Return eggs to the pan and add soy sauce and sesame oil.",
        "Toss everything together until well combined and heated through.",
        "Top with chopped green onions and serve immediately.",
      ],
      prepTime: 5,
      cookTime: 5,
      servings: 4,
      tags: ["dinner", "side dish"],
    },
  },
  {
    id: "r_25bc105a",
    imageUrl: "https://images.prismic.io/jewishfoodsociety/a507f5a5-61f2-475d-a611-738e06201515_Moroccan_Harira_0121.jp2?auto=compress,format",
    data: {
      title: "Moroccan Harira Soup",
      description: "A hearty Moroccan soup with chickpeas and lentils with warm spices including turmeric, harissa, and lemon.",
      sourceUrl: "https://www.jewishfoodsociety.org/recipes/moroccan-harira-soup",
      ingredients: [
        { amount: "4", unit: "tbsp", name: "olive oil" },
        { amount: "1", unit: "", name: "yellow onion, finely diced" },
        { amount: "2", unit: "", name: "carrots, finely diced" },
        { amount: "2", unit: "stalks", name: "celery, finely diced" },
        { amount: "2", unit: "cloves", name: "garlic, finely diced" },
        { amount: "1/2", unit: "tsp", name: "ground turmeric" },
        { amount: "1", unit: "tsp", name: "ground cumin" },
        { amount: "1", unit: "tsp", name: "kosher salt, plus more to taste" },
        { amount: "1/2", unit: "tsp", name: "harissa (optional)" },
        { amount: "1", unit: "", name: "large tomato, diced" },
        { amount: "1", unit: "can (15 oz)", name: "chickpeas, drained and rinsed" },
        { amount: "1", unit: "cup", name: "green lentils" },
        { amount: "7", unit: "cups", name: "chicken or vegetable stock" },
        { amount: "1", unit: "tsp", name: "freshly ground black pepper" },
        { amount: "1 1/2", unit: "tbsp", name: "all-purpose flour" },
        { amount: "3", unit: "tbsp", name: "lemon juice (about 1 large lemon)" },
        { amount: "1", unit: "cup", name: "water" },
        { amount: "1", unit: "cup", name: "chopped fresh cilantro" },
      ],
      steps: [
        "Heat oil in a large Dutch oven over medium heat. Sauté onion, celery, and carrots until translucent, 5-10 minutes.",
        "Stir in turmeric, cumin, garlic, salt, and harissa. Cook 30 seconds until fragrant, then add tomatoes and stock. Bring to a boil.",
        "Add lentils and chickpeas, reduce heat to medium-low, and simmer until lentils are tender, about 20 minutes. Season with salt and pepper.",
        "Whisk flour, lemon juice, and water together. Stir into soup and simmer 5 minutes. Serve with fresh cilantro.",
      ],
      prepTime: 15,
      cookTime: 30,
      servings: 8,
      tags: ["dinner", "soup"],
    },
  },
  // Glazed Apple Cider Doughnut Cake - just add sourceUrl
  {
    id: "r_e422217b",
    data: {
      sourceUrl: "https://smittenkitchen.com/2024/10/glazed-apple-cider-doughnut-cake/",
    },
  },
];

for (const update of updates) {
  console.log(`\nUpdating ${update.id}: ${(update.data.title as string) ?? "(adding source URL)"}...`);

  // Get existing recipe
  const existing = await getRecipe(update.id) as Record<string, unknown>;
  const now = new Date().toISOString();

  // Download and upload photo if provided
  let thumbnailUrl = existing.thumbnailUrl as string | undefined;
  if (update.imageUrl) {
    const uploaded = await downloadAndUploadPhoto(update.imageUrl, update.id);
    if (uploaded) thumbnailUrl = uploaded;
  }

  // Merge: update fields overwrite existing, preserve id/createdAt/favoritedBy
  const merged = {
    ...existing,
    ...update.data,
    thumbnailUrl: thumbnailUrl ?? existing.thumbnailUrl,
    updatedAt: now,
    lastCrawledAt: update.data.sourceUrl ? now : existing.lastCrawledAt,
  };

  const ok = await putRecipe(update.id, merged);
  console.log(`  ${ok ? "✓" : "✗"} ${update.id}`);
}

console.log("\nDone! Run rebuild-index.ts next to update the index.");
