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
// A player who opened the Android app in the last 30 days gets pushes only on it and on browsers on Windows.
// The checks read Firestore as the caller (their own token: the rules let a sender read what they sent), and the
// devices are kept in Workers KV (binding SUBS) — no Google service account involved.
// Broadcasts (a message to every player, in their language): scripts/broadcast.mjs writes KV "broadcast"
//   { id, title: { <lang>: … }, body: { <lang>: … }, link, at } through Cloudflare's API; the cron trigger (every
//   minute) sends it out a batch at a time (cursor kept in KV), skipping browsers of players who have an app.
//   GET /broadcast returns the latest one (the Windows app, which has no Web Push, checks it while running).
// POST /notify { type: "message", to, id }  (a chat message: read from chats/<pair>/messages/<id> to check it)
// POST /reply { token, text }  (an answer typed into a message notification on Android: the token, sent with that
//   notification, lets its player message that one friend; saved with the service account, then notified)
// POST /subscribe-fcm { token, lang }  (the Android app's Firebase Cloud Messaging token, passed in by the app)
// Android phones get notifications only through FCM (shown by the app itself); browser Web Push only reaches
// browsers on Windows (os: "windows").
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE_JWK, FCM_SERVICE_ACCOUNT (the Firebase project's service-account key JSON,
// added by hand in Cloudflare: it lets this worker send through FCM).

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
// (Only the Android app counts: the Windows app can't receive pushes, so Windows browsers keep getting them.)
const hasApp = async (env, uid) => { const t = (await appsOf(env, uid)).android; return typeof t === "number" && Date.now() - t < APP_DAYS * 864e5; };
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
  // (Phones: through FCM, shown by the app. Browsers: only on Windows.)
  const targets = subs.filter((s) => s.fcm || s.os === "windows");
  let sent = 0;
  await Promise.all(targets.map(async (s) => {
    if (s.fcm) {
      const data = typeof message === "function" ? message(s) : message;
      const r = await sendFcm(env, s.fcm, data).catch(() => "fail");
      if (r === "dead") dead.add(s.fcm); else if (r === "ok") sent++;
      return;
    }
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
  if (dead.size) await saveSubs(env, uid, subs.filter((s) => !dead.has(s.endpoint) && !dead.has(s.fcm)));
  return sent;
}

// ---------- Firebase Cloud Messaging (HTTP v1), signed in as the project's service account ----------
const PROJECT_FCM = "bellmont-city";
const SCOPE_FCM = "https://www.googleapis.com/auth/firebase.messaging", SCOPE_FS = "https://www.googleapis.com/auth/datastore";
const saAuth = {}; // scope → { token, exp }
async function fcmAccessToken(env, scope = SCOPE_FCM) {
  const fcmAuth = saAuth[scope];
  if (fcmAuth && fcmAuth.exp > Date.now() + 60e3) return fcmAuth.token;
  const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const enc64 = (o) => b64u(enc.encode(JSON.stringify(o)));
  const unsigned = `${enc64({ alg: "RS256", typ: "JWT" })}.${enc64({ iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${b64u(sig)}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("FCM sign-in failed");
  saAuth[scope] = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return saAuth[scope].token;
}
/** Sends one notification to one Android phone; "dead" if that phone's token is no longer valid. */
async function sendFcm(env, token, data) {
  if (!env.FCM_SERVICE_ACCOUNT) return "skip";
  const strings = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_FCM}/messages:send`, {
    method: "POST", headers: { Authorization: `Bearer ${await fcmAccessToken(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token, data: strings, android: { priority: "HIGH", ttl: "86400s" } } }),
  });
  if (res.ok) return "ok";
  const err = await res.text();
  return res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(err) ? "dead" : "fail";
}

// ---------- what can be announced (only what really just happened) ----------
const FRESH_MS = 3 * 60e3;
const SITE = "https://bellmont-city.web.app";
// The other player's picture (the big icon, made round on the device): theirs from Google or one of the game's (a
// site path); without one, the device draws their initial in a circle (`who`).
const pic = (p) => (typeof p === "string" && p ? (p.startsWith("/") ? SITE + p : p) : null);
// The words, in each device's language (TEXTS is added at deploy from the game's dictionaries; English otherwise).
const tr = (lang, text, ...args) => {
  const t = (typeof TEXTS !== "undefined" && TEXTS[lang]?.[text]) || text;
  return t.replace(/\{(\d)\}/g, (_, i) => args[Number(i)] ?? "");
};
const fresh = (at) => typeof at === "number" && Date.now() - at < FRESH_MS;
async function message(idToken, from, body) {
  const to = String(body.to ?? ""), type = body.type;
  if (!/^[A-Za-z0-9]{10,64}$/.test(to) || to === from) return null;
  if (type === "request") {
    const r = await getDoc(idToken, `friends/${to}/requests/${from}`);
    if (!r || !fresh(r.at)) return null;
    return { to, title: ["New friend request"], body: ["{0} wants to be your friend.", r.name, "Someone"], tag: `req-${from}`, link: "/", icon: pic(r.photo), who: r.name || "" };
  }
  if (type === "accepted") {
    const f = await getDoc(idToken, `friends/${to}/list/${from}`);
    if (!f || f.by !== from || !fresh(f.at)) return null;
    return { to, title: ["Friend request accepted"], body: ["{0} accepted your friend request.", f.name, "Your friend"], tag: `acc-${from}`, link: "/", icon: pic(f.photo), who: f.name || "" };
  }
  if (type === "invite") {
    const code = String(body.code ?? "");
    if (!/^[A-Z0-9]{6}$/.test(code)) return null;
    const i = await getDoc(idToken, `friends/${to}/invites/${code}`);
    if (!i || i.from !== from || !fresh(i.at)) return null;
    return { to, title: ["Room invitation"], body: ["{0} invited you to room {1}.", i.name, "A friend", code], tag: `inv-${code}`, link: `/?room=${code}`, icon: pic(i.photo), who: i.name || "" };
  }
  if (type === "message") {
    const id = String(body.id ?? "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return null;
    const m = await getDoc(idToken, `chats/${chatId(from, to)}/messages/${id}`);
    if (!m || m.from !== from || m.to !== to || !fresh(m.at) || typeof m.text !== "string") return null;
    const f = await getDoc(idToken, `friends/${to}/list/${from}`); // (still friends; their name and picture)
    if (!f) return null;
    return { chat: true, to, from, name: f.name || "", photo: f.photo, text: m.text };
  }
  return null;
}

// ---------- chat messages ----------
const chatId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
// (FCM data must stay under 4 KB: long messages are cut; the phone shows at most 6 lines anyway.)
const MSG_CHARS = 700;
// Who may answer from the notification: "<to>.<from>.<expiry>.<signature>" lets <to> send a message to <from>
// (signed with a key derived from this worker's own secret, so it can't be made up).
const REPLY_DAYS = 14;
async function replyKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`reply:${env.VAPID_PRIVATE_JWK}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function replyToken(env, to, from) {
  const head = `${to}.${from}.${Date.now() + REPLY_DAYS * 864e5}`;
  return `${head}.${b64u(await crypto.subtle.sign("HMAC", await replyKey(env), enc.encode(head)))}`;
}
async function checkReplyToken(env, token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 4) return null;
  const [to, from, exp, sig] = parts;
  if (!/^[A-Za-z0-9]{10,64}$/.test(to) || !/^[A-Za-z0-9]{10,64}$/.test(from) || !(Number(exp) > Date.now())) return null;
  let sigBytes; try { sigBytes = fromB64u(sig); } catch { return null; }
  const ok = await crypto.subtle.verify("HMAC", await replyKey(env), sigBytes, enc.encode(`${to}.${from}.${exp}`));
  return ok ? { me: to, friend: from } : null;
}
/** Tells `to` about a message from `from` (named `name`): their phones get it with a way to answer. */
async function pushChat(env, { to, from, name, photo, text }) {
  const reply = await replyToken(env, to, from);
  const short = text.length > MSG_CHARS ? `${text.slice(0, MSG_CHARS)}…` : text;
  return push(env, to, (sub) => ({
    title: tr(sub.lang, "Message from {0}", name || tr(sub.lang, "A friend")), body: short, tag: `msg-${from}`, link: `/?chat=${from}`,
    icon: pic(photo), who: name || "", ...(sub.fcm ? { kind: "msg", from, name: name || "", reply, you: tr(sub.lang, "You replied:"), more: tr(sub.lang, "more"), replyLabel: tr(sub.lang, "Reply") } : {}),
  }));
}
// Firestore as the project's service account (an answer sent from a notification has no player sign-in).
const fsVal = (v) => (typeof v === "number" ? { integerValue: String(Math.round(v)) } : v == null ? { nullValue: null } : { stringValue: String(v) });
async function adminGet(env, path) {
  const res = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${await fcmAccessToken(env, SCOPE_FS)}` } });
  if (!res.ok) return null;
  const d = await res.json(), out = {};
  for (const [k, v] of Object.entries(d.fields ?? {})) out[k] = val(v);
  return out;
}
async function adminAdd(env, path, data) {
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fsVal(v)]));
  const res = await fetch(`${FS}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${await fcmAccessToken(env, SCOPE_FS)}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
  return res.ok;
}
/** An answer typed into a message notification on an Android phone. */
async function replyFromNotification(env, body) {
  if (!env.FCM_SERVICE_ACCOUNT) return { error: "not set up", status: 503 };
  const who = await checkReplyToken(env, body?.token);
  if (!who) return { error: "unauthorized", status: 401 };
  const text = typeof body?.text === "string" ? body.text.slice(0, 65536) : "";
  if (!text.trim()) return { error: "empty", status: 400 };
  // (Only between friends: the friend's list must still have this player.)
  const me = await adminGet(env, `friends/${who.friend}/list/${who.me}`);
  if (!me) return { error: "not friends", status: 403 };
  if (!(await adminAdd(env, `chats/${chatId(who.me, who.friend)}/messages`, { from: who.me, to: who.friend, text, at: Date.now() }))) return { error: "could not save", status: 500 };
  await pushChat(env, { to: who.friend, from: who.me, name: me.name || "", photo: me.photo, text });
  return { ok: true, status: 200 };
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
    sent += await push(env, uid, (sub) => ({ title: pick(b.title, sub.lang), body: pick(b.body, sub.lang), tag: `news-${b.id}`, link: b.link ?? "/" }));
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
    if (request.method === "POST" && url.pathname === "/reply") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad request" }, 400, origin); }
      const r = await replyFromNotification(env, body).catch((e) => ({ error: String(e?.message ?? e), status: 500 }));
      return json(r, r.status, origin);
    }
    if (request.method !== "POST" || !["/notify", "/subscribe", "/subscribe-fcm", "/app", "/status"].includes(url.pathname)) return json({ error: "not found" }, 404, origin);
    const idToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let from;
    try { from = await verifyIdToken(idToken); } catch { return json({ error: "unauthorized" }, 401, origin); }
    let body;
    try { body = await request.json(); } catch { return json({ error: "bad request" }, 400, origin); }
    if (url.pathname === "/subscribe") {
      const { endpoint, p256dh, auth } = body ?? {};
      // (The Android app running inside Brave can't hand notifications to the app: that copy counts as a browser.)
      const brave = body?.browser === "brave";
      const app = !brave && (body?.app === "android" || body?.app === "windows") ? body.app : null;
      const lang = typeof body?.lang === "string" && /^[a-z]{2}$/.test(body.lang) ? body.lang : "en";
      if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || endpoint.length > 1000 || typeof p256dh !== "string" || typeof auth !== "string") return json({ error: "bad subscription" }, 400, origin);
      const all = await subsOf(env, from), before = all.find((s) => s.endpoint === endpoint);
      const subs = all.filter((s) => s.endpoint !== endpoint);
      // (The Android app shares the phone browser's subscription: once it's the app's, it stays the app's.)
      const os = body?.os === "windows" ? "windows" : null;
      subs.push({ endpoint, p256dh, auth, lang, at: Date.now(), ...(os ? { os } : {}), ...(!brave && (app || before?.app) ? { app: app ?? before.app } : {}) });
      await saveSubs(env, from, subs);
      if (app) await markApp(env, from, app);
      else if (brave && body?.app === "android") await markApp(env, from, "android"); // (they do have the app)
      return json({ ok: true }, 200, origin);
    }
    if (url.pathname === "/subscribe-fcm") {
      const token = body?.token;
      if (typeof token !== "string" || !/^[\w:-]{20,400}$/.test(token)) return json({ error: "bad token" }, 400, origin);
      const lang = typeof body?.lang === "string" && /^[a-z]{2}$/.test(body.lang) ? body.lang : "en";
      // (One phone, one player: if someone else signed in on it before, it stops getting theirs.)
      const owner = await env.SUBS.get(`fcm:${token}`);
      if (owner && owner !== from) await saveSubs(env, owner, (await subsOf(env, owner)).filter((s) => s.fcm !== token));
      const subs = (await subsOf(env, from)).filter((s) => s.fcm !== token);
      subs.push({ fcm: token, lang, app: "android", at: Date.now() });
      await saveSubs(env, from, subs);
      if (owner !== from) await env.SUBS.put(`fcm:${token}`, from);
      await markApp(env, from, "android");
      return json({ ok: true }, 200, origin);
    }
    if (url.pathname === "/app") { await markApp(env, from, body?.app); return json({ ok: true }, 200, origin); }
    if (url.pathname === "/status") return json({ hasApp: await hasApp(env, from) }, 200, origin);
    try {
      const m = await message(idToken, from, body);
      if (!m) return json({ sent: 0 }, 200, origin);
      if (m.chat) return json({ sent: await pushChat(env, m) }, 200, origin);
      // (title/body: [English text, name, fallback name if none, more args] → in each device's language)
      const words = (lang, [text, name, fallback, ...rest]) => tr(lang, text, name || (fallback ? tr(lang, fallback) : ""), ...rest);
      const sent = await push(env, m.to, (sub) => ({ title: words(sub.lang, m.title), body: words(sub.lang, m.body), tag: m.tag, link: m.link, icon: m.icon, who: m.who }));
      return json({ sent }, 200, origin);
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 500, origin);
    }
  },
};
