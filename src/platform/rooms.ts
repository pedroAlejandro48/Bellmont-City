// Multiplayer rooms: `rooms/<CODE>` holds each live room's world. A code stays taken while its document
// exists and is freed only when the room is deleted (its last player leaves).
import { getCapability } from "./claude";
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

/** Creates a room with a fresh random world under a code no live room has. */
export async function createRoom(account: Account, random: () => number = Math.random): Promise<RoomInfo> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomRoomCode(random);
    // The lease stops two creators that drew the same code at once from both taking it.
    const lease = await account.db.doc(`claims/room-${code}`).acquire({ holder: account.id, ttlMs: 5000 });
    if (!lease.acquired) continue;
    const doc = account.db.doc(`rooms/${code}`);
    if (readRoom(code, (await doc.get()).data())) continue;
    const room = { code, seed: Math.floor(random() * 2147483646) + 1, createdAt: Date.now() };
    await doc.set({ seed: room.seed, createdAt: room.createdAt, createdBy: account.id });
    return room;
  }
  throw new Error("Could not find a free room code.");
}

export async function findRoom(account: Account, code: string): Promise<RoomInfo | null> {
  const snap = await account.db.doc(`rooms/${code}`).get();
  return snap.exists ? readRoom(code, snap.data()) : null;
}

/** Frees the code; called by the last player to leave. */
export function deleteRoom(account: Account, code: string) {
  return account.db.doc(`rooms/${code}`).delete();
}

/** Joins the live channel for a room (room names are lower case on the platform). */
export async function joinRoomChannel(code: string) {
  const room = await getCapability("room");
  if (!room) throw new Error("Multiplayer is not available here.");
  return room.join(`bellmont-${code.toLowerCase()}`);
}
