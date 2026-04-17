// Pre-render bootstrap — kept tiny and side-effect-only so it can run
// synchronously before React mounts. Extracted from index.html so that a
// strict Content-Security-Policy can disallow inline scripts.

// Synchronous theme application — prevents flash of wrong theme.
(function () {
  try {
    var t = localStorage.getItem("whisk_theme") || "seasonal";
    var dark =
      t === "dark" ||
      ((t === "system" || t === "seasonal") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    // localStorage can throw in private mode; ignore and default to light
  }
})();

// One-time migration: nuke old service workers and caches.
// Old SWs (whisk-v5 etc.) cache JS/CSS and block updates forever.
// Gated by version flag so it runs once per client.
(function () {
  try {
    if (!("serviceWorker" in navigator) || localStorage.getItem("whisk_sw_v") === "2") return;
    localStorage.setItem("whisk_sw_v", "2");
    var p1 = navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all(
        regs.map(function (r) {
          return r.unregister();
        })
      );
    });
    var p2 =
      "caches" in window
        ? caches.keys().then(function (keys) {
            return Promise.all(
              keys.map(function (k) {
                return caches.delete(k);
              })
            );
          })
        : Promise.resolve();
    Promise.all([p1, p2]).then(function () {
      window.location.reload();
    });
  } catch (e) {
    // Non-fatal
  }
})();
