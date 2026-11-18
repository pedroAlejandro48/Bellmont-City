// Bellmont City's notification sender (a Cloudflare Worker, free plan): the game asks it to tell a player that
// someone sent them a friend request, accepted theirs, or invited them to a room; it checks that really happened
// (in Firestore), then sends a Web Push notification to each phone/computer that player registered — so it arrives
// even with the game closed. Deployed by scripts/deploy-push.sh.
//
// POST /notify  { type: "request" | "accepted" | "invite", to: <uid>, code?: <room> }
//   Authorization: Bearer <the sender's Firebase ID token>
// POST /subscribe { endpoint, p256dh, auth, app? }  (a device registering for its player's notifications;
//   app: "android" | "windows" when it's one of the game's apps)
// POST /app { app }  (the player opened one of the apps)    POST /status → { hasApp }
// A player who opened an app in the last 30 days gets pushes only on their app devices, not in browsers.
// The checks read Firestore as the caller (their own token: the rules let a sender read what they sent), and the
// devices are kept in Workers KV (binding SUBS) — no Google service account involved.
// Broadcasts (a message to every player, in their language): scripts/broadcast.mjs writes KV "broadcast"
//   { id, title: { <lang>: … }, body: { <lang>: … }, link, at } through Cloudflare's API; the cron trigger (every
//   minute) sends it out a batch at a time (cursor kept in KV), skipping browsers of players who have an app.
//   GET /broadcast returns the latest one (the Windows app, which has no Web Push, checks it while running).
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE_JWK.

const PROJECT = "bellmont-city";
const ORIGINS = ["https://bellmont-city.web.app", "https://bellmont-city.firebaseapp.com", "http://localhost:5173", "http://127.0.0.1:4181", "http://127.0.0.1:4182"];
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const enc = new TextEncoder();

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const json = (body, status, origin) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
const cors = (origin) => (ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" } : {});

// ---------- who's asking: their Firebase ID token ----------
let jwks = null, jwksAt = 0;
async function verifyIdToken(token) {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new Error("bad token");
  const header = JSON.parse(new TextDecoder().decode(fromB64u(h))), payload = JSON.parse(new TextDecoder().decode(fromB64u(p)));
  if (!jwks || Date.now() - jwksAt > 3600e3) {
    jwks = (await (await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")).json()).keys; jwksAt = Date.now();
  }
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== "RS256") throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64u(s), enc.encode(`${h}.${p}`));
  const now = Date.now() / 1000;
  if (!ok || payload.aud !== PROJECT || payload.iss !== `https://securetoken.google.com/${PROJECT}` || payload.exp < now || !payload.sub) throw new Error("invalid token");
  return payload.sub;
}

// ---------- reading Firestore as the caller ----------
const val = (f) => (f ? f.stringValue ?? (f.integerValue !== undefined ? Number(f.integerValue) : f.doubleValue) : undefined);
async function getDoc(idToken, path) {
  const res = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!res.ok) return null;
  const d = await res.json(), out = {};
  for (const [k, v] of Object.entries(d.fields ?? {})) out[k] = val(v);
  return out;
}

// ---------- each player's devices (Workers KV) ----------
const subsOf = async (env, uid) => { try { return JSON.parse((await env.SUBS.get(`subs:${uid}`)) ?? "[]"); } catch { return []; } };
const saveSubs = (env, uid, subs) => (subs.length ? env.SUBS.put(`subs:${uid}`, JSON.stringify(subs.slice(-10))) : env.SUBS.delete(`subs:${uid}`));

// Which apps a player has opened, and when ({ android?: ms, windows?: ms }).
const APP_DAYS = 30;
const appsOf = async (env, uid) => { try { return JSON.parse((await env.SUBS.get(`app:${uid}`)) ?? "{}"); } catch { return {}; } };
const hasApp = async (env, uid) => Object.values(await appsOf(env, uid)).some((t) => typeof t === "number" && Date.now() - t < APP_DAYS * 864e5);
async function markApp(env, uid, app) {
  if (app !== "android" && app !== "windows") return;
  const apps = await appsOf(env, uid);
  if (typeof apps[app] === "number" && Date.now() - apps[app] < 864e5) return; // (once a day is enough)
  await env.SUBS.put(`app:${uid}`, JSON.stringify({ ...apps, [app]: Date.now() }));
}

// ---------- Web Push (RFC 8291 aes128gcm, VAPID RFC 8292) ----------
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}
async function encrypt(sub, payload) {
  const uaPublic = fromB64u(sub.p256dh), authSecret = fromB64u(sub.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}
async function vapid(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://bellmont-city.web.app" })));
  const sig = b64u(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${sig}, k=${env.VAPID_PUBLIC}`;
}
async function push(env, uid, message) {
  const subs = await subsOf(env, uid), dead = new Set();
  // (With an app, only its devices: no second notification from a browser.)
  const targets = (await hasApp(env, uid)) ? subs.filter((s) => s.app) : subs;
  let sent = 0;
  await Promise.all(targets.map(async (s) => {
    if (!s.endpoint || !s.p256dh || !s.auth) return;
    try {
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: { Authorization: await vapid(env, s.endpoint), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" },
        body: await encrypt(s, JSON.stringify({ data: typeof message === "function" ? message(s) : message })),
      });
      if (res.status === 404 || res.status === 410) dead.add(s.endpoint);
      else if (res.ok) sent++;
    } catch { /* (one device failing doesn't stop the others) */ }
  }));
  if (dead.size) await saveSubs(env, uid, subs.filter((s) => !dead.has(s.endpoint)));
  return sent;
}

// ---------- what can be announced (only what really just happened) ----------
const FRESH_MS = 3 * 60e3;
const SITE = "https://bellmont-city.web.app";
// The friend's picture (the big icon): theirs from Google, one of the game's (a site path), or the game's icon.
const pic = (p) => (typeof p === "string" && p ? (p.startsWith("/") ? SITE + p : p) : `${SITE}/icon-192.png`);
const fresh = (at) => typeof at === "number" && Date.now() - at < FRESH_MS;
async function message(idToken, from, body) {
  const to = String(body.to ?? ""), type = body.type;
  if (!/^[A-Za-z0-9]{10,64}$/.test(to) || to === from) return null;
  if (type === "request") {
    const r = await getDoc(idToken, `friends/${to}/requests/${from}`);
    if (!r || !fresh(r.at)) return null;
    return { to, title: "New friend request", body: `${r.name || "Someone"} wants to be your friend.`, tag: `req-${from}`, link: "/", icon: pic(r.photo) };
  }
  if (type === "accepted") {
    const f = await getDoc(idToken, `friends/${to}/list/${from}`);
    if (!f || f.by !== from || !fresh(f.at)) return null;
    return { to, title: "Friend request accepted", body: `${f.name || "Your friend"} accepted your friend request.`, tag: `acc-${from}`, link: "/", icon: pic(f.photo) };
  }
  if (type === "invite") {
    const code = String(body.code ?? "");
    if (!/^[A-Z0-9]{6}$/.test(code)) return null;
    const i = await getDoc(idToken, `friends/${to}/invites/${code}`);
    if (!i || i.from !== from || !fresh(i.at)) return null;
    return { to, title: "Room invitation", body: `${i.name || "A friend"} invited you to room ${code}.`, tag: `inv-${code}`, link: `/?room=${code}`, icon: pic(i.photo) };
  }
  return null;
}

// ---------- broadcasts ----------
const BATCH = 20; // players per run (the free plan allows 50 outgoing requests per run)
const currentBroadcast = async (env) => { try { return JSON.parse((await env.SUBS.get("broadcast")) ?? "null"); } catch { return null; } };
const pick = (texts, lang) => (texts && (texts[lang] || texts.en)) || "";
async function sendBroadcast(env) {
  const b = await currentBroadcast(env);
  if (!b || b.done || !b.id) return;
  const page = await env.SUBS.list({ prefix: "subs:", limit: BATCH, ...(b.cursor ? { cursor: b.cursor } : {}) });
  let sent = 0;
  for (const k of page.keys) {
    const uid = k.name.slice(5);
    sent += await push(env, uid, (sub) => ({ title: pick(b.title, sub.lang), body: pick(b.body, sub.lang), tag: `news-${b.id}`, link: b.link ?? "/", icon: `${SITE}/icon-192.png` }));
  }
  const next = page.list_complete ? { ...b, cursor: null, done: true } : { ...b, cursor: page.cursor };
  next.sent = (b.sent ?? 0) + sent;
  await env.SUBS.put("broadcast", JSON.stringify(next));
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(sendBroadcast(env)); },
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return json({ ok: true, service: "bellmont-push" }, 200, origin);
    if (request.method === "GET" && url.pathname === "/broadcast") {
      const b = await currentBroadcast(env);
      return json(b ? { id: b.id, title: b.title, body: b.body, link: b.link ?? "/", at: b.at } : {}, 200, origin);
    }
    if (request.method !== "POST" || !["/notify", "/subscribe", "/app", "/status"].includes(url.pathname)) return json({ error: "not found" }, 404, origin);
    const idToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let from;
    try { from = await verifyIdToken(idToken); } catch { return json({ error: "unauthorized" }, 401, origin); }
    let body;
    try { body = await request.json(); } catch { return json({ error: "bad request" }, 400, origin); }
    if (url.pathname === "/subscribe") {
      const { endpoint, p256dh, auth } = body ?? {};
      const app = body?.app === "android" || body?.app === "windows" ? body.app : null;
      const lang = typeof body?.lang === "string" && /^[a-z]{2}$/.test(body.lang) ? body.lang : "en";
      if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || endpoint.length > 1000 || typeof p256dh !== "string" || typeof auth !== "string") return json({ error: "bad subscription" }, 400, origin);
      const all = await subsOf(env, from), before = all.find((s) => s.endpoint === endpoint);
      const subs = all.filter((s) => s.endpoint !== endpoint);
      // (The Android app shares the phone browser's subscription: once it's the app's, it stays the app's.)
      subs.push({ endpoint, p256dh, auth, lang, at: Date.now(), ...(app || before?.app ? { app: app ?? before.app } : {}) });
      await saveSubs(env, from, subs);
      if (app) await markApp(env, from, app);
      return json({ ok: true }, 200, origin);
    }
    if (url.pathname === "/app") { await markApp(env, from, body?.app); return json({ ok: true }, 200, origin); }
    if (url.pathname === "/status") return json({ hasApp: await hasApp(env, from) }, 200, origin);
    try {
      const m = await message(idToken, from, body);
      if (!m) return json({ sent: 0 }, 200, origin);
      const sent = await push(env, m.to, { title: m.title, body: m.body, tag: m.tag, link: m.link, icon: m.icon });
      return json({ sent }, 200, origin);
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 500, origin);
    }
  },
};
