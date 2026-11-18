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

// Notifications (shown by the game while it's open; a push handler too, in case a sending server is added): the
// game's icon; tapping one brings the game forward (an invitation opens its room).
self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { data: { body: event.data && event.data.text() } }; }
  const d = msg.data || {}, n = msg.notification || {};
  const title = d.title || n.title || "Bellmont City";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || n.body || "",
    // The friend's picture as the big image; the game's own badge as the small icon.
    icon: d.icon || "/icon-192.png",
    badge: "/badge-96.png",
    tag: d.tag || undefined,
    data: { link: d.link || "/" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("focus" in w) { await w.focus(); if (link !== "/" && "navigate" in w) await w.navigate(link).catch(() => {}); return; } }
    await self.clients.openWindow(link);
  })());
});
