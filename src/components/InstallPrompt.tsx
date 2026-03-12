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

/** Inline iOS Safari ellipsis icon (three dots in a circle) */
function EllipsisIcon() {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-stone-400 text-white align-middle mx-0.5">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <circle cx="6" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="18" cy="12" r="1.5" />
      </svg>
    </span>
  );
}

/** Inline iOS share icon (square with arrow up) */
function ShareIcon() {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-stone-400 text-white align-middle mx-0.5">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3v12" />
      </svg>
    </span>
  );
}

/** Inline "Add to Home Screen" icon (plus in a square) */
function AddToHomeIcon() {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-stone-400 text-white align-middle mx-0.5">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3.75h10.5a3 3 0 0 1 3 3v10.5a3 3 0 0 1-3 3H6.75a3 3 0 0 1-3-3V6.75a3 3 0 0 1 3-3Z" />
      </svg>
    </span>
  );
}

/** Inline Android Chrome three-dot menu icon */
function VerticalDotsIcon() {
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-stone-400 text-white align-middle mx-0.5">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <circle cx="12" cy="5" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="12" cy="19" r="1.5" />
      </svg>
    </span>
  );
}

export function InstallPrompt() {
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (platform === "pwa" || platform === "desktop") return null;

  const handleInstall = async () => {
    if (deferredPrompt && "prompt" in deferredPrompt) {
      (deferredPrompt as { prompt: () => void }).prompt();
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="mb-10">
      <Card>
        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold dark:text-stone-100">
              Install Whisk
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Works offline, launches full-screen, and feels like a native app
            </p>
          </div>

          {platform === "ios" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded shrink-0">1</span>
                <span>Tap <EllipsisIcon /> near the address bar</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded shrink-0">2</span>
                <span>Tap <ShareIcon /> <strong>Share</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded shrink-0">3</span>
                <span>Tap <AddToHomeIcon /> <strong>Add to Home Screen</strong></span>
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
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded shrink-0">1</span>
                <span>Tap <VerticalDotsIcon /> in the top right corner</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded shrink-0">2</span>
                <span>Tap <AddToHomeIcon /> <strong>Add to Home screen</strong> or <strong>Install app</strong></span>
              </div>
            </div>
          )}

        </div>
      </Card>
    </div>
  );
}
