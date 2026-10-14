import { useState } from "react";
import { buildBookmarkletHref } from "../../lib/bookmarklet";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export function BookmarkletHelp() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const href = origin ? buildBookmarkletHref(origin) : "javascript:void(0)";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card>
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-stone-700 dark:text-stone-200">
            Save to Whisk bookmarklet
          </p>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            For sites that block Whisk&apos;s server (The Kitchn and similar), save the recipe
            from your own browser — the page already loaded for you. Drag the button to your
            bookmarks bar, or copy it and paste it as a bookmark URL.
          </p>
        </div>

        <a
          href={href}
          onClick={(e) => e.preventDefault()}
          className="flex items-center justify-center gap-2 rounded-[var(--wk-radius-btn)] bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
        >
          Save to Whisk
        </a>
        <p className="text-[11px] text-stone-400 dark:text-stone-500 text-center">
          Desktop: drag the button to your bookmarks bar. Don&apos;t click it here.
        </p>

        <Button variant="secondary" fullWidth onClick={copy}>
          {copied ? "Copied" : "Copy bookmarklet"}
        </Button>

        <ol className="text-xs text-stone-500 dark:text-stone-400 space-y-1.5 list-decimal pl-4">
          <li>Install the bookmarklet once (drag or copy into Bookmarks).</li>
          <li>Open the recipe in Safari or Chrome so the page loads normally.</li>
          <li>Tap <span className="font-medium text-stone-600 dark:text-stone-300">Save to Whisk</span> in your bookmarks.</li>
          <li>A Whisk tab opens, signs in with your existing session, and saves the recipe.</li>
        </ol>

        <p className="text-xs text-stone-500 dark:text-stone-400">
          iOS: bookmark any page, then Edit and paste the copied <code className="text-[11px]">javascript:</code> URL.
          Android: Chrome → star the current page → Edit bookmark → paste the same URL.
        </p>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Android &quot;Share to Whisk&quot; (if the PWA is installed) only sends the URL. The Kitchn
          still blocks that server fetch — the bookmarklet is the path that works.
        </p>
      </div>
    </Card>
  );
}
