// Players' usernames as they are now (they can change them): one live listener per player, shared by everything
// that shows that player's name (friends, requests, invitations, room members and people, name labels).
import { useSyncExternalStore } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { firestore } from "./firebase";

type Entry = { name: string | null; subs: Set<() => void>; stop: (() => void) | null };
const live = new Map<string, Entry>();
function entry(uid: string): Entry {
  let e = live.get(uid);
  if (!e) { e = { name: null, subs: new Set(), stop: null }; live.set(uid, e); }
  return e;
}
function subscribe(uid: string, f: () => void) {
  const e = entry(uid);
  e.subs.add(f);
  if (!e.stop) e.stop = onSnapshot(doc(firestore, "players", uid), (snap) => {
    const v = snap.data()?.["username"];
    const name = typeof v === "string" && v ? v : null;
    if (name !== e.name) { e.name = name; e.subs.forEach((s) => s()); }
  }, () => {});
  return () => {
    e.subs.delete(f);
    // (Kept a little while: lists open and close often.)
    if (!e.subs.size) window.setTimeout(() => { if (!e.subs.size && e.stop) { e.stop(); e.stop = null; } }, 30000);
  };
}
/** A player's current username (or `fallback` until it's known). */
export function useLiveName(uid: string | null | undefined, fallback: string): string {
  const name = useSyncExternalStore(
    (f) => (uid ? subscribe(uid, f) : () => {}),
    () => (uid ? entry(uid).name : null),
  );
  return name ?? fallback;
}
/** A player's current username, never translated. */
export function LiveName({ uid, fallback, className }: { uid: string | null | undefined; fallback: string; className?: string }) {
  return <span className={className} data-no-translate>{useLiveName(uid, fallback)}</span>;
}
