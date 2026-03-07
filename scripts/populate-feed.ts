// Scrape trending recipes from 3 sites and write directly to KV via Cloudflare REST API.
// Usage: bun run scripts/populate-feed.ts

const CF_ACCOUNT_ID = "1d6a394479cb4f03320a4aba405c831e";
const KV_NS = "9961b213d1114876af09f83f3884aeb9";

const configPath = `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`;
const config = await Bun.file(configPath).text();
const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!tokenMatch?.[1]) {
  console.error("No OAuth token found. Run: npx wrangler whoami");
  process.exit(1);
}
const token = tokenMatch[1];
const kvBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NS}`;

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface FeedItem {
  title: string;
  url: string;
  imageUrl?: string;
  description?: string;
}

// ── NYT Cooking ─────────────────────────────────────────

async function scrapeNYTCooking(): Promise<FeedItem[]> {
  console.log("Scraping NYT Cooking...");
  try {
    const res = await fetch("https://cooking.nytimes.com/", {
      signal: AbortSignal.timeout(15000),
      headers: HEADERS,
    });
    if (!res.ok) {
      console.log(`  NYT returned ${res.status}`);
      return [];
    }
    const html = await res.text();

    const match = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!match?.[1]) {
      console.log("  No __NEXT_DATA__ found");
      return [];
    }

    const data = JSON.parse(match[1]);
    const items: FeedItem[] = [];
    findRecipesInJson(data, items);

    const seen = new Set<string>();
    const deduped = items.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    }).slice(0, 40);

    console.log(`  Found ${deduped.length} recipes`);
    return deduped;
  } catch (e) {
    console.log(`  Error: ${(e as Error).message}`);
    return [];
  }
}

function findRecipesInJson(
  obj: unknown,
  results: FeedItem[],
  depth = 0
): void {
  if (depth > 20 || !obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) findRecipesInJson(item, results, depth + 1);
    return;
  }

  const rec = obj as Record<string, unknown>;
  const name =
    (typeof rec.name === "string" && rec.name.length > 2 && rec.name) ||
    (typeof rec.title === "string" && rec.title.length > 2 && rec.title) ||
    (typeof rec.headline === "string" && rec.headline.length > 2 && rec.headline) ||
    (typeof rec.displayName === "string" && rec.displayName.length > 2 && rec.displayName);

  let recipeUrl: string | null = null;
  for (const key of ["url", "uri", "path", "slug", "href", "link"]) {
    const val = rec[key];
    if (typeof val === "string" && val.includes("/recipes/")) {
      recipeUrl = val.startsWith("http")
        ? val
        : `https://cooking.nytimes.com${val}`;
      break;
    }
  }

  if (name && recipeUrl) {
    const imageUrl = extractImageFromJson(rec);
    const description =
      typeof rec.description === "string"
        ? rec.description.slice(0, 200)
        : typeof rec.topnote === "string"
          ? rec.topnote.replace(/<[^>]+>/g, "").slice(0, 200)
          : undefined;
    results.push({ title: name, url: recipeUrl, imageUrl, description });
    return;
  }

  for (const value of Object.values(rec)) {
    findRecipesInJson(value, results, depth + 1);
  }
}

function extractImageFromJson(rec: Record<string, unknown>): string | undefined {
  for (const key of ["image", "thumbnail", "thumbnailUrl", "photo", "media", "promotionalImage", "cardImage"]) {
    const val = rec[key];
    if (typeof val === "string" && val.startsWith("http")) return val;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const imgObj = val as Record<string, unknown>;
      if (typeof imgObj.url === "string") return imgObj.url;
      if (typeof imgObj.src === "string") return imgObj.src;
      for (const cropKey of ["crops", "renditions", "sizes"]) {
        const crops = imgObj[cropKey];
        if (crops && typeof crops === "object") {
          for (const crop of Object.values(crops as Record<string, unknown>)) {
            if (crop && typeof crop === "object") {
              const c = crop as Record<string, unknown>;
              if (typeof c.url === "string") return c.url;
            }
          }
        }
      }
    }
    if (Array.isArray(val) && val.length > 0) {
      const first = val[0];
      if (typeof first === "string" && first.startsWith("http")) return first;
      if (first && typeof first === "object") {
        const f = first as Record<string, unknown>;
        if (typeof f.url === "string") return f.url;
      }
    }
  }
  return undefined;
}

// ── AllRecipes ──────────────────────────────────────────

async function scrapeAllRecipes(): Promise<FeedItem[]> {
  console.log("Scraping AllRecipes...");
  try {
    const res = await fetch("https://www.allrecipes.com/", {
      signal: AbortSignal.timeout(15000),
      headers: HEADERS,
    });
    if (!res.ok) {
      console.log(`  AllRecipes returned ${res.status}`);
      return [];
    }
    const html = await res.text();
    const items = extractRecipeCards(
      html,
      /https?:\/\/www\.allrecipes\.com\/recipe\/\d+\/[a-z0-9-]+\/?/gi
    );
    console.log(`  Found ${items.length} recipes`);
    return items;
  } catch (e) {
    console.log(`  Error: ${(e as Error).message}`);
    return [];
  }
}

// ── Serious Eats ────────────────────────────────────────

async function scrapeSeriousEats(): Promise<FeedItem[]> {
  console.log("Scraping Serious Eats...");
  try {
    const res = await fetch("https://www.seriouseats.com/recipes", {
      signal: AbortSignal.timeout(15000),
      headers: HEADERS,
    });
    if (!res.ok) {
      console.log(`  Serious Eats returned ${res.status}`);
      return [];
    }
    const html = await res.text();
    const items = extractRecipeCards(
      html,
      /https?:\/\/www\.seriouseats\.com\/[a-z0-9][a-z0-9-]+-recipe(?:-\d+)?\/?/gi
    );
    console.log(`  Found ${items.length} recipes`);
    return items;
  } catch (e) {
    console.log(`  Error: ${(e as Error).message}`);
    return [];
  }
}

// ── Shared HTML extraction ──────────────────────────────

function extractRecipeCards(html: string, urlPattern: RegExp): FeedItem[] {
  const rawUrls = html.match(urlPattern) ?? [];
  const seen = new Set<string>();
  const items: FeedItem[] = [];

  // Build image map from all <img> tags
  const imgMap = new Map<string, string>();
  const imgRegex =
    /<img[^>]+?(?:alt="([^"]*)"[^>]*?(?:src|data-src)="([^"]+)"|(?:src|data-src)="([^"]+)"[^>]*?alt="([^"]*)")/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const alt = (imgMatch[1] ?? imgMatch[4] ?? "").trim().toLowerCase();
    const src = imgMatch[2] ?? imgMatch[3] ?? "";
    if (alt.length > 3 && src.startsWith("http")) {
      imgMap.set(alt, src);
    }
  }

  for (const rawUrl of rawUrls) {
    const url = rawUrl.replace(/\/$/, "");
    if (seen.has(url) || url.includes("-recipes-")) continue;
    seen.add(url);

    const idx = html.indexOf(url);
    if (idx === -1) continue;
    const ctxStart = Math.max(0, idx - 1500);
    const ctxEnd = Math.min(html.length, idx + url.length + 1500);
    const ctx = html.slice(ctxStart, ctxEnd);

    const altText = ctx.match(/<img[^>]+alt="([^"]{5,100})"/i)?.[1]?.trim();
    const headingText = ctx.match(
      /<(?:span|h[2-4])[^>]*class="[^"]*(?:title|heading|name|card__title)[^"]*"[^>]*>\s*([^<]{5,100})/i
    )?.[1]?.trim();

    const slugMatch = url.match(/\/([a-z0-9][a-z0-9-]+[a-z0-9])(?:\/?$)/);
    const slug = slugMatch?.[1]?.replace(/-recipe.*$/, "").replace(/-\d+$/, "");
    const slugTitle = slug
      ?.replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const title = altText ?? headingText ?? slugTitle;
    if (!title || title.length < 3) continue;

    const ctxImgMatch = ctx.match(
      /<img[^>]+(?:src|data-src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i
    );
    const imageUrl = ctxImgMatch?.[1] ?? imgMap.get(title.toLowerCase());

    items.push({ title, url, imageUrl });
  }

  return items.slice(0, 30);
}

// ── Main ────────────────────────────────────────────────

const [nyt, allrecipes, seriouseats] = await Promise.all([
  scrapeNYTCooking(),
  scrapeAllRecipes(),
  scrapeSeriousEats(),
]);

const feed = {
  lastRefreshed: new Date().toISOString(),
  sources: { nyt, allrecipes, seriouseats },
};

const total = nyt.length + allrecipes.length + seriouseats.length;
console.log(`\nTotal: ${total} recipes across 3 sources`);

if (total === 0) {
  console.error("No recipes found — aborting KV write");
  process.exit(1);
}

// Write to KV
console.log("\nWriting to KV...");
const writeRes = await fetch(
  `${kvBase}/values/${encodeURIComponent("discover_feed")}`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(feed),
  }
);
const writeData = (await writeRes.json()) as { success: boolean; errors?: unknown[] };
if (writeData.success) {
  console.log("Feed written to KV successfully!");
  console.log(`  NYT Cooking: ${nyt.length} recipes`);
  console.log(`  AllRecipes: ${allrecipes.length} recipes`);
  console.log(`  Serious Eats: ${seriouseats.length} recipes`);
} else {
  console.error("KV write failed:", writeData.errors);
  process.exit(1);
}
