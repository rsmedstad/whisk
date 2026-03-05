import { useState, useEffect } from "react";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

type Platform = "ios" | "android" | "desktop" | "pwa";

function detectPlatform(): Platform {
  // Already installed as PWA
  if (window.matchMedia("(display-mode: standalone)").matches) return "pwa";
  if ((navigator as { standalone?: boolean }).standalone) return "pwa";

  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

function getBrowserName(): string {
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua)) return "Chrome";
  if (/FxiOS/.test(ua)) return "Firefox";
  if (/EdgiOS/.test(ua)) return "Edge";
  if (/OPiOS/.test(ua)) return "Opera";
  if (/Brave/.test(ua)) return "Brave";
  if (/Safari/.test(ua) && !/Chrome/.test(ua)) return "Safari";
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/Chrome/.test(ua)) return "Chrome";
  if (/Firefox/.test(ua)) return "Firefox";
  return "your browser";
}

export function InstallPrompt() {
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [browserName, setBrowserName] = useState("your browser");
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem("whisk_install_dismissed") === "true";
  });
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
    setBrowserName(getBrowserName());

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (platform === "pwa" || platform === "desktop" || dismissed) return null;

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

          {platform === "ios" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">1</span>
                Tap the share button in {browserName}
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">2</span>
                Scroll down and tap &ldquo;Add to Home Screen&rdquo;
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">3</span>
                Tap &ldquo;Add&rdquo; to confirm
              </div>
            </div>
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
                Open the menu in {browserName}
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">2</span>
                Tap &ldquo;Add to Home screen&rdquo; or &ldquo;Install app&rdquo;
              </div>
            </div>
          )}

          <p className="text-xs text-stone-400 dark:text-stone-500">
            Whisk works offline and feels like a native app when installed
          </p>
        </div>
      </Card>
    </div>
  );
}
