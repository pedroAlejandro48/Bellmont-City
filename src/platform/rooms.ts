// Multiplayer rooms: `rooms/<CODE>` holds each live room's world. A code stays taken while its document
// exists and is freed only when the room is deleted (its last player leaves).
import { deleteDoc, doc, getDoc, runTransaction } from "firebase/firestore";
import { firestore } from "./firebase";
import { joinRealtimeRoom } from "./realtime";
import type { Account } from "./account";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CAPACITY = 10;

export type RoomInfo = { code: string; seed: number; createdAt: number };

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

function readRoom(code: string, body: Record<string, unknown> | undefined): RoomInfo | null {
  const seed = body?.["seed"], createdAt = body?.["createdAt"];
  return typeof seed === "number" && typeof createdAt === "number" ? { code, seed, createdAt } : null;
}

/** Draws codes until `claim` takes one that no live room has. */
export async function createRoomWith(claim: (room: RoomInfo) => Promise<boolean>, random: () => number = Math.random): Promise<RoomInfo> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const room = { code: randomRoomCode(random), seed: Math.floor(random() * 2147483646) + 1, createdAt: Date.now() };
    if (await claim(room)) return room;
  }
  throw new Error("Could not find a free room code.");
}

/** Creates a room with a fresh random world under a code no live room has. */
export function createRoom(account: Account, random: () => number = Math.random): Promise<RoomInfo> {
  return createRoomWith((room) => runTransaction(firestore, async (tx) => {
    const ref = doc(firestore, "rooms", room.code);
    if ((await tx.get(ref)).exists()) return false;
    tx.set(ref, { seed: room.seed, createdAt: room.createdAt, createdBy: account.id });
    return true;
  }), random);
}

export async function findRoom(code: string): Promise<RoomInfo | null> {
  const snap = await getDoc(doc(firestore, "rooms", code));
  return snap.exists() ? readRoom(code, snap.data()) : null;
}

/** Frees the code; called by the last player to leave. */
export function deleteRoom(code: string) {
  return deleteDoc(doc(firestore, "rooms", code));
}

/** Joins the live channel for a room. */
export function joinRoomChannel(code: string, account: Account) {
  return joinRealtimeRoom(code, account.id);
}
