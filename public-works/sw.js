// Offline support for Mumbai Public Works. Pages and data are served from the network when
// online (so they are always current) and from the last saved copy when offline.
const CACHE = "pw-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ok = url.origin === location.origin || /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host);
  if (!ok) return;
  e.respondWith(fetch(req).then((res) => {
    if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : undefined))));
});
