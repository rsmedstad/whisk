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

// GET /api/discover/ideas — Generate seasonal recipe ideas with Unsplash photos
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "seasonal";
  const season = url.searchParams.get("season") ?? "spring";
  const refresh = url.searchParams.get("refresh") === "1";

  // Check cache first (unless refresh requested)
  const cacheKey = `discover_ideas:${category}:${season}`;
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
    ideas = await generateAIIdeas(fnConfig, env, category, season);
  } else {
    ideas = getFallbackIdeas(category, season);
  }

  // Fetch Unsplash photos for each idea
  const ideasWithPhotos = await attachUnsplashPhotos(ideas, env);

  const result = JSON.stringify({ ideas: ideasWithPhotos, category, season });

  // Cache for 1 week
  await env.WHISK_KV.put(cacheKey, result, {
    expirationTtl: CACHE_TTL_SECONDS,
  });

  return new Response(result, {
    headers: { "Content-Type": "application/json" },
  });
};

async function generateAIIdeas(
  fnConfig: { provider: string; model: string },
  env: ProviderEnv,
  category: string,
  season: string
): Promise<IdeaRaw[]> {
  const prompts: Record<string, string> = {
    seasonal: `Suggest 8 recipe ideas that are perfect for ${season}. Include seasonal ingredients and cooking styles. For each recipe, give a short appetizing name (3-5 words max) and a one-sentence description.`,
    quick: "Suggest 8 quick weeknight dinner ideas (under 30 minutes). For each, give a short appetizing name (3-5 words max) and a one-sentence description.",
    trending: "Suggest 8 trending/popular recipe ideas that food lovers are excited about right now. For each, give a short appetizing name (3-5 words max) and a one-sentence description.",
    comfort: "Suggest 8 comforting, hearty recipe ideas. Think soul food, comfort classics, cozy meals. For each, give a short appetizing name (3-5 words max) and a one-sentence description.",
    healthy: "Suggest 8 healthy, nutritious recipe ideas. Focus on whole foods, vegetables, lean proteins. For each, give a short appetizing name (3-5 words max) and a one-sentence description.",
  };

  const defaultPrompt = prompts["seasonal"]!;
  const prompt = prompts[category] ?? defaultPrompt;

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
    const ideas = Array.isArray(parsed) ? parsed : parsed.ideas ?? [];
    return ideas as IdeaRaw[];
  } catch {
    return getFallbackIdeas(category, season);
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

  // Batch into groups of 4 to reduce parallel requests and avoid rate limits.
  // Each search returns per_page=4 results — we assign one per idea in the batch
  // using different search terms, so we get variety with fewer API calls.
  const output: IdeaWithPhoto[] = [];
  const BATCH_SIZE = 4;

  for (let i = 0; i < ideas.length; i += BATCH_SIZE) {
    const batch = ideas.slice(i, i + BATCH_SIZE);

    // Fetch photos for this batch in parallel (max 4 concurrent)
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

function getFallbackIdeas(_category: string, season: string): IdeaRaw[] {
  const seasonal: Record<string, IdeaRaw[]> = {
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
  };

  return seasonal[season] ?? seasonal["spring"]!;
}
