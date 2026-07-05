// ViralEdit AI service worker — hand-written, not next-pwa.
//
// Why hand-written: the app already hit one bundler landmine with
// @ffmpeg/ffmpeg's worker (Turbopack rewrote its dynamic import and broke
// FFmpeg entirely — see ffmpeg-client.ts). A generic PWA plugin auto-
// generating a service worker risks the same class of bug by trying to be
// clever about what it precaches. This SW is explicit about every strategy.
//
// Strategies, matched by request:
//   /ffmpeg/**            cache-first  — the WASM core + lib are large,
//                                        static, and versioned by CACHE_NAME
//   /icons/**, manifest    cache-first  — static app assets
//   /_next/static/**       stale-while-revalidate — hashed per build, so we
//                                        can't know filenames ahead of time;
//                                        cache opportunistically as visited
//   navigations (HTML)     network-first, falling back to cache, falling
//                                        back to a minimal offline page
//   /api/**                 network-only — never cache; each page already
//                                        handles fetch failures explicitly
//   everything else         stale-while-revalidate

const CACHE_NAME = "viraledit-v1";

const PRECACHE_URLS = [
  "/",
  "/home",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/ffmpeg/ffmpeg-core.js",
  "/ffmpeg/ffmpeg-core.wasm",
  "/ffmpeg/lib/index.js",
  "/ffmpeg/lib/classes.js",
  "/ffmpeg/lib/const.js",
  "/ffmpeg/lib/errors.js",
  "/ffmpeg/lib/types.js",
  "/ffmpeg/lib/utils.js",
  "/ffmpeg/lib/worker.js",
];

const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — ViralEdit AI</title>
<style>
  body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
    background:#0d0d0d;color:#f5f5f5;font-family:Arial,sans-serif;text-align:center;padding:24px}
  .card{max-width:320px}
  h1{font-size:20px;margin:0 0 8px}
  p{color:#8a8a8a;font-size:14px;line-height:1.5;margin:0}
  .dot{width:8px;height:8px;border-radius:50%;background:#ff5c35;display:inline-block;margin-bottom:16px}
</style></head><body><div class="card">
  <span class="dot"></span>
  <h1>You're offline</h1>
  <p>Editing and rendering still work fully offline once loaded — but this page hasn't been visited yet on this device. Reconnect once to cache it.</p>
</div></body></html>`;

self.__debugLog = [];

async function addWithRetry(cache, url, attempts = 2) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
      await cache.put(url, res);
      return true;
    } catch (e) {
      self.__debugLog.push(`${url} attempt ${i + 1}: ${e}`);
    }
  }
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // small assets: fine in parallel
      const small = PRECACHE_URLS.filter((u) => !u.endsWith(".wasm"));
      await Promise.all(small.map((url) => addWithRetry(cache, url)));
      // the wasm core: alone, so it isn't starved by the other requests
      const large = PRECACHE_URLS.filter((u) => u.endsWith(".wasm"));
      for (const url of large) await addWithRetry(cache, url, 3);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => undefined);
  return cached ?? (await network) ?? new Response("", { status: 504 });
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html" }, status: 200 });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // POST (uploads, /api calls) always network

  const url = new URL(req.url);
  if (url.pathname === "/sw-debug") {
    event.respondWith(new Response(JSON.stringify(self.__debugLog), { headers: { "Content-Type": "application/json" } }));
    return;
  }
  if (url.origin !== self.location.origin) return; // cross-origin: leave alone

  if (url.pathname.startsWith("/api/")) return; // network-only, no interception

  if (
    url.pathname.startsWith("/ffmpeg/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/sfx/")
  ) {
    // /sfx/** are the bundled transition sound effects — static and small;
    // cache-first so they're available offline after the first render.
    event.respondWith(cacheFirst(req));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});
