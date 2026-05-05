/**
 * Web App Badging API wrapper.
 *
 * Renders a numeric badge on the installed PWA's home-screen / dock icon.
 * Supported on iOS 16.4+ (installed PWAs only, requires Notifications
 * permission), macOS Safari, and Chromium browsers. No-ops elsewhere.
 */

export function isBadgeSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return "setAppBadge" in navigator;
}

export async function setBadge(count: number): Promise<void> {
  if (!isBadgeSupported()) return;
  try {
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge();
  } catch {
    // Permission denied or transient platform error — ignore
  }
}

export async function clearBadge(): Promise<void> {
  if (!isBadgeSupported()) return;
  try {
    await navigator.clearAppBadge();
  } catch {
    // ignore
  }
}

/**
 * Request Notifications permission. iOS requires this before
 * setAppBadge will render anything on the home-screen icon.
 * Returns true if granted (or already granted).
 */
export async function requestBadgePermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}
