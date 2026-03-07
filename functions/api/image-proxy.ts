// GET /api/image-proxy?url=<encoded-url>
// Proxies external images to avoid hotlinking blocks (e.g. Dotdash Meredith sites)

export const onRequestGet: PagesFunction = async ({ request }) => {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return new Response("Missing url parameter", { status: 400 });
  }

  // Only allow proxying image URLs from known recipe sites
  const ALLOWED_DOMAINS = [
    "www.seriouseats.com",
    "seriouseats.com",
    "www.allrecipes.com",
    "allrecipes.com",
    "imagesvc.meredithcorp.io",
    "food.fnr.sndimg.com",
    "www.simplyrecipes.com",
    "static01.nyt.com",
    "cooking.nytimes.com",
  ];

  let hostname: string;
  try {
    hostname = new URL(imageUrl).hostname;
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }

  if (!ALLOWED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
    return new Response("Domain not allowed", { status: 403 });
  }

  try {
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: `https://${hostname}/`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return new Response("Image fetch failed", { status: 502 });
    }

    const contentType = res.headers.get("Content-Type") ?? "image/jpeg";
    const body = await res.arrayBuffer();

    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("Image proxy error", { status: 502 });
  }
};
