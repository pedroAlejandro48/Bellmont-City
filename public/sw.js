// Bellmont City's service worker: makes the site installable as an app (Android browsers want one with a fetch
// handler). It never serves stale code: everything comes from the network, and only when offline does a page load
// fall back to the last copy of the start page.
const PAGE_CACHE = "bellmont-page-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== PAGE_CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) { const cache = await caches.open(PAGE_CACHE); await cache.put("/", response.clone()); }
      return response;
    } catch {
      return (await caches.match("/")) ?? new Response("Bellmont City needs an internet connection.", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  })());
});
