// Notifications (friend requests, accepted requests, room invitations), free and without a server: while the game
// is open — on any page, or still running in the background — this player's friend lists are watched, and anything
// new pops up as a phone/computer notification (through the site's service worker, which also opens the game when
// one is tapped). Once the game has been fully closed they can't arrive (that would need a sending server).
import { collection, onSnapshot } from "firebase/firestore";
import { firestore } from "./firebase";
import type { Account } from "./account";

export const pushPermission = (): NotificationPermission | "unsupported" => (typeof Notification === "undefined" || !("serviceWorker" in navigator) ? "unsupported" : Notification.permission);

/** Asks for permission to show notifications (needs a tap). */
export async function enablePush(): Promise<NotificationPermission | "unsupported"> {
  if (pushPermission() === "unsupported") return "unsupported";
  if (Notification.permission === "default") return Notification.requestPermission();
  return Notification.permission;
}

async function show(title: string, body: string, tag: string, link = "/") {
  if (pushPermission() !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (reg) await reg.showNotification(title, { body, tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { link } });
    else new Notification(title, { body, tag, icon: "/icon-192.png" });
  } catch { /* (Nothing shown: the menu's badges still say so.) */ }
}

/** Watches for new requests, accepted requests and invitations (only ones that arrive from now on). */
export function watchNotifications(me: Account) {
  const since = Date.now() - 5000;
  const fresh = (at: unknown) => typeof at === "number" && at > since;
  const base = (name: string) => collection(firestore, "friends", me.id, name);
  const stops = [
    onSnapshot(base("requests"), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data();
      if (c.type === "added" && fresh(d["at"])) void show("New friend request", `${d["name"] || "Someone"} wants to be your friend.`, `req-${c.doc.id}`);
    }), () => {}),
    onSnapshot(base("list"), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data();
      if (c.type === "added" && fresh(d["at"]) && d["by"] && d["by"] !== me.id) void show("Friend request accepted", `${d["name"] || "Your friend"} accepted your friend request.`, `acc-${c.doc.id}`);
    }), () => {}),
    onSnapshot(base("invites"), (s) => s.docChanges().forEach((c) => {
      const d = c.doc.data();
      if (c.type === "added" && fresh(d["at"])) void show("Room invitation", `${d["name"] || "A friend"} invited you to room ${c.doc.id}.`, `inv-${c.doc.id}`, `/?room=${c.doc.id}`);
    }), () => {}),
  ];
  return () => stops.forEach((f) => f());
}
