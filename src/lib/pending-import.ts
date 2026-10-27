import type { PendingImport } from "../types";
import { detectSavePlatform, type SavePlatform } from "./platform";
import { normalizeSourceUrl } from "./source-url";

export const PENDING_IMPORT_KEY = "whisk_pending_import";

export const BLOCKED_SHEET_FIXTURE: PendingImport = {
  url: "https://www.thekitchn.com/greek-meatballs-keftedes-recipe-23847745",
  title: "Greek Meatballs (Keftedes)",
  timestamp: 0,
  source: "thekitchn",
  sourceLabel: "The Kitchn",
};

const BLOCKED_HOST = /(^|\.)thekitchn\.com$|(^|\.)kitchn\.com$/i;
const BLOCKED_SOURCE_ID = /kitchn/i;

export function isPendingImport(value: unknown): value is PendingImport {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.url === "string" &&
    typeof v.title === "string" &&
    typeof v.timestamp === "number"
  );
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): Store | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function getPendingImport(store: Store | null = defaultStore()): PendingImport | null {
  if (!store) return null;
  try {
    const raw = store.getItem(PENDING_IMPORT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPendingImport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setPendingImport(pending: PendingImport, store: Store | null = defaultStore()): void {
  if (!store) return;
  try {
    store.setItem(PENDING_IMPORT_KEY, JSON.stringify(pending));
  } catch {
    // private mode
  }
}

export function clearPendingImport(url?: string, store: Store | null = defaultStore()): void {
  if (!store) return;
  if (url) {
    const existing = getPendingImport(store);
    if (existing && normalizeSourceUrl(existing.url) !== normalizeSourceUrl(url)) return;
  }
  try {
    store.removeItem(PENDING_IMPORT_KEY);
  } catch {
    // ignore
  }
}

export function isBlockedDiscoverSource(source?: string, url?: string): boolean {
  if (source && BLOCKED_SOURCE_ID.test(source)) return true;
  if (!url) return false;
  try {
    return BLOCKED_HOST.test(new URL(url).hostname);
  } catch {
    return BLOCKED_HOST.test(url);
  }
}

export function sourceLabelFromPending(item: Pick<PendingImport, "sourceLabel" | "source" | "url">): string {
  if (item.sourceLabel) return item.sourceLabel;
  if (item.source && /kitchn/i.test(item.source)) return "The Kitchn";
  if (item.url && isBlockedDiscoverSource(item.source, item.url)) return "The Kitchn";
  return "the original site";
}

/** Readable title from a recipe page URL slug; falls back to the host name. */
export function titleFromRecipeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.replace(/^www\./i, "");
  const slug = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
  const words = slug
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[-_]?\d{5,}$/, "")
    .split(/[-_]+/)
    .filter((w) => w && !/^\d+$/.test(w));
  if (words.length < 2) return host;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Sheet content for a URL pasted on the Add screen, where no recipe title is known yet. */
export function pendingImportFromUrl(url: string, sourceLabel?: string, now: number = Date.now()): PendingImport {
  return {
    url,
    title: titleFromRecipeUrl(url),
    timestamp: now,
    ...(sourceLabel ? { sourceLabel } : {}),
  };
}

export function blockedSheetFrameLimitCopy(sourceLabel: string): string {
  return `Whisk can't show ${sourceLabel} inside this app. Browsers block framing other sites (X-Frame-Options), so you'll leave Whisk and see their page — then save it back here.`;
}

export function blockedSheetNextStepCopy(
  sourceLabel: string,
  platform: SavePlatform = detectSavePlatform(),
): string {
  if (platform === "android") {
    return `Open on ${sourceLabel} → then Share → Whisk.`;
  }
  return `Open on ${sourceLabel} → then tap Save to Whisk (iOS/desktop bookmark, or Shortcut).`;
}

export function preferSameTabOpen(platform: SavePlatform = detectSavePlatform()): boolean {
  return platform === "ios" || platform === "android";
}

export function openSourcePage(url: string, platform: SavePlatform = detectSavePlatform()): void {
  if (preferSameTabOpen(platform)) {
    window.location.assign(url);
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
}
