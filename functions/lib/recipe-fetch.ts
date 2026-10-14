import { DEFAULT_DISCOVER_CONFIG } from "./discover-config";

/** Hard cap on the server-side recipe page fetch. Challenge pages (e.g. The
 *  Kitchn / PerimeterX) 403 in well under a second; hanging on Browser
 *  Rendering or Apify after that is what made Discover spin forever. */
export const RECIPE_FETCH_TIMEOUT_MS = 8000;

/** Client-side safety net around /api/import/url. Slightly above the server
 *  fetch budget so a successful parse + image download can still finish. */
export const RECIPE_IMPORT_CLIENT_TIMEOUT_MS = 12_000;

export const RECIPE_PAGE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export type SourceFetchCode = "source_blocked" | "source_timeout" | "source_empty";

export interface SourceFetchErrorBody {
  error: string;
  code: SourceFetchCode;
  sourceUrl: string;
  sourceLabel: string;
}

export interface RecipePageFetch {
  html: string | null;
  status: number | null;
  timedOut: boolean;
  challenge: boolean;
  ms: number;
}

export interface RssItem {
  title: string;
  url: string;
  descriptionHtml: string;
  contentHtml: string;
  imageUrl?: string;
  categories: string[];
  raw: string;
}

/** Honest browser-like GET with an 8s timeout. Reads the body even on
 *  non-200 — some sites still emit Recipe JSON-LD on a 403. Does not retry
 *  or escalate past a block. */
export async function fetchRecipePage(
  url: string,
  timeoutMs: number = RECIPE_FETCH_TIMEOUT_MS,
): Promise<RecipePageFetch> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: RECIPE_PAGE_HEADERS,
      redirect: "follow",
    });
    const html = await res.text();
    return {
      html,
      status: res.status,
      timedOut: false,
      challenge: isChallengeHtml(html),
      ms: Date.now() - t0,
    };
  } catch (err) {
    const timedOut = isAbortError(err);
    return {
      html: null,
      status: null,
      timedOut,
      challenge: false,
      ms: Date.now() - t0,
    };
  }
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name) : "";
  const message = err instanceof Error ? err.message : String(err);
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    /aborted|timed? ?out|AbortError/i.test(message)
  );
}

/** Bot-challenge / WAF interstitial. A 403 that still carries Recipe JSON-LD
 *  (Dotdash Meredith) is NOT a challenge. */
export function isChallengeHtml(html: string): boolean {
  if (!html) return true;
  if (html.length < 500 && !hasRecipeJsonLd(html)) return true;
  return (
    html.includes("<title>Just a moment...</title>") ||
    html.includes("Access to this page has been denied.") ||
    html.includes("_cf_chl_opt") ||
    html.includes("challenge-platform") ||
    html.includes("Checking your browser") ||
    html.includes("Vercel Security Checkpoint") ||
    html.includes("px-captcha") ||
    html.includes("_pxhd") ||
    /perimeterx/i.test(html) ||
    html.includes("PXjAYekY18") ||
    html.includes("ak_bmsc") ||
    html.includes("datadome") ||
    html.includes("incapsula") ||
    html.includes("_incap_") ||
    html.includes("verify you are human") ||
    html.includes("Please verify you are a human") ||
    html.includes("Access Denied") ||
    html.includes("support@people.inc") ||
    html.includes("contentlicensing@people.inc")
  );
}

/** Cheap signal that the body contains a Schema.org Recipe with ingredients. */
export function hasRecipeJsonLd(html: string): boolean {
  if (!html || !/application\/ld\+json/i.test(html)) return false;
  if (!/"@type"\s*:\s*(?:\[\s*)?"Recipe"/i.test(html)) return false;
  return /recipeIngredient/i.test(html);
}

export function extractRecipeJsonLd(html: string): Record<string, unknown> | null {
  if (!html) return null;
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw || raw.length > 1_000_000) continue;
    try {
      const found = findRecipeObject(JSON.parse(raw));
      if (found && Array.isArray(found.recipeIngredient) && found.recipeIngredient.length > 0) {
        return found;
      }
    } catch {
      // skip malformed blocks
    }
  }
  return null;
}

function findRecipeObject(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeObject(item);
      if (found) return found;
    }
    return null;
  }
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"]) {
      const found = findRecipeObject(item);
      if (found) return found;
    }
  }
  const type = obj["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) {
    return obj;
  }
  return null;
}

export function sourceLabelForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const src = DEFAULT_DISCOVER_CONFIG.sources.find((s) => {
      try {
        return new URL(s.url).hostname.replace(/^www\./, "") === host;
      } catch {
        return false;
      }
    });
    if (src) return src.label;
    return host;
  } catch {
    return "this site";
  }
}

export function feedUrlForPage(pageUrl: string): string | undefined {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, "");
    return DEFAULT_DISCOVER_CONFIG.sources.find((s) => {
      try {
        return new URL(s.url).hostname.replace(/^www\./, "") === host;
      } catch {
        return false;
      }
    })?.feedUrl;
  } catch {
    return undefined;
  }
}

export function buildSourceFetchError(code: SourceFetchCode, sourceUrl: string): SourceFetchErrorBody {
  const sourceLabel = sourceLabelForUrl(sourceUrl);
  const error =
    code === "source_timeout"
      ? `${sourceLabel} didn't respond in time. Open the original recipe, or try again.`
      : code === "source_empty"
        ? `No recipe data came back from ${sourceLabel}. Open the original recipe to view it.`
        : `${sourceLabel} blocked automated access. Open the original recipe to see ingredients and steps.`;
  return { error, code, sourceUrl, sourceLabel };
}

export function sourceFetchResponse(code: SourceFetchCode, sourceUrl: string): Response {
  return new Response(JSON.stringify(buildSourceFetchError(code, sourceUrl)), {
    status: 422,
    headers: { "Content-Type": "application/json" },
  });
}

/** True when we should stop (no Browser Rendering, no Apify) and show the
 *  blocked/timeout state. A 403 body that still has Recipe JSON-LD is usable. */
export function shouldFailFast(page: RecipePageFetch): boolean {
  if (page.timedOut) return true;
  if (page.html && hasRecipeJsonLd(page.html)) return false;
  if (page.challenge) return true;
  if (page.status !== null && page.status >= 400) return true;
  if (!page.html || page.html.length < 200) return true;
  return false;
}

export function classifyPageFetch(page: RecipePageFetch): SourceFetchCode | null {
  if (!shouldFailFast(page)) return null;
  if (page.timedOut) return "source_timeout";
  if (page.html && page.html.length >= 200 && !page.challenge && (page.status === null || page.status < 400)) {
    return "source_empty";
  }
  return "source_blocked";
}

/** Canonicalize a recipe URL for matching RSS <link>/<guid> against the
 *  Discover/import URL (strip www, trailing slash, tracking query params). */
export function normalizeRecipeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.protocol = "https:";
    u.hostname = u.hostname.replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) u.searchParams.delete(key);
    }
    const path = u.pathname.replace(/\/$/, "");
    const search = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path}${search ? `?${search}` : ""}`;
  } catch {
    return url.replace(/\/$/, "").replace(/^http:/, "https:");
  }
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&hellip;/g, "…")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex: string) => {
      const n = parseInt(hex, 16);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    })
    .replace(/&#(\d+);/g, (m, dec: string) => {
      const n = parseInt(dec, 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    })
    .replace(/&amp;/g, "&")
    .trim();
}

function xmlTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m?.[1] !== undefined ? decodeXmlEntities(m[1]) : undefined;
}

export function parseRssItems(xml: string): RssItem[] {
  const blocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ??
    xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ??
    [];
  const items: RssItem[] = [];
  for (const raw of blocks) {
    let url = xmlTag(raw, "link") ?? xmlTag(raw, "guid");
    if (!url || !url.startsWith("http")) {
      const href = raw.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
      url = href;
    }
    if (!url || !url.startsWith("http")) continue;
    const contentHtml = decodeXmlEntities(
      raw.match(/<content:encoded(?:\s[^>]*)?>([\s\S]*?)<\/content:encoded>/i)?.[1]
        ?? raw.match(/<content(?:\s[^>]*)?>([\s\S]*?)<\/content>/i)?.[1]
        ?? "",
    );
    const descriptionHtml = decodeXmlEntities(
      raw.match(/<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/i)?.[1] ?? "",
    );
    const categories = [...raw.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)]
      .map((m) => decodeXmlEntities(m[1] ?? "").trim())
      .filter(Boolean);
    const imageUrl =
      raw.match(/<g:image_link(?:\s[^>]*)?>\s*(https?:\/\/[^<\s]+)\s*<\/g:image_link>/i)?.[1]
      ?? raw.match(/<media:content[^>]+url=["']([^"']+)["']/i)?.[1]
      ?? raw.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)?.[1]
      ?? (contentHtml || descriptionHtml).match(/<img[^>]+(?:src|data-src)=["'](https?:\/\/[^"']+)["']/i)?.[1];
    items.push({
      title: xmlTag(raw, "title") ?? "",
      url,
      descriptionHtml,
      contentHtml,
      imageUrl,
      categories,
      raw,
    });
  }
  return items;
}

export function findRssItemForUrl(items: RssItem[], pageUrl: string): RssItem | undefined {
  const target = normalizeRecipeUrl(pageUrl);
  return items.find((item) => normalizeRecipeUrl(item.url) === target);
}

/** Pull a Schema.org Recipe out of an RSS item if content:encoded (or the
 *  description) actually carries JSON-LD. The Kitchn main.rss does not —
 *  teasers only — so this returns null for those items. */
export function extractRecipeFromRssItem(item: RssItem): Record<string, unknown> | null {
  return extractRecipeJsonLd(item.contentHtml) ?? extractRecipeJsonLd(item.descriptionHtml);
}

export async function tryExtractRecipeFromSourceFeed(
  feedUrl: string,
  pageUrl: string,
  timeoutMs: number = RECIPE_FETCH_TIMEOUT_MS,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(feedUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        ...RECIPE_PAGE_HEADERS,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    if (xml.length < 200 || isChallengeHtml(xml)) return null;
    const item = findRssItemForUrl(parseRssItems(xml), pageUrl);
    if (!item) return null;
    return extractRecipeFromRssItem(item);
  } catch {
    return null;
  }
}

/** Wrap extracted JSON-LD so the existing HTML extractors can read it. */
export function jsonLdAsHtml(recipe: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify(recipe)}</script>`;
}

export interface ResolvedRecipeSource {
  html: string | null;
  page: RecipePageFetch;
  failFastCode: SourceFetchCode | null;
  fromFeed: boolean;
}

/** Fetch the page (8s). If it's a block/timeout with no Recipe JSON-LD, try
 *  the source's public RSS/Atom feed. Returns html to parse, or a fail-fast
 *  code so the caller can show the original-link error without escalating. */
export async function resolveRecipeSource(
  pageUrl: string,
  timeoutMs: number = RECIPE_FETCH_TIMEOUT_MS,
): Promise<ResolvedRecipeSource> {
  const page = await fetchRecipePage(pageUrl, timeoutMs);
  let html = page.html;
  let fromFeed = false;

  if (!hasRecipeJsonLd(html ?? "") && classifyPageFetch(page)) {
    const feedUrl = feedUrlForPage(pageUrl);
    if (feedUrl) {
      const fromRss = await tryExtractRecipeFromSourceFeed(feedUrl, pageUrl, timeoutMs);
      if (fromRss) {
        html = jsonLdAsHtml(fromRss);
        fromFeed = true;
      }
    }
  }

  const failFastCode = hasRecipeJsonLd(html ?? "") ? null : classifyPageFetch(page);
  return { html, page, failFastCode, fromFeed };
}
