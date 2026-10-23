/** Canonical form for matching recipe source URLs (idempotent import). */
export function normalizeSourceUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return trimmed;
    u.hash = "";
    u.username = "";
    u.password = "";
    u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
    u.protocol = "https:";
    u.search = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return trimmed.replace(/\/$/, "").replace(/^http:/i, "https:");
  }
}

export function sourceUrlsMatch(a: string, b: string): boolean {
  return normalizeSourceUrl(a) === normalizeSourceUrl(b);
}

export function findRecipeIdBySourceUrl(
  recipes: Array<{ id: string; sourceUrl?: string; source?: { url?: string } }>,
  url: string,
): string | undefined {
  const key = normalizeSourceUrl(url);
  if (!key) return undefined;
  for (const recipe of recipes) {
    const candidate = recipe.sourceUrl ?? recipe.source?.url;
    if (candidate && normalizeSourceUrl(candidate) === key) return recipe.id;
  }
  return undefined;
}
