import { useState, useEffect } from "react";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

type Platform = "ios-safari" | "ios-other" | "android" | "desktop" | "pwa";

function detectPlatform(): Platform {
  // Already installed as PWA
  if (window.matchMedia("(display-mode: standalone)").matches) return "pwa";
  if ((navigator as { standalone?: boolean }).standalone) return "pwa";

  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isSafari = /safari/.test(ua) && !/crios|fxios|chrome/.test(ua);

  if (isIOS && isSafari) return "ios-safari";
  if (isIOS) return "ios-other";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export function InstallPrompt() {
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem("whisk_install_dismissed") === "true";
  });
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());

    // Capture the beforeinstallprompt event (Chrome/Android)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Don't show if already installed or dismissed
  if (platform === "pwa" || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("whisk_install_dismissed", "true");
  };

  const handleInstall = async () => {
    if (deferredPrompt && "prompt" in deferredPrompt) {
      (deferredPrompt as { prompt: () => void }).prompt();
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="px-4 pb-3">
      <Card>
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold dark:text-stone-100">
              Install Whisk for the best experience
            </p>
            <button
              onClick={handleDismiss}
              className="text-stone-400 hover:text-stone-600 text-lg leading-none shrink-0"
            >
              &times;
            </button>
          </div>

          {platform === "ios-safari" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">1</span>
                Tap the <span className="inline-block w-5 h-5 text-center leading-5 bg-stone-100 dark:bg-stone-800 rounded text-xs">&#9757;</span> share button at the bottom of Safari
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">2</span>
                Scroll down and tap "Add to Home Screen"
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">3</span>
                Tap "Add" in the top-right corner
              </div>
            </div>
          )}

          {platform === "ios-other" && (
            <p className="text-sm text-stone-600 dark:text-stone-300">
              For the best experience, open Whisk in Safari, then tap the share button and choose "Add to Home Screen".
            </p>
          )}

          {platform === "android" && deferredPrompt && (
            <Button size="sm" onClick={handleInstall}>
              Add to Home Screen
            </Button>
          )}

          {platform === "android" && !deferredPrompt && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">1</span>
                Tap the menu (&#8942;) in your browser
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">2</span>
                Tap "Add to Home screen" or "Install app"
              </div>
            </div>
          )}

          {platform === "desktop" && (
            <>
              {deferredPrompt ? (
                <Button size="sm" onClick={handleInstall}>
                  Install App
                </Button>
              ) : (
                <p className="text-sm text-stone-600 dark:text-stone-300">
                  Look for the install icon in your browser's address bar, or use your browser's menu to install this app.
                </p>
              )}
            </>
          )}

          <p className="text-xs text-stone-400 dark:text-stone-500">
            Whisk works offline and feels like a native app when installed
          </p>
        </div>
      </Card>
    </div>
  );
}
