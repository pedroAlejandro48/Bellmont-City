// Friends, friend requests and room invitations, in Firestore under `friends/<uid>/…`:
//   requests/<fromUid>  someone asked to be this player's friend (they wrote it; this player accepts or discards)
//   list/<otherUid>     a friend (both sides are written when a request is accepted)
//   invites/<code>      a friend invited this player to a room
// Finding someone: by username (`usernames/<name>`) or by email (`emails/<address>`, which each player writes for
// their own address when they sign in; it can be looked up one address at a time, never listed).
import { collection, deleteDoc, doc, getDoc, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { firestore } from "./firebase";
import type { Account } from "./account";

export type Friend = { uid: string; name: string; at: number };
export type FriendRequest = { uid: string; name: string; at: number };
export type RoomInvite = { code: string; from: string; name: string; at: number };

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Makes this player findable by their email (once per sign-in; harmless to repeat). */
export function publishEmail(account: Account) {
  if (!account.email || !account.username) return;
  void setDoc(doc(firestore, "emails", account.email.trim().toLowerCase()), { uid: account.id }).catch(() => {});
}

/** Who a username or email belongs to: their id and username, or null. */
export async function findPlayer(query: string): Promise<{ uid: string; name: string } | null> {
  const q = query.trim();
  if (!q) return null;
  let uid: string | null = null;
  if (q.includes("@")) {
    const e = await getDoc(doc(firestore, "emails", q.toLowerCase())).catch(() => null);
    uid = e?.exists() ? str(e.data()["uid"]) || null : null;
  } else {
    const u = await getDoc(doc(firestore, "usernames", q.toLowerCase())).catch(() => null);
    uid = u?.exists() ? str(u.data()["uid"]) || null : null;
  }
  if (!uid) return null;
  const p = await getDoc(doc(firestore, "players", uid)).catch(() => null);
  const name = p?.exists() ? str(p.data()["username"]) : "";
  return name ? { uid, name } : null;
}

/** Asks `to` to be friends (it shows at the top of their list until they accept or discard it). */
export function sendRequest(me: Account, to: string) {
  return setDoc(doc(firestore, "friends", to, "requests", me.id), { from: me.id, name: me.username ?? "", at: Date.now() });
}
/** Accepting: each is on the other's list; the request is gone. */
export async function acceptRequest(me: Account, r: FriendRequest) {
  const b = writeBatch(firestore), at = Date.now();
  b.set(doc(firestore, "friends", me.id, "list", r.uid), { name: r.name, at });
  b.set(doc(firestore, "friends", r.uid, "list", me.id), { name: me.username ?? "", at });
  b.delete(doc(firestore, "friends", me.id, "requests", r.uid));
  await b.commit();
}
export const discardRequest = (me: Account, uid: string) => deleteDoc(doc(firestore, "friends", me.id, "requests", uid));
/** No longer friends (on both sides). */
export async function removeFriend(me: Account, uid: string) {
  const b = writeBatch(firestore);
  b.delete(doc(firestore, "friends", me.id, "list", uid));
  b.delete(doc(firestore, "friends", uid, "list", me.id));
  await b.commit();
}

/** Invites a friend to a room (shown under "Join a room" on their menu). */
export function inviteToRoom(me: Account, friend: string, code: string) {
  return setDoc(doc(firestore, "friends", friend, "invites", code), { from: me.id, name: me.username ?? "", code, at: Date.now() });
}
export const discardInvite = (me: Account, code: string) => deleteDoc(doc(firestore, "friends", me.id, "invites", code));

/** Follows this player's friends, requests and invitations (newest first). */
export function watchFriends(me: Account, on: (v: { friends: Friend[]; requests: FriendRequest[]; invites: RoomInvite[] }) => void) {
  let friends: Friend[] = [], requests: FriendRequest[] = [], invites: RoomInvite[] = [];
  const emit = () => on({ friends, requests, invites });
  const base = (name: string) => collection(firestore, "friends", me.id, name);
  const stops = [
    onSnapshot(base("list"), (s) => { friends = s.docs.map((d) => ({ uid: d.id, name: str(d.data()["name"]), at: num(d.data()["at"]) })).sort((a, b) => a.name.localeCompare(b.name)); emit(); }, () => {}),
    onSnapshot(base("requests"), (s) => { requests = s.docs.map((d) => ({ uid: d.id, name: str(d.data()["name"]), at: num(d.data()["at"]) })).sort((a, b) => b.at - a.at); emit(); }, () => {}),
    onSnapshot(base("invites"), (s) => { invites = s.docs.map((d) => ({ code: d.id, from: str(d.data()["from"]), name: str(d.data()["name"]), at: num(d.data()["at"]) })).sort((a, b) => b.at - a.at); emit(); }, () => {}),
  ];
  return () => stops.forEach((f) => f());
}
