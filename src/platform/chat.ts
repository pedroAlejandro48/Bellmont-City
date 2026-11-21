// Private chats between friends, in Firestore: chats/<smaller uid>_<larger uid>/messages/<id> { from, to, text, at,
// fwd? } and chats/<pair>/seen/<uid> { at } (when that player last had the chat open: what's newer is unread).
// Sending one also asks the notification sender (push-worker) to tell the friend (their Android phone, or a browser on
// Windows); on the Android app they can answer from the notification itself. Unsending deletes the message for both
// and takes it out of the friend's notification.
import { addDoc, collection, deleteDoc, doc, limitToLast, onSnapshot, orderBy, query, setDoc, where } from "firebase/firestore";
import { firestore } from "./firebase";
import type { Account } from "./account";
import { notifyMessage, notifyUnsend } from "./push";
import { serverNow } from "@/lib/serverTime";

/** The longest message (WhatsApp's limit). */
export const MAX_MESSAGE = 65536;
/** How many of the latest messages a chat shows. */
const SHOWN = 300;

export type ChatMessage = { id: string; from: string; to: string; text: string; at: number; fwd: boolean };

export const chatId = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const messages = (me: string, friend: string) => collection(firestore, "chats", chatId(me, friend), "messages");
const read = (id: string, v: Record<string, unknown>): ChatMessage => ({ id, from: String(v["from"] ?? ""), to: String(v["to"] ?? ""), text: String(v["text"] ?? ""), at: Number(v["at"] ?? 0), fwd: v["fwd"] === true });

/** Follows the chat with `friend` (oldest first); a message sent here shows at once, before the server has it. */
export function watchChat(me: Account, friend: string, on: (msgs: ChatMessage[]) => void) {
  const q = query(messages(me.id, friend), orderBy("at"), limitToLast(SHOWN));
  return onSnapshot(q, (s) => on(s.docs.map((d) => read(d.id, d.data()))), () => on([]));
}

/** Sends `text` to `friend` (`fwd`: forwarded from another chat) and lets them know. */
export async function sendMessage(me: Account, friend: string, text: string, fwd = false) {
  const t = text.slice(0, MAX_MESSAGE);
  if (!t.trim()) return;
  const ref = await addDoc(messages(me.id, friend), { from: me.id, to: friend, text: t, at: serverNow(), ...(fwd ? { fwd: true } : {}) });
  notifyMessage(friend, ref.id);
}

/** Deletes one of this player's messages for both of them (and from the friend's notification). */
export async function unsendMessage(me: Account, friend: string, id: string) {
  await deleteDoc(doc(messages(me.id, friend), id));
  notifyUnsend(friend, id);
}

/** This player has seen the chat with `friend` up to `at` (now, by default). */
export function markSeen(me: Account, friend: string, at = serverNow()) {
  void setDoc(doc(firestore, "chats", chatId(me.id, friend), "seen", me.id), { at }, { merge: true }).catch(() => {});
}

/** How long one "the chat is open" mark lasts (it's renewed every OPEN_RENEW_MS while the chat is on screen). */
export const OPEN_FOR_MS = 20000, OPEN_RENEW_MS = 10000;
/** This player has the chat with `friend` open on screen (until a little later), or not any more: while it's open,
 * their messages need no notification at all. */
export function markOpen(me: Account, friend: string, open: boolean) {
  void setDoc(doc(firestore, "chats", chatId(me.id, friend), "seen", me.id), { open: open ? serverNow() + OPEN_FOR_MS : 0 }, { merge: true }).catch(() => {});
}

/** How many messages from `friend` arrived since this player last had the chat open. */
export function watchUnread(me: Account, friend: string, on: (n: number) => void) {
  let stopMsgs: (() => void) | null = null;
  const stopSeen = onSnapshot(doc(firestore, "chats", chatId(me.id, friend), "seen", me.id), (s) => {
    const seen = Math.min(Number(s.data()?.["at"] ?? 0), serverNow()); // (never later than now: see serverTime.ts)
    stopMsgs?.();
    stopMsgs = onSnapshot(query(messages(me.id, friend), where("at", ">", seen)), (m) => on(m.docs.filter((d) => d.data()["to"] === me.id).length), () => on(0));
  }, () => on(0));
  return () => { stopSeen(); stopMsgs?.(); };
}
