import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// ── Service Worker Registration ─────────────────────────
// Auto-updates: each deploy produces a new sw.js (unique BUILD_ID),
// the browser detects the change and installs the new SW, which
// clears old caches and reloads the page automatically.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        // Check for updates every 5 minutes
        setInterval(() => reg.update(), 5 * 60 * 1000);

        // Check for updates when user returns to the app
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update();
        });

        // If a SW is already waiting (e.g. installed while tab was in background), activate it
        if (reg.waiting) {
          reg.waiting.postMessage("skipWaiting");
        }

        // When a new SW is waiting, tell it to activate immediately
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // New version installed while we have an existing one — activate it
              newWorker.postMessage("skipWaiting");
            }
          });
        });
      })
      .catch(() => {
        // SW registration failed — app still works without it
      });

    // When the new SW takes over, reload to get fresh assets
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!reloading) {
        reloading = true;
        window.location.reload();
      }
    });
  });
}
