// A room's bikes, in the Realtime Database at `rooms/<CODE>/bikes/<id>`: one per player who has joined (id =
// that player's uid), kept with the room. `holder` is the open tab controlling it (null when parked and free);
// the holder keeps its position current and lets go automatically if its connection drops.
import { onDisconnect, onValue, ref, runTransaction, update } from "firebase/database";
import { realtime } from "./firebase";

export type BikeSpot = { pos: [number, number, number]; yaw: number; fallen: boolean; fallSide: 1 | -1 };
/** `knock` is when another player last crashed into the bike, knocking it onto `knockSide`. */
export type BikeRecord = BikeSpot & { owner: string; holder: string | null; updatedAt: number; knock: number; knockSide: 1 | -1;
  /** How far each other player's bike has shoved this one so far (in total, by their tab id): its controller moves it. */
  pushes: Record<string, [number, number]> };

const bikeRef = (code: string, id: string) => ref(realtime, `rooms/${code}/bikes/${id}`);

function readPushes(value: unknown) {
  const out: Record<string, [number, number]> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [by, p] of Object.entries(value as Record<string, unknown>)) {
    const q = p as { x?: unknown; z?: unknown } | null;
    if (q && typeof q.x === "number" && typeof q.z === "number") out[by] = [q.x, q.z];
  }
  return out;
}

function readBike(value: unknown): BikeRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const pos = v["pos"];
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((n) => typeof n === "number")) return null;
  if (typeof v["yaw"] !== "number" || typeof v["owner"] !== "string") return null;
  return {
    pos: pos as [number, number, number], yaw: v["yaw"], fallen: v["fallen"] === true, fallSide: v["fallSide"] === -1 ? -1 : 1,
    owner: v["owner"], holder: typeof v["holder"] === "string" ? v["holder"] : null, updatedAt: typeof v["updatedAt"] === "number" ? v["updatedAt"] : 0,
    knock: typeof v["knock"] === "number" ? v["knock"] : 0, knockSide: v["knockSide"] === -1 ? -1 : 1,
    pushes: readPushes(v["push"]),
  };
}

export function watchBikes(code: string, onChange: (bikes: Map<string, BikeRecord>) => void) {
  return onValue(ref(realtime, `rooms/${code}/bikes`), (snap) => {
    const bikes = new Map<string, BikeRecord>();
    snap.forEach((child) => {
      const bike = child.key ? readBike(child.val()) : null;
      if (bike && child.key) bikes.set(child.key, bike);
    });
    onChange(bikes);
  });
}

/** Adds this player's bike to the room the first time they join it; later visits find it where it was left. */
export async function bringBike(code: string, uid: string, spot: BikeSpot) {
  await runTransaction(bikeRef(code, uid), (current) => current ?? { ...spot, owner: uid, holder: null, updatedAt: Date.now() });
}

/** Takes control of a bike if nobody present controls it. `isPresent` says whether a holder tab is still here. */
export async function claimBike(code: string, id: string, me: string, isPresent: (holder: string) => boolean) {
  const holder = ref(realtime, `rooms/${code}/bikes/${id}/holder`);
  const result = await runTransaction(holder, (current) => (current == null || current === me || !isPresent(String(current)) ? me : undefined));
  if (!result.committed) return false;
  // Let go automatically if this tab disconnects (registered in the background: the bike is ours already).
  void onDisconnect(holder).set(null).catch(() => {});
  return true;
}

export function saveBike(code: string, id: string, spot: BikeSpot) {
  return update(bikeRef(code, id), { ...spot, updatedAt: Date.now() });
}

/** Another player crashed into this bike: it falls onto `side` (its controller, if any, applies the knock). */
export function knockBike(code: string, id: string, side: 1 | -1) {
  return update(bikeRef(code, id), { fallen: true, fallSide: side, knock: Date.now(), knockSide: side });
}

export async function releaseBike(code: string, id: string, spot: BikeSpot) {
  await update(bikeRef(code, id), { ...spot, holder: null, updatedAt: Date.now() });
  await onDisconnect(ref(realtime, `rooms/${code}/bikes/${id}/holder`)).cancel();
}

/** Shoves a parked bike nobody controls: it is simply moved. */
export function moveBike(code: string, id: string, pos: [number, number, number]) {
  return update(bikeRef(code, id), { pos, updatedAt: Date.now() });
}

/** Shoves a bike another player controls: the running total of the shove, which they apply. */
export function pushBike(code: string, id: string, by: string, total: [number, number]) {
  return update(ref(realtime, `rooms/${code}/bikes/${id}/push/${by}`), { x: Math.round(total[0] * 1000) / 1000, z: Math.round(total[1] * 1000) / 1000 });
}
