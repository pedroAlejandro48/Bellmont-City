// Private chats between friends, in Firestore: chats/<smaller uid>_<larger uid>/messages/<id> { from, to, text, at }.
// Sending one also asks the notification sender (push-worker) to tell the friend (their Android phone, or a browser on
// Windows); on the Android app they can answer from the notification itself.
import { addDoc, collection, limitToLast, onSnapshot, orderBy, query } from "firebase/firestore";
import { firestore } from "./firebase";
import type { Account } from "./account";
import { notifyMessage } from "./push";

/** The longest message (WhatsApp's limit). */
export const MAX_MESSAGE = 65536;
/** How many of the latest messages a chat shows. */
const SHOWN = 300;

export type ChatMessage = { id: string; from: string; to: string; text: string; at: number; pending?: boolean };

export const chatId = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Follows the chat with `friend` (oldest first). */
export function watchChat(me: Account, friend: string, on: (msgs: ChatMessage[]) => void) {
  const q = query(collection(firestore, "chats", chatId(me.id, friend), "messages"), orderBy("at"), limitToLast(SHOWN));
  return onSnapshot(q, { includeMetadataChanges: true }, (s) => {
    on(s.docs.map((d) => {
      const v = d.data();
      return { id: d.id, from: String(v["from"] ?? ""), to: String(v["to"] ?? ""), text: String(v["text"] ?? ""), at: Number(v["at"] ?? 0), pending: d.metadata.hasPendingWrites };
    }));
  }, () => on([]));
}

/** Sends `text` to `friend` and lets them know. */
export async function sendMessage(me: Account, friend: string, text: string) {
  const t = text.slice(0, MAX_MESSAGE);
  if (!t.trim()) return;
  const ref = await addDoc(collection(firestore, "chats", chatId(me.id, friend), "messages"), { from: me.id, to: friend, text: t, at: Date.now() });
  notifyMessage(friend, ref.id);
}
