import { useCallback, useEffect } from "react";
import { setBadge, clearBadge } from "../lib/badge";
import { api } from "../lib/api";
import { getLocal, setLocal } from "../lib/cache";
import type { DiscoverFeed } from "../types";

const SEEN_KEY = "whisk_discover_seen_urls";
const ENABLED_KEY = "whisk_badge_enabled";
const FEED_CACHE_KEY = "discover_feed";
const MAX_SEEN = 500;
const FETCH_THROTTLE_MS = 60_000;

let lastFetchAt = 0;

function isEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "true";
}

function getSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(set: Set<string>): void {
  let arr = Array.from(set);
  if (arr.length > MAX_SEEN) arr = arr.slice(arr.length - MAX_SEEN);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch {
    // localStorage full — drop seen tracking silently
  }
}

function feedUrls(feed: DiscoverFeed | null): string[] {
  if (!feed?.categories) return [];
  const urls: string[] = [];
  for (const items of Object.values(feed.categories)) {
    if (!items) continue;
    for (const item of items) {
      if (item.url) urls.push(item.url);
    }
  }
  return urls;
}

async function maybeFetchFeed(): Promise<void> {
  if (!isEnabled()) return;
  if (Date.now() - lastFetchAt < FETCH_THROTTLE_MS) return;
  lastFetchAt = Date.now();
  try {
    const data = await api.get<DiscoverFeed>("/discover/feed");
    if (data) setLocal(FEED_CACHE_KEY, data);
  } catch {
    // offline or auth error — fall back to cache
  }
}

/**
 * Sets the home-screen icon badge to the count of Discover feed items the
 * user hasn't seen yet. Clears + recalibrates when the user is viewing the
 * Discover route with the page visible.
 */
export function useDiscoverBadge(onDiscoverTab: boolean): void {
  const apply = useCallback(() => {
    if (!isEnabled()) {
      clearBadge();
      return;
    }
    const feed = getLocal<DiscoverFeed>(FEED_CACHE_KEY);
    const urls = feedUrls(feed);
    if (urls.length === 0) return;

    const seen = getSeen();

    // First run on this device: calibrate without badging the backlog.
    if (seen.size === 0) {
      for (const u of urls) seen.add(u);
      saveSeen(seen);
      clearBadge();
      return;
    }

    if (onDiscoverTab && document.visibilityState === "visible") {
      for (const u of urls) seen.add(u);
      saveSeen(seen);
      clearBadge();
      return;
    }

    let unseen = 0;
    for (const u of urls) if (!seen.has(u)) unseen++;
    setBadge(unseen);
  }, [onDiscoverTab]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      await maybeFetchFeed();
      if (!cancelled) apply();
    };

    refresh();

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
      else apply();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, [apply]);
}
