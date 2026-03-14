import type { Env } from "../../../../src/types";

const ARCHIVE_KEY = "discover_archive";

interface ArchiveItem {
  title: string;
  url: string;
  imageUrl?: string;
  description?: string;
  source: string;
  category: string;
  addedAt: string;
  expiresAt?: string;
  tags?: string[];
  totalTime?: number;
}

interface Archive {
  lastRefreshed: string;
  items: ArchiveItem[];
}

/** POST /api/discover/feed/restore?range=30|90|365|all
 *  Restores expired archive items by resetting their expiresAt to 7 days from now.
 *  Only restores items added within the specified range (days). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "all";

  const archive = await env.WHISK_KV.get<Archive>(ARCHIVE_KEY, "json");
  if (!archive || archive.items.length === 0) {
    return Response.json({ restored: 0 });
  }

  const now = Date.now();
  const rangeDays = range === "all" ? Infinity : parseInt(range, 10);
  const rangeCutoff = rangeDays === Infinity ? 0 : now - rangeDays * 24 * 60 * 60 * 1000;
  const newExpiry = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

  let restored = 0;
  const updated = archive.items.map((item) => {
    const expired = item.expiresAt && new Date(item.expiresAt).getTime() < now;
    const withinRange = new Date(item.addedAt).getTime() >= rangeCutoff;
    if (expired && withinRange) {
      restored++;
      return { ...item, expiresAt: newExpiry };
    }
    return item;
  });

  await env.WHISK_KV.put(ARCHIVE_KEY, JSON.stringify({
    lastRefreshed: archive.lastRefreshed,
    items: updated,
  }));

  return Response.json({ restored });
};
