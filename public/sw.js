const CACHE_NAME = "whisk-v2";
const API_CACHE = "whisk-api-v1";
const PHOTO_CACHE = "whisk-photos-v1";

// Static assets to precache on install
const PRECACHE = ["/", "/manifest.json", "/icons/favicon.svg"];

// ── Install ─────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
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
  );
  self.clients.claim();
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

  // ── API: stale-while-revalidate for GET endpoints ────
  if (url.pathname.startsWith("/api/")) {
    // Only cache safe read endpoints
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
        cache.match(request).then((cached) => {
          const networkFetch = fetch(request)
            .then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached || new Response("{}", { status: 503 }));

          // Return cached immediately, update in background
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // ── Static assets (JS/CSS): cache-first with hashed filenames ──
  if (url.pathname.match(/\.(js|css|woff2?)$/) || url.pathname === "/manifest.json") {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
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
          // Cache the latest shell
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", clone));
          return response;
        })
        .catch(() => caches.match("/").then((r) => r || new Response("Offline", { status: 503 })))
    );
    return;
  }
});

// ── Background Sync (for offline edits) ─────────────────

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});
