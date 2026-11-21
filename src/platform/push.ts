// Notifications (friend requests, accepted requests, room invitations):
//  • closed or open, by Web Push: each device registers with the game's sender (a free Cloudflare Worker,
//    push-worker/), and whoever asks, accepts or invites tells the sender, which checks it and pushes to the other
//    player's devices;
//  • while the game is open, the friend lists are also watched here (same tags, so one notification shows).
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { auth, firestore } from "./firebase";
import { appKind, browserNotifications, fcmToken } from "@/lib/appKind";
import { currentLang, tr } from "@/i18n";
import { inAppToast } from "@/lib/inAppToast";

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
/** This device gets the signed-in player's notifications, even with the game closed (when they're allowed). */
export async function registerDevice() {
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
/** Whether this page shows notifications itself: only on Windows (the Android app gets its own from the server). */
async function mayNotifyHere(): Promise<boolean> {
  const app = appKind();
  if (app) void callServer("/app", { app });
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
async function showNow(title: string, body: string, tag: string, link = "/", photo?: unknown, who?: string, asTyped = false) {
  const inApp = appKind() === "windows";
  if (pushPermission() !== "granted" && !inApp) return;
  const pic = typeof photo === "string" && photo ? photo : null;
  title = tr(title); if (!asTyped) body = tr(body); // (in the game's language; a player's message stays as typed)
  const icon = who !== undefined ? await roundIcon(pic, who || "?") : undefined;
  // The Windows app is always full screen, and Windows doesn't pop notifications up over full-screen apps: the game
  // shows them in its own window too (the Windows one still goes to the notification centre).
  if (inApp) { inAppToast(title, body, tag, icon, link); if (pushPermission() !== "granted") return; }
  // (The Windows app shows nothing from service-worker notifications: it uses the plain kind below, which it turns
  // into Windows notifications.)
  if (appKind() !== "windows") try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (reg) { await reg.showNotification(title, { body, tag, ...(icon ? { icon } : {}), badge: "/badge-96.png", data: { link } }); return; }
  } catch { /* (then a plain one below) */ }
  try {
    const n = new Notification(title, { body, tag, ...(icon ? { icon } : {}) });
    // (In the Windows app, ?app-show=1 brings the window back from the tray.)
    n.onclick = () => { window.focus(); if (appKind() === "windows") location.href = `${link}${link.includes("?") ? "&" : "?"}app-show=1`; else if (link !== "/") location.href = link; };
  } catch { /* (Nothing shown: the menu's badges still say so.) */ }
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
  const show = (...a: Parameters<typeof showNow>) => { if (allowed) void showNow(...a); };
  // The Windows app has no Web Push: it checks for news sent to everyone (broadcasts) every few minutes.
  let poll: ReturnType<typeof setInterval> | undefined;
  if (appKind() === "windows") { void checkBroadcast(); poll = setInterval(() => void checkBroadcast(), 3 * 60e3); }
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
    entry.stop = onSnapshot(query(collection(firestore, "chats", pairId(me.id, friend), "messages"), where("at", ">", since)), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data();
      if (c.type !== "added" || d["to"] !== me.id || c.doc.metadata.hasPendingWrites) return;
      if (chatOpen === friend && document.visibilityState === "visible") return;
      const text = String(d["text"] ?? "");
      show(`Message from ${entry.name || "A friend"}`, text.length > 300 ? `${text.slice(0, 300)}…` : text, `msg-${friend}`, `/?chat=${friend}`, entry.photo, entry.name, true);
    }), () => {});
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
    void showNow(pick(b.title), pick(b.body), `news-${b.id}`, b.link ?? "/");
  } catch { /* (offline: next time) */ }
}
