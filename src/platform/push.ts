// Notifications (friend requests, accepted requests, room invitations):
//  • closed or open, by Web Push: each device registers with the game's sender (a free Cloudflare Worker,
//    push-worker/), and whoever asks, accepts or invites tells the sender, which checks it and pushes to the other
//    player's devices;
//  • while the game is open, the friend lists are also watched here (same tags, so one notification shows).
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { auth, firestore } from "./firebase";
import { appKind, backgroundPage, browserNotifications, fcmToken } from "@/lib/appKind";
import { currentLang, tr } from "@/i18n";
import { inAppToast, removeInAppToast } from "@/lib/inAppToast";

const PUSH_SERVER = "https://bellmont-push.bellmont-city.workers.dev";
/** The sender's public key (VAPID): browsers only accept pushes signed with its private half. */
const VAPID_PUBLIC = "BOB7fonjss3ZQWb6-u5HpvQPbh-zFXQStPr_z-vuwoXPRqgdQlgY0qLEHjcPH9qXeEVrfXfVSJtXdiGaNSBG3Sc";
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64u = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "");

async function callServer(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (!token) return null;
  const res = await fetch(`${PUSH_SERVER}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => null);
  return res?.ok ? await res.json().catch(() => null) as Record<string, unknown> | null : null;
}
// Settings → Notifications: on or off on this device (on by default). Off: this device is taken off the sender's list
// and the game shows none here (no cards, no Windows notifications); on again: registered again.
const NOTIFY_KEY = "bellmont-notify";
export const notificationsOn = () => { try { return localStorage.getItem(NOTIFY_KEY) !== "off"; } catch { return true; } };
/** Whether this device can get notifications at all (the apps, or a browser on Windows). */
export const notificationsHere = () => !!appKind() || browserNotifications();
export async function setNotificationsOn(on: boolean) {
  try { localStorage.setItem(NOTIFY_KEY, on ? "on" : "off"); } catch { /* */ }
  if (on) { if (pushPermission() === "default") await enablePush(); await registerDevice(); }
  else await unregisterDevice();
}
async function unregisterDevice() {
  if (appKind() === "android") { const token = fcmToken(); if (token) await callServer("/unsubscribe", { fcm: token }); return; }
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) { await callServer("/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
  } catch { /* */ }
}

/** This device gets the signed-in player's notifications, even with the game closed (when they're allowed). */
export async function registerDevice() {
  if (!notificationsOn()) { await unregisterDevice(); return; }
  // The Android app: its own notifications (Firebase Cloud Messaging), to this phone's token.
  if (appKind() === "android") { const token = fcmToken(); if (token) await callServer("/subscribe-fcm", { token, lang: currentLang() }); return; }
  // Other browsers than on Windows: no browser notifications (an old registration here is dropped).
  if (!browserNotifications()) {
    try { const reg = await navigator.serviceWorker?.getRegistration("/"); await (await reg?.pushManager?.getSubscription())?.unsubscribe(); } catch { /* */ }
    return;
  }
  if (pushPermission() !== "granted" || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/") ?? await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(VAPID_PUBLIC) });
    await callServer("/subscribe", { endpoint: sub.endpoint, p256dh: b64u(sub.getKey("p256dh")), auth: b64u(sub.getKey("auth")), app: appKind(), lang: currentLang(), os: "windows" });
  } catch { /* (Then only while the game is open.) */ }
}
/** Tells the other player (the sender checks it really happened). */
export const notifyPlayer = (type: "request" | "accepted" | "invite", to: string, code?: string) => void callServer("/notify", { type, to, ...(code ? { code } : {}) });
/** Tells a friend about a chat message (the sender reads it from the chat to check it's really from this player). */
export const notifyMessage = (to: string, id: string) => void callServer("/notify", { type: "message", to, id });
/** Takes an unsent message out of the friend's notification (the sender checks it's really gone). */
export const notifyUnsend = (to: string, id: string) => void callServer("/notify", { type: "unsend", to, id });
/** This player opened their chat with `friend`: that chat's notifications go from their other devices (phones). */
export const notifySeen = (friend: string) => void callServer("/notify", { type: "seen", to: friend });
/** Whether this page shows notifications itself: only on Windows (the Android app gets its own from the server). */
async function mayNotifyHere(): Promise<boolean> {
  const app = appKind();
  if (app && !backgroundPage()) void callServer("/app", { app });
  // (The Windows app: only its hidden listener shows them, never the game's window too.)
  if (app === "windows") return true; // (the game's window: cards; the hidden listener: Windows notifications)
  return browserNotifications();
}
import type { Account } from "./account";

export const pushPermission = (): NotificationPermission | "unsupported" => (!browserNotifications() || typeof Notification === "undefined" || !("serviceWorker" in navigator) ? "unsupported" : Notification.permission);

/** Asks for permission to show notifications (needs a tap). */
export async function enablePush(): Promise<NotificationPermission | "unsupported"> {
  if (pushPermission() === "unsupported") return "unsupported";
  if (Notification.permission === "default") return Notification.requestPermission();
  return Notification.permission;
}

/** The other player's picture made round (or their initial in a circle), as an image the notification can show. */
async function roundIcon(photo: string | null, who: string): Promise<string | undefined> {
  const S = 192, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  if (!g) return photo ?? undefined;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.closePath(); g.clip();
  try {
    if (photo) {
      const img = new Image(); img.crossOrigin = "anonymous"; img.referrerPolicy = "no-referrer"; img.src = photo;
      await img.decode();
      const k = Math.max(S / img.naturalWidth, S / img.naturalHeight);
      g.drawImage(img, (S - img.naturalWidth * k) / 2, (S - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
    } else {
      const hue = [...who].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
      g.fillStyle = `hsl(${hue} 55% 42%)`; g.fillRect(0, 0, S, S);
      g.fillStyle = "#fff"; g.font = "800 92px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText((who[0] ?? "?").toUpperCase(), S / 2, S / 2 + 4);
    }
    return c.toDataURL("image/png");
  } catch { return photo ?? undefined; }
}

// (The small status-bar icon is the game's badge; a big picture only when another player is involved: theirs, round.)
/** Notifications shown by this page, by tag (so a chat's can be taken away once it's read). */
const shown = new Map<string, Notification>();

/** The Windows app's bridge (desktop/preload.js), when the page runs inside it. */
type AppBridge = { notify: (n: { tag: string; title: string; body: string; icon?: string | undefined; link: string; reply?: string | undefined }) => void; close: (tag: string) => void; gameFocused: () => boolean };
export const appBridge = (): AppBridge | null => (typeof window !== "undefined" ? (window as unknown as { bellmontApp?: AppBridge }).bellmontApp ?? null : null);

// `reply`: for a chat message, the friend's id (the Windows app collects their new messages in one notification).
async function showNow(title: string, body: string, tag: string, link = "/", photo?: unknown, who?: string, asTyped = false, reply?: string) {
  const app = appKind() === "windows";
  if (!app && pushPermission() !== "granted") return;
  const pic = typeof photo === "string" && photo ? photo : null;
  title = tr(title); if (!asTyped) body = tr(body); // (in the game's language; a player's message stays as typed)
  const icon = who !== undefined ? await roundIcon(pic, who || "?") : undefined;
  if (app) {
    // The Windows app: the game's window shows a card in its corner; the hidden listener a Windows notification
    // (through the app) — unless the game is in front, showing the card.
    if (!backgroundPage()) { inAppToast(title, body, tag, icon, link); return; }
    const bridge = appBridge();
    if (bridge) { if (!bridge.gameFocused()) bridge.notify({ tag, title, body, icon, link, reply }); return; }
    if (pushPermission() !== "granted") return;
  } else try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (reg) { await reg.showNotification(title, { body, tag, ...(icon ? { icon } : {}), badge: "/badge-96.png", data: { link } }); return; }
  } catch { /* (then a plain one below) */ }
  try {
    shown.get(tag)?.close();
    const n = new Notification(title, { body, tag, ...(icon ? { icon } : {}) });
    shown.set(tag, n);
    n.onclose = () => { if (shown.get(tag) === n) shown.delete(tag); };
    // (The Windows app's hidden page asks the app to open the game there.)
    n.onclick = () => { if (backgroundPage()) location.href = `/?app-open=${encodeURIComponent(link)}`; else { window.focus(); if (link !== "/") location.href = link; } };
  } catch { /* (Nothing shown: the menu's badges still say so.) */ }
}

/** Takes away the notification of a chat that has been read (here, and the browser's own on this device). */
async function clearShown(tag: string) {
  shown.get(tag)?.close(); shown.delete(tag);
  removeInAppToast(tag); appBridge()?.close(tag);
  try { const reg = await navigator.serviceWorker?.getRegistration("/"); for (const n of (await reg?.getNotifications({ tag })) ?? []) n.close(); } catch { /* */ }
}

/** The friend whose chat is open on screen (their messages then need no notification here). */
let chatOpen: string | null = null;
export const setOpenChat = (uid: string | null) => { chatOpen = uid; };
const pairId = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Watches for new requests, accepted requests, invitations and chat messages (only ones that arrive from now on). */
export function watchNotifications(me: Account) {
  const since = Date.now() - 5000;
  // (Decided once; until the sender answers, nothing is shown — anything arriving in that moment is old anyway.)
  let allowed = false;
  void mayNotifyHere().then((ok) => { allowed = ok; });
  const show = (...a: Parameters<typeof showNow>) => { if (allowed && notificationsOn()) void showNow(...a); };
  // The Windows app has no Web Push: it checks for news sent to everyone (broadcasts) every few minutes.
  let poll: ReturnType<typeof setInterval> | undefined;
  if (backgroundPage()) { void checkBroadcast(); poll = setInterval(() => void checkBroadcast(), 3 * 60e3); }
  const fresh = (at: unknown) => typeof at === "number" && at > since;
  const chats = new Map<string, { name: string; photo: unknown; stop: () => void }>();
  const base = (name: string) => collection(firestore, "friends", me.id, name);
  const stops = [
    onSnapshot(base("requests"), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data();
      if (c.type === "added" && fresh(d["at"])) show("New friend request", `${d["name"] || "Someone"} wants to be your friend.`, `req-${c.doc.id}`, "/", d["photo"], String(d["name"] ?? ""));
    }), () => {}),
    onSnapshot(base("list"), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data();
      watchMessages(c.doc.id, c.type === "removed" ? null : String(d["name"] ?? ""), d["photo"]);
      if (c.type === "added" && fresh(d["at"]) && d["by"] && d["by"] !== me.id) show("Friend request accepted", `${d["name"] || "Your friend"} accepted your friend request.`, `acc-${c.doc.id}`, "/", d["photo"], String(d["name"] ?? ""));
    }), () => {}),
    onSnapshot(base("invites"), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data();
      if (c.type === "added" && fresh(d["at"])) show("Room invitation", `${d["name"] || "A friend"} invited you to room ${c.doc.id}.`, `inv-${c.doc.id}`, `/?room=${c.doc.id}`, d["photo"], String(d["name"] ?? ""));
    }), () => {}),
  ];
  return () => { stops.forEach((f) => f()); chats.forEach((c) => c.stop()); if (poll) clearInterval(poll); };

  // New chat messages from each friend (the Windows app has no push: this is how it hears about them while open).
  function watchMessages(friend: string, name: string | null, photo: unknown) {
    const had = chats.get(friend);
    if (name === null) { had?.stop(); chats.delete(friend); return; }
    if (had) { had.name = name; had.photo = photo; return; }
    const entry = { name, photo, stop: () => {} };
    const pair = pairId(me.id, friend), seenRef = doc(firestore, "chats", pair, "seen", me.id);
    let seenAt = 0;
    const stopMsgs = onSnapshot(query(collection(firestore, "chats", pair, "messages"), where("at", ">", since)), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data(), at = Number(d["at"] ?? 0);
      if (c.type !== "added" || d["to"] !== me.id || c.doc.metadata.hasPendingWrites) return;
      if (chatOpen === friend && document.visibilityState === "visible") return;
      const text = String(d["text"] ?? "");
      // Only while the chat is closed everywhere: a moment later, if it was seen (open on some device), nothing.
      window.setTimeout(() => void getDoc(seenRef).then((sn) => {
        if (Math.max(seenAt, Number(sn.data()?.["at"] ?? 0)) >= at || Number(sn.data()?.["open"] ?? 0) > Date.now()) return;
        show(`Message from ${entry.name || "A friend"}`, text.length > 300 ? `${text.slice(0, 300)}…` : text, `msg-${friend}`, `/?chat=${friend}`, entry.photo, entry.name, true, friend);
      }).catch(() => {}), 500);
    }), () => {});
    // The chat read (opened on any device): its notification goes.
    const stopSeen = onSnapshot(seenRef, (sn) => {
      const at = Number(sn.data()?.["at"] ?? 0);
      if (at > seenAt) { if (seenAt) void clearShown(`msg-${friend}`); seenAt = at; }
    }, () => {});
    entry.stop = () => { stopMsgs(); stopSeen(); };
    chats.set(friend, entry);
  }
}

const SEEN = "bellmont-news-seen";
/** The latest broadcast, in this player's language, if it's new here and less than a day old. */
async function checkBroadcast() {
  try {
    const b = await (await fetch(`${PUSH_SERVER}/broadcast`)).json() as { id?: string; title?: Record<string, string>; body?: Record<string, string>; link?: string; at?: number };
    if (!b.id || !b.at || Date.now() - b.at > 864e5 || localStorage.getItem(SEEN) === b.id) return;
    localStorage.setItem(SEEN, b.id);
    const lang = currentLang(), pick = (t?: Record<string, string>) => (t?.[lang] || t?.["en"] || "");
    if (notificationsOn()) void showNow(pick(b.title), pick(b.body), `news-${b.id}`, b.link ?? "/");
  } catch { /* (offline: next time) */ }
}
