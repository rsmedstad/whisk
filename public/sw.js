// __BUILD_ID__ is replaced at build time by Vite — each deploy creates a unique SW
const BUILD_ID = "__BUILD_ID__";
const CACHE_NAME = "whisk-" + BUILD_ID;
const API_CACHE = "whisk-api-v2";
const PHOTO_CACHE = "whisk-photos-v1";

// Static assets to precache on install
const PRECACHE = ["/", "/manifest.json", "/icons/favicon.svg"];

// ── Install ─────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// ── Activate ────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  const keep = new Set([CACHE_NAME, API_CACHE, PHOTO_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
      .then(() => {
        // Notify all open tabs that a new version is active
        self.clients.matchAll({ type: "window" }).then((clients) => {
          clients.forEach((client) => client.postMessage({ type: "SW_UPDATED" }));
        });
      })
  );
});

// ── Fetch ───────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // ── Photos: cache-first (images don't change) ────────
  if (
    url.pathname.startsWith("/photos/") ||
    url.pathname.match(/\.(webp|jpg|jpeg|png)$/)
  ) {
    event.respondWith(
      caches.open(PHOTO_CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            })
        )
      )
    );
    return;
  }

  // ── API: network-first with cache fallback ─────────────
  if (url.pathname.startsWith("/api/")) {
    const cacheable =
      url.pathname === "/api/recipes" ||
      url.pathname.match(/^\/api\/recipes\/[^/]+$/) ||
      url.pathname === "/api/shopping" ||
      url.pathname.startsWith("/api/plan") ||
      url.pathname === "/api/tags" ||
      url.pathname === "/api/capabilities";

    if (!cacheable) return;

    event.respondWith(
      caches.open(API_CACHE).then((cache) =>
        fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() =>
            cache.match(request).then(
              (cached) => cached || new Response("{}", { status: 503 })
            )
          )
      )
    );
    return;
  }

  // ── Static assets (JS/CSS): stale-while-revalidate ──
  // Vite uses content-hashed filenames, so new deploys = new URLs.
  // Serve from cache instantly, fetch fresh copy in background.
  if (url.pathname.match(/\.(js|css|woff2?)$/) || url.pathname === "/manifest.json") {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // ── Navigation: network-first, instant fallback to cached shell ──
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", clone));
          return response;
        })
        .catch(() => caches.match("/").then((r) => r || new Response("Offline", { status: 503 })))
    );
    return;
  }
});

// ── Message handling ────────────────────────────────────

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});
