export type SavePlatform = "ios" | "android" | "desktop";

const BOOKMARKLET_INSTALLED_KEY = "whisk_bookmarklet_installed";

/** Simple UA hints — enough to pick a one-tap save path. */
export function detectSavePlatform(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): SavePlatform {
  const s = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  // iPadOS 13+ can report as Macintosh
  if (
    /macintosh/.test(s) &&
    typeof navigator !== "undefined" &&
    navigator.maxTouchPoints > 1
  ) {
    return "ios";
  }
  if (/android/.test(s)) return "android";
  return "desktop";
}

export function isBookmarkletInstalled(): boolean {
  try {
    return localStorage.getItem(BOOKMARKLET_INSTALLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function markBookmarkletInstalled(): void {
  try {
    localStorage.setItem(BOOKMARKLET_INSTALLED_KEY, "true");
  } catch {
    // private mode
  }
}
