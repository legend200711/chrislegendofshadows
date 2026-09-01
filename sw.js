/* ============================================================
   Service Worker — Chris Legend of Shadows
   Strategy: Cache-first for static assets, network-first for
   Firebase API calls (which we never want to cache).
   ============================================================ */

const CACHE_NAME = "legends-v5";

/* Assets to pre-cache on install */
const PRECACHE = [
  "/",
  "/index.html",
  "/about.html",
  "/gallery.html",
  "/music.html",
  "/music-player.html",
  "/founder-login.html",
  "/chat room.html",
  "/samiam.png",
  "/tam.png",
  "/wolf.png",
  "/manifest.json"
];

/* ── INSTALL ── */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  /* Take control immediately — don't wait for old SW to expire */
  self.skipWaiting();
});

/* ── ACTIVATE — remove old caches ── */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH ── */
self.addEventListener("fetch", event => {
  const url = event.request.url;

  /* Never intercept Firebase / external API calls */
  if(
    url.includes("firebaseio.com") ||
    url.includes("googleapis.com") ||
    url.includes("gstatic.com") ||
    url.includes("tawk.to") ||
    url.includes("elfsight") ||
    url.includes("spotify.com") ||
    url.includes("youtube.com") ||
    url.includes("r2.cloudflarestorage.com") ||
    url.includes("cloudflare") && !url.startsWith(self.location.origin)
  ){
    return; /* fall through to network */
  }

  /* Network-first for HTML navigation — ensures users always get fresh pages */
  if(event.request.mode === "navigate"){
    event.respondWith(
      fetch(event.request).then(response => {
        /* Cache the fresh page for offline fallback */
        if(response && response.status === 200 && response.type === "basic"){
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        /* Offline: serve cached version of the specific page, then homepage */
        caches.match(event.request).then(cached =>
          cached || caches.match("/index.html")
        )
      )
    );
    return;
  }

  /* Cache-first for static assets (images, SW, manifest) */
  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;

      return fetch(event.request).then(response => {
        /* Only cache successful same-origin responses */
        if(
          response && response.status === 200 &&
          response.type === "basic"
        ){
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache =>
            cache.put(event.request, clone)
          );
        }
        return response;
      }).catch(() => {
        /* Offline fallback for navigate */
        if(event.request.mode === "navigate"){
          return caches.match("/index.html");
        }
      });
    })
  );
});
