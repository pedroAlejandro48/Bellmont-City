// Notifications (friend requests, accepted requests, room invitations):
//  • closed or open, by Web Push: each device registers with the game's sender (a free Cloudflare Worker,
//    push-worker/), and whoever asks, accepts or invites tells the sender, which checks it and pushes to the other
//    player's devices;
//  • while the game is open, the friend lists are also watched here (same tags, so one notification shows).
import { collection, onSnapshot } from "firebase/firestore";
import { auth, firestore } from "./firebase";
import { appKind } from "@/lib/appKind";
import { currentLang } from "@/i18n";

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
  if (pushPermission() !== "granted" || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/") ?? await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(VAPID_PUBLIC) });
    await callServer("/subscribe", { endpoint: sub.endpoint, p256dh: b64u(sub.getKey("p256dh")), auth: b64u(sub.getKey("auth")), app: appKind(), lang: currentLang() });
  } catch { /* (Then only while the game is open.) */ }
}
/** Tells the other player (the sender checks it really happened). */
export const notifyPlayer = (type: "request" | "accepted" | "invite", to: string, code?: string) => void callServer("/notify", { type, to, ...(code ? { code } : {}) });
/**
 * Whether this page may show notifications: always inside the apps (each opening tells the sender this player has
 * one); in a browser only if the player has no app (one opened in the last 30 days) — then the app gets them.
 */
async function mayNotifyHere(): Promise<boolean> {
  const app = appKind();
  if (app) { void callServer("/app", { app }); return true; }
  const r = await callServer("/status", {});
  return !(r && r["hasApp"] === true);
}
import type { Account } from "./account";

export const pushPermission = (): NotificationPermission | "unsupported" => (typeof Notification === "undefined" || !("serviceWorker" in navigator) ? "unsupported" : Notification.permission);

/** Asks for permission to show notifications (needs a tap). */
export async function enablePush(): Promise<NotificationPermission | "unsupported"> {
  if (pushPermission() === "unsupported") return "unsupported";
  if (Notification.permission === "default") return Notification.requestPermission();
  return Notification.permission;
}

// (The small status-bar icon is the game's badge; the big picture is the friend's.)
async function showNow(title: string, body: string, tag: string, link = "/", photo?: unknown) {
  if (pushPermission() !== "granted") return;
  const icon = typeof photo === "string" && photo ? photo : "/icon-192.png";
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (reg) { await reg.showNotification(title, { body, tag, icon, badge: "/badge-96.png", data: { link } }); return; }
  } catch { /* (The Windows app has no service-worker notifications: a plain one below.) */ }
  try {
    const n = new Notification(title, { body, tag, icon });
    // (In the Windows app, ?app-show=1 brings the window back from the tray.)
    n.onclick = () => { window.focus(); if (appKind() === "windows") location.href = `${link}${link.includes("?") ? "&" : "?"}app-show=1`; else if (link !== "/") location.href = link; };
  } catch { /* (Nothing shown: the menu's badges still say so.) */ }
}

/** Watches for new requests, accepted requests and invitations (only ones that arrive from now on). */
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
  const base = (name: string) => collection(firestore, "friends", me.id, name);
  const stops = [
    onSnapshot(base("requests"), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data();
      if (c.type === "added" && fresh(d["at"])) show("New friend request", `${d["name"] || "Someone"} wants to be your friend.`, `req-${c.doc.id}`, "/", d["photo"]);
    }), () => {}),
    onSnapshot(base("list"), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data();
      if (c.type === "added" && fresh(d["at"]) && d["by"] && d["by"] !== me.id) show("Friend request accepted", `${d["name"] || "Your friend"} accepted your friend request.`, `acc-${c.doc.id}`, "/", d["photo"]);
    }), () => {}),
    onSnapshot(base("invites"), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data();
      if (c.type === "added" && fresh(d["at"])) show("Room invitation", `${d["name"] || "A friend"} invited you to room ${c.doc.id}.`, `inv-${c.doc.id}`, `/?room=${c.doc.id}`, d["photo"]);
    }), () => {}),
  ];
  return () => { stops.forEach((f) => f()); if (poll) clearInterval(poll); };
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
