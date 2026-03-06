import {
  loadAIConfig,
  resolveConfig,
  callTextAI,
  type ProviderEnv,
} from "../../lib/ai-providers";

interface Env extends ProviderEnv {
  WHISK_KV: KVNamespace;
  UNSPLASH_ACCESS_KEY?: string;
}

interface IdeaRaw {
  title: string;
  description: string;
  emoji?: string;
}

interface IdeaWithPhoto extends IdeaRaw {
  searchTerm: string;
  imageUrl?: string;
  photographer?: string;
  photographerUrl?: string;
}

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 1 week

// GET /api/discover/ideas — Generate recipe ideas with optional Unsplash photos
// Supports two filter dimensions: mealType (all/dinner/drinks/desserts) + vibe (seasonal/quick/trending/comfort/healthy)
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const mealType = url.searchParams.get("mealType") ?? "all";
  const vibe = url.searchParams.get("vibe") ?? "seasonal";
  const season = url.searchParams.get("season") ?? "spring";
  const refresh = url.searchParams.get("refresh") === "1";

  // Legacy support: if "category" is passed, treat it as vibe
  const legacyCategory = url.searchParams.get("category");
  const effectiveVibe = legacyCategory ?? vibe;

  const cacheKey = `discover_ideas:${mealType}:${effectiveVibe}:${season}`;
  if (!refresh) {
    const cached = await env.WHISK_KV.get(cacheKey, "text");
    if (cached) {
      return new Response(cached, {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const config = await loadAIConfig(env.WHISK_KV);
  const fnConfig = resolveConfig(config, "chat", env);

  let ideas: IdeaRaw[];
  if (fnConfig) {
    ideas = await generateAIIdeas(fnConfig, env, mealType, effectiveVibe, season);
  } else {
    ideas = getFallbackIdeas(mealType, effectiveVibe, season);
  }

  const ideasWithPhotos = await attachUnsplashPhotos(ideas, env);

  const result = JSON.stringify({ ideas: ideasWithPhotos, mealType, vibe: effectiveVibe, season });

  if (ideasWithPhotos.length > 0) {
    await env.WHISK_KV.put(cacheKey, result, {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  }

  return new Response(result, {
    headers: { "Content-Type": "application/json" },
  });
};

function buildPrompt(mealType: string, vibe: string, season: string): string {
  // Meal type qualifiers
  const mealDescriptions: Record<string, string> = {
    all: "recipe",
    dinner: "dinner",
    drinks: "cocktail or drink",
    desserts: "dessert",
  };
  const mealDesc = mealDescriptions[mealType] ?? "recipe";

  // Vibe qualifiers
  const vibeDescriptions: Record<string, string> = {
    seasonal: `perfect for ${season}, using seasonal ingredients and techniques`,
    quick: "quick and easy (under 30 minutes)",
    trending: "trending and popular right now among food lovers",
    comfort: "comforting, hearty, and cozy",
    healthy: "healthy and nutritious, focusing on whole foods",
  };
  const vibeDesc = vibeDescriptions[vibe] ?? vibeDescriptions["seasonal"]!;

  return `Suggest 8 ${mealDesc} ideas that are ${vibeDesc}. For each, give a short appetizing name (3-5 words max) and a one-sentence description.`;
}

async function generateAIIdeas(
  fnConfig: { provider: string; model: string },
  env: ProviderEnv,
  mealType: string,
  vibe: string,
  season: string
): Promise<IdeaRaw[]> {
  const prompt = buildPrompt(mealType, vibe, season);

  try {
    const content = await callTextAI(fnConfig, env, [
      {
        role: "system",
        content:
          'You are a creative chef suggesting recipe ideas. Respond with ONLY a JSON array. Each item has: "title" (short name), "description" (one sentence), "searchTerm" (2-3 word food photography search term for finding a photo, e.g. "roasted chicken" or "pasta carbonara"). Example: [{"title":"Lemon Herb Chicken","description":"Bright and zesty roasted chicken with fresh herbs.","searchTerm":"herb roasted chicken"}]',
      },
      { role: "user", content: prompt },
    ], { maxTokens: 1024, temperature: 0.8, jsonMode: true });

    let jsonStr = content.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    const ideas = Array.isArray(parsed)
      ? parsed
      : parsed.ideas ?? parsed.recipes ?? parsed.suggestions ?? Object.values(parsed)[0] ?? [];
    const result = Array.isArray(ideas) ? ideas as IdeaRaw[] : [];
    return result.length > 0 ? result : getFallbackIdeas(mealType, vibe, season);
  } catch {
    return getFallbackIdeas(mealType, vibe, season);
  }
}

async function attachUnsplashPhotos(
  ideas: IdeaRaw[],
  env: Env
): Promise<IdeaWithPhoto[]> {
  if (!env.UNSPLASH_ACCESS_KEY) {
    return ideas.map((idea) => ({
      ...idea,
      searchTerm: (idea as IdeaWithPhoto).searchTerm ?? idea.title,
    }));
  }

  const output: IdeaWithPhoto[] = [];
  const BATCH_SIZE = 4;

  for (let i = 0; i < ideas.length; i += BATCH_SIZE) {
    const batch = ideas.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(async (idea) => {
        const searchTerm = (idea as IdeaWithPhoto).searchTerm ?? idea.title;
        try {
          const res = await fetch(
            `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchTerm + " food")}&per_page=1&orientation=landscape`,
            {
              headers: {
                Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
              },
              signal: AbortSignal.timeout(5000),
            }
          );

          if (!res.ok) {
            return { ...idea, searchTerm } as IdeaWithPhoto;
          }

          const data = (await res.json()) as {
            results: {
              urls: { regular: string; small: string };
              user: { name: string; links: { html: string } };
            }[];
          };

          const photo = data.results[0];
          if (!photo) {
            return { ...idea, searchTerm } as IdeaWithPhoto;
          }

          return {
            ...idea,
            searchTerm,
            imageUrl: photo.urls.small,
            photographer: photo.user.name,
            photographerUrl: photo.user.links.html,
          } as IdeaWithPhoto;
        } catch {
          return { ...idea, searchTerm } as IdeaWithPhoto;
        }
      })
    );

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j]!;
      output.push(
        r.status === "fulfilled"
          ? r.value
          : { ...batch[j]!, searchTerm: batch[j]!.title }
      );
    }
  }

  return output;
}

function getFallbackIdeas(mealType: string, _vibe: string, season: string): IdeaRaw[] {
  // Fallback ideas organized by meal type then season
  const fallbacks: Record<string, Record<string, IdeaRaw[]>> = {
    all: {
      spring: [
        { title: "Asparagus Risotto", description: "Creamy rice with fresh spring asparagus." },
        { title: "Strawberry Spinach Salad", description: "Sweet berries with peppery greens." },
        { title: "Lemon Herb Chicken", description: "Bright and zesty roasted chicken." },
        { title: "Spring Pea Soup", description: "Vibrant green soup with fresh mint." },
        { title: "Artichoke Pasta", description: "Light pasta with tender artichoke hearts." },
        { title: "Radish Butter Toast", description: "Crisp radishes on buttered sourdough." },
        { title: "Rhubarb Crumble", description: "Tangy rhubarb under a golden oat topping." },
        { title: "Herb Frittata", description: "Fluffy eggs loaded with fresh spring herbs." },
      ],
      summer: [
        { title: "Grilled Peach Salad", description: "Smoky sweet peaches on fresh greens." },
        { title: "Fish Tacos", description: "Light and crispy with mango salsa." },
        { title: "Watermelon Gazpacho", description: "Refreshing chilled summer soup." },
        { title: "Grilled Corn Salad", description: "Charred corn with lime and cotija." },
        { title: "Caprese Stack", description: "Ripe tomatoes, fresh mozzarella, basil." },
        { title: "Shrimp Skewers", description: "Grilled shrimp with garlic herb butter." },
        { title: "Berry Shortcake", description: "Fluffy biscuits with macerated berries." },
        { title: "Zucchini Noodles", description: "Light veggie noodles with pesto." },
      ],
      fall: [
        { title: "Butternut Squash Soup", description: "Velvety smooth with warm spices." },
        { title: "Apple Cider Pork", description: "Tender pork braised in apple cider." },
        { title: "Pumpkin Pasta", description: "Creamy pumpkin sauce on fresh pasta." },
        { title: "Maple Roasted Vegetables", description: "Caramelized root vegetables." },
        { title: "Mushroom Risotto", description: "Rich and earthy with wild mushrooms." },
        { title: "Stuffed Acorn Squash", description: "Roasted squash with grain filling." },
        { title: "Apple Crisp", description: "Warm spiced apples under a crunchy topping." },
        { title: "Harvest Grain Bowl", description: "Farro with roasted fall vegetables." },
      ],
      winter: [
        { title: "Beef Stew", description: "Hearty slow-cooked comfort in a bowl." },
        { title: "French Onion Soup", description: "Rich broth with melted gruyere." },
        { title: "Citrus Salmon", description: "Pan-seared with winter citrus glaze." },
        { title: "Chicken Pot Pie", description: "Flaky crust over creamy chicken filling." },
        { title: "Braised Short Ribs", description: "Fall-off-the-bone tender with red wine." },
        { title: "Root Vegetable Gratin", description: "Layered roots in creamy sauce." },
        { title: "Gingerbread Cake", description: "Warm spiced cake with molasses." },
        { title: "White Bean Chili", description: "Creamy beans with green chiles." },
      ],
    },
    dinner: {
      spring: [
        { title: "Lemon Herb Chicken", description: "Bright and zesty roasted chicken." },
        { title: "Asparagus Risotto", description: "Creamy rice with fresh spring asparagus." },
        { title: "Spring Lamb Chops", description: "Tender chops with mint pesto." },
        { title: "Pea & Ricotta Pasta", description: "Fresh pasta with sweet spring peas." },
        { title: "Herb-Crusted Salmon", description: "Pan-seared with a dill crust." },
        { title: "Chicken Piccata", description: "Tangy lemon-caper pan sauce." },
        { title: "Veggie Stir Fry", description: "Crisp spring vegetables in ginger sauce." },
        { title: "Stuffed Bell Peppers", description: "Rice and herb filled peppers." },
      ],
      winter: [
        { title: "Beef Stew", description: "Hearty slow-cooked comfort in a bowl." },
        { title: "Chicken Pot Pie", description: "Flaky crust over creamy chicken filling." },
        { title: "Braised Short Ribs", description: "Fall-off-the-bone tender with red wine." },
        { title: "Baked Ziti", description: "Bubbly cheese over hearty pasta." },
        { title: "Citrus Salmon", description: "Pan-seared with winter citrus glaze." },
        { title: "French Onion Soup", description: "Rich broth with melted gruyere." },
        { title: "Shepherd's Pie", description: "Savory filling under mashed potato." },
        { title: "Roast Chicken", description: "Golden crispy skin, juicy inside." },
      ],
    },
    drinks: {
      spring: [
        { title: "Lavender Lemonade", description: "Floral and refreshing spring sipper." },
        { title: "Aperol Spritz", description: "Bubbly, bitter-sweet Italian classic." },
        { title: "Strawberry Basil Smash", description: "Muddled berries with fresh basil." },
        { title: "French 75", description: "Champagne and gin elegance." },
        { title: "Elderflower Collins", description: "Light and floral with sparkling water." },
        { title: "Cucumber Gimlet", description: "Cool and crisp gin cocktail." },
        { title: "Peach Bellini", description: "Prosecco with peach puree." },
        { title: "Mint Julep", description: "Bourbon and fresh mint over ice." },
      ],
      winter: [
        { title: "Hot Toddy", description: "Warm whiskey with honey and lemon." },
        { title: "Mulled Wine", description: "Spiced red wine served warm." },
        { title: "Espresso Martini", description: "Coffee and vodka, shaken cold." },
        { title: "Irish Coffee", description: "Whiskey, coffee, and cream." },
        { title: "Eggnog", description: "Rich and creamy holiday classic." },
        { title: "Spiced Cider", description: "Warm apple cider with cinnamon." },
        { title: "Old Fashioned", description: "Bourbon, bitters, and orange." },
        { title: "Chai Hot Chocolate", description: "Spiced cocoa with warming spices." },
      ],
    },
    desserts: {
      spring: [
        { title: "Rhubarb Crumble", description: "Tangy rhubarb under a golden topping." },
        { title: "Strawberry Shortcake", description: "Fluffy biscuits with fresh berries." },
        { title: "Lemon Tart", description: "Bright citrus in buttery pastry." },
        { title: "Panna Cotta", description: "Silky vanilla cream with berry sauce." },
        { title: "Carrot Cake", description: "Spiced cake with cream cheese frosting." },
        { title: "Pavlova", description: "Crisp meringue with whipped cream and fruit." },
        { title: "Fruit Galette", description: "Rustic free-form fruit pie." },
        { title: "Honey Lavender Ice Cream", description: "Floral and sweet frozen treat." },
      ],
      winter: [
        { title: "Gingerbread Cake", description: "Warm spiced cake with molasses." },
        { title: "Chocolate Lava Cake", description: "Molten center, crisp outside." },
        { title: "Apple Pie", description: "Classic spiced apple filling." },
        { title: "Tiramisu", description: "Coffee-soaked layers with mascarpone." },
        { title: "Creme Brulee", description: "Crackling caramel over custard." },
        { title: "Pear Tarte Tatin", description: "Caramelized upside-down pear tart." },
        { title: "Bread Pudding", description: "Warm custard-soaked bread with raisins." },
        { title: "Sticky Toffee Pudding", description: "Rich date cake with toffee sauce." },
      ],
    },
  };

  const mealFallbacks = fallbacks[mealType] ?? fallbacks["all"]!;
  return mealFallbacks[season] ?? mealFallbacks["spring"] ?? fallbacks["all"]!["spring"]!;
}
