import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildShortcutJavaScript } from "../../lib/bookmarklet";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ChevronLeft } from "../ui/Icon";

export function ShortcutHelp() {
  const navigate = useNavigate();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const js = origin ? buildShortcutJavaScript(origin) : "";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(js);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen pb-24">
      <div className="px-4 pt-[calc(var(--sat)+1rem)] pb-6 max-w-lg mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-lg text-stone-600 dark:text-stone-300"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold dark:text-stone-100">iOS Shortcut</h1>
        </div>

        <p className="text-sm text-stone-600 dark:text-stone-400">
          Shortcuts cannot be signed or built on Linux. Build this one on your iPhone so Safari&apos;s
          share sheet can send a Kitchn (or any) recipe page to Whisk.
        </p>

        <Card>
          <ol className="text-sm text-stone-600 dark:text-stone-300 space-y-3 list-decimal pl-5">
            <li>
              Open the <span className="font-medium">Shortcuts</span> app and tap{" "}
              <span className="font-medium">+</span>. Name it{" "}
              <span className="font-medium">Save to Whisk</span>.
            </li>
            <li>
              Tap the shortcut info button. Turn on{" "}
              <span className="font-medium">Show in Share Sheet</span>.
            </li>
            <li>
              Under <span className="font-medium">Receive</span>, choose{" "}
              <span className="font-medium">Safari web pages</span> (URLs optional).
            </li>
            <li>
              Add <span className="font-medium">Run JavaScript on Web Page</span>. Paste the script
              below. It finds Recipe JSON-LD, base64url-encodes it, and builds{" "}
              <code className="text-xs break-all">
                {origin || "https://your-whisk"}/import/ld#ld=…
              </code>
              . Shortcuts cannot gzip, so this uses the uncompressed{" "}
              <code className="text-xs">#ld=</code> hash.
            </li>
            <li>
              Add <span className="font-medium">Open URLs</span> and pass the JavaScript result.
            </li>
            <li>
              In Safari, open the recipe so the page loads, then Share →{" "}
              <span className="font-medium">Save to Whisk</span>.
            </li>
          </ol>
        </Card>

        <Card>
          <div className="space-y-3">
            <p className="text-sm font-medium text-stone-700 dark:text-stone-200">
              Run JavaScript on Web Page
            </p>
            <textarea
              readOnly
              value={js}
              rows={8}
              className="w-full text-[11px] font-mono rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 p-2 text-stone-700 dark:text-stone-300"
            />
            <Button variant="secondary" fullWidth onClick={copy}>
              {copied ? "Copied" : "Copy JavaScript"}
            </Button>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              The origin is baked in ({origin || "this Whisk"}). Rebuild the shortcut if you switch
              instances. Desktop and iOS can also use the{" "}
              <button
                type="button"
                onClick={() => navigate("/settings?tab=data")}
                className="text-orange-600 dark:text-orange-400 underline"
              >
                Save to Whisk bookmarklet
              </button>
              .
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
