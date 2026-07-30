/* ============================================================
   Service Worker — Chris Legend of Shadows
   Strategy: Cache-first for static assets, network-first for
   Firebase API calls (which we never want to cache).
   ============================================================ */

const CACHE_NAME = "legends-v1";

/* Assets to pre-cache on install */
const PRECACHE = [
  "/",
  "/index.html",
  "/about.html",
  "/gallery.html",
  "/music.html",
  "/chat room.html",
  "/samiam.png",
  "/tam.png",
  "/wolf.png"
];

/* ── INSTALL ── */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

/* ── ACTIVATE — remove old caches ── */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
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
    url.includes("youtube.com")
  ){
    return; /* fall through to network */
  }

  /* Cache-first for everything else (HTML, images, CSS, JS) */
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
        /* Offline fallback for HTML navigation requests */
        if(event.request.mode === "navigate"){
          return caches.match("/index.html");
        }
      });
    })
  );
});
