// Push notifications (friend requests, accepted requests, room invitations): this device's push address (an FCM
// token, through the site's service worker) is kept under `pushTokens/<uid>/tokens/<token>`; Cloud Functions
// (functions/index.js) send to them when someone asks, accepts or invites.
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { doc, setDoc } from "firebase/firestore";
import { app, firestore } from "./firebase";
import type { Account } from "./account";

export const pushPermission = (): NotificationPermission | "unsupported" => (typeof Notification === "undefined" || !("serviceWorker" in navigator) ? "unsupported" : Notification.permission);

/** Registers this device for the account's notifications; with `ask`, asks for permission first (needs a tap). */
export async function enablePush(account: Account, ask: boolean): Promise<NotificationPermission | "unsupported"> {
  if (pushPermission() === "unsupported" || !(await isSupported().catch(() => false))) return "unsupported";
  let perm = Notification.permission;
  if (perm === "default" && ask) perm = await Notification.requestPermission();
  if (perm !== "granted") return perm;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/") ?? await navigator.serviceWorker.register("/sw.js");
    const token = await getToken(getMessaging(app), { serviceWorkerRegistration: reg });
    if (token) await setDoc(doc(firestore, "pushTokens", account.id, "tokens", token), { at: Date.now(), ua: navigator.userAgent.slice(0, 160) });
  } catch { /* (Notifications just won't arrive on this device.) */ }
  return perm;
}
