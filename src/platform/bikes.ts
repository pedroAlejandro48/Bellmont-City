// A room's bikes, in the Realtime Database at `rooms/<CODE>/bikes/<id>`: one per player who has joined (id =
// that player's uid), kept with the room. `holder` is the open tab controlling it (null when parked and free);
// the holder keeps its position current and lets go automatically if its connection drops.
import { onDisconnect, onValue, ref, runTransaction, update } from "firebase/database";
import { realtime } from "./firebase";

export type BikeSpot = { pos: [number, number, number]; yaw: number; fallen: boolean; fallSide: 1 | -1 };
export type BikeRecord = BikeSpot & { owner: string; holder: string | null; updatedAt: number };

const bikeRef = (code: string, id: string) => ref(realtime, `rooms/${code}/bikes/${id}`);

function readBike(value: unknown): BikeRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const pos = v["pos"];
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((n) => typeof n === "number")) return null;
  if (typeof v["yaw"] !== "number" || typeof v["owner"] !== "string") return null;
  return {
    pos: pos as [number, number, number], yaw: v["yaw"], fallen: v["fallen"] === true, fallSide: v["fallSide"] === -1 ? -1 : 1,
    owner: v["owner"], holder: typeof v["holder"] === "string" ? v["holder"] : null, updatedAt: typeof v["updatedAt"] === "number" ? v["updatedAt"] : 0,
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

export async function releaseBike(code: string, id: string, spot: BikeSpot) {
  await update(bikeRef(code, id), { ...spot, holder: null, updatedAt: Date.now() });
  await onDisconnect(ref(realtime, `rooms/${code}/bikes/${id}/holder`)).cancel();
}
