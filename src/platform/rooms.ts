// Multiplayer rooms: `rooms/<CODE>` holds each room's world. A code stays taken while its document exists:
// until its creator deletes it, or until it has gone ROOM_LIFETIME_DAYS without anyone entering (`expiresAt`
// passed: it then counts as gone, and the next room created sweeps it away; no paid TTL policy needed). Live data (players, bikes) is in the Realtime Database under the room's
// `key` (code + creation time), so a code reused after expiry starts clean.
import { collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, query, runTransaction, Timestamp, updateDoc, where } from "firebase/firestore";
import { ref, remove, set } from "firebase/database";
import { firestore, realtime } from "./firebase";
import { joinRealtimeRoom } from "./realtime";
import type { Account } from "./account";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CAPACITY = 10;

export const ROOM_LIFETIME_DAYS = 30;
const LIFETIME_MS = ROOM_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

export type RoomInfo = { code: string; seed: number; createdAt: number; createdBy: string; key: string };

const roomKey = (code: string, createdAt: number) => `${code}-${createdAt}`;
const activity = (now: number) => ({ lastActiveAt: now, expiresAt: Timestamp.fromMillis(now + LIFETIME_MS) });

/** The link that opens a room straight away (after signing in). */
export function roomLink(code: string) {
  return `${window.location.origin}/?room=${code}`;
}

/** Six characters, each independently a random letter or digit (so any mix of the two). */
export function randomRoomCode(random: () => number = Math.random) {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}

export function normalizeRoomCode(input: string) {
  const code = input.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

/** A room nobody has entered for ROOM_LIFETIME_DAYS. */
export function roomExpired(body: Record<string, unknown> | undefined, now = Date.now()) {
  const expires = body?.["expiresAt"];
  return expires instanceof Timestamp && expires.toMillis() <= now;
}

/** Deletes some rooms that have expired (the rules let any player remove an expired room). */
async function sweepExpiredRooms() {
  const expired = await getDocs(query(collection(firestore, "rooms"), where("expiresAt", "<=", Timestamp.now()), limit(25)));
  await Promise.all(expired.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
}

function readRoom(code: string, body: Record<string, unknown> | undefined): RoomInfo | null {
  const seed = body?.["seed"], createdAt = body?.["createdAt"], createdBy = body?.["createdBy"];
  return typeof seed === "number" && typeof createdAt === "number" && typeof createdBy === "string"
    ? { code, seed, createdAt, createdBy, key: roomKey(code, createdAt) } : null;
}

/** Draws codes until `claim` takes one that no live room has. */
export async function createRoomWith(claim: (room: RoomInfo) => Promise<boolean>, createdBy = "", random: () => number = Math.random): Promise<RoomInfo> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomRoomCode(random), createdAt = Date.now();
    const room = { code, seed: Math.floor(random() * 2147483646) + 1, createdAt, createdBy, key: roomKey(code, createdAt) };
    if (await claim(room)) return room;
  }
  throw new Error("Could not find a free room code.");
}

/** Creates a room with a fresh random world under a code no live room has. */
export async function createRoom(account: Account, random: () => number = Math.random): Promise<RoomInfo> {
  await sweepExpiredRooms().catch(() => {});
  const room = await createRoomWith((r) => runTransaction(firestore, async (tx) => {
    const at = doc(firestore, "rooms", r.code);
    // A code stays taken until its room is actually removed, even if it has just expired.
    if ((await tx.get(at)).exists()) return false;
    tx.set(at, { seed: r.seed, createdAt: r.createdAt, createdBy: account.id, ...activity(r.createdAt) });
    return true;
  }), account.id, random);
  // Marks the live data as the creator's, which is what lets them delete it with the room.
  await set(ref(realtime, `rooms/${room.key}/owner`), account.id);
  return room;
}

export async function findRoom(code: string): Promise<RoomInfo | null> {
  const snap = await getDoc(doc(firestore, "rooms", code));
  if (!snap.exists()) return null;
  if (roomExpired(snap.data())) {
    await deleteDoc(snap.ref).catch(() => {});
    return null;
  }
  return readRoom(code, snap.data());
}

/** Someone is in the room: it lives another ROOM_LIFETIME_DAYS from now. */
export function touchRoom(code: string) {
  return updateDoc(doc(firestore, "rooms", code), activity(Date.now()));
}

/** Calls `onGone` once the room no longer exists (its creator deleted it). */
export function watchRoom(code: string, onGone: () => void) {
  let seen = false;
  return onSnapshot(doc(firestore, "rooms", code), (snap) => {
    if (snap.exists()) seen = true;
    else if (seen) onGone();
  }, () => {});
}

/** Deletes the room and everything in it (only its creator may). Everyone inside is sent back to the menu. */
export async function deleteRoom(room: RoomInfo) {
  await deleteDoc(doc(firestore, "rooms", room.code));
  await remove(ref(realtime, `rooms/${room.key}`)).catch(() => {});
}

/** Joins the live channel for a room. */
export function joinRoomChannel(room: RoomInfo, account: Account) {
  return joinRealtimeRoom(room.key, account.id);
}
