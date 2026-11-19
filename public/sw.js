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

// Notifications: the game's skyline as the small icon; a big picture only when another player is involved — theirs,
// made round (or their initial in a circle). Tapping one brings the game forward (an invitation opens its room).
async function roundIcon(url, who) {
  const S = 192;
  try {
    const c = new OffscreenCanvas(S, S), g = c.getContext("2d");
    g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.closePath(); g.clip();
    if (url) {
      const res = await fetch(url, { mode: "cors", referrerPolicy: "no-referrer" });
      const img = await createImageBitmap(await res.blob());
      const k = Math.max(S / img.width, S / img.height);
      g.drawImage(img, (S - img.width * k) / 2, (S - img.height * k) / 2, img.width * k, img.height * k);
    } else {
      const name = String(who || "?"), hue = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
      g.fillStyle = `hsl(${hue} 55% 42%)`; g.fillRect(0, 0, S, S);
      g.fillStyle = "#fff"; g.font = "800 92px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText((name[0] || "?").toUpperCase(), S / 2, S / 2 + 4);
    }
    const blob = await c.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(bin)}`;
  } catch { return url || undefined; }
}
self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { data: { body: event.data && event.data.text() } }; }
  const d = msg.data || {}, n = msg.notification || {};
  const title = d.title || n.title || "Bellmont City";
  event.waitUntil((async () => {
    const icon = d.icon || d.who ? await roundIcon(d.icon, d.who) : undefined;
    await self.registration.showNotification(title, {
      body: d.body || n.body || "",
      ...(icon ? { icon } : {}),
      badge: "/badge-96.png",
      tag: d.tag || undefined,
      data: { link: d.link || "/" },
    });
  })());
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
