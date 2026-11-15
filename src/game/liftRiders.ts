// Residents riding an apartment building's elevator (pure): now and then someone comes in from the street, calls the
// car in the lobby, rides it up to their (rented) floor and walks off down the hallway to their door — or comes out of
// their door, rides down and walks out of the lobby. The car really does it (it comes, its doors open, it goes), so
// while they're using it, it's busy for the player too.

export type RiderTrip = { b: string; from: number; to: number; t0: number; seed: number; /** Where the car was when called. */ car0: number };
type P2 = [number, number];
/** The places a rider walks between, in the building's frame. */
export type RiderPlaces = {
  /** The car's middle; just outside its doors. */
  car: P2; out: P2;
  /** The lobby: from the street door to in front of the elevator. */
  lobby: P2[];
  /** A floor: from in front of the elevator to the apartment's door. */
  hall: P2[];
};

const OPEN = 0.8, IN = 2.2, PER_FLOOR = 2, SPEED = 1.25;
const len = (pts: P2[]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);
function along(pts: P2[], d: number): { x: number; z: number; yaw: number } {
  let at = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!, b = pts[k + 1]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (at + l >= d || k === pts.length - 2) { const u = l > 1e-6 ? Math.min(1, Math.max(0, (d - at) / l)) : 1; return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) }; }
    at += l;
  }
  const e = pts[pts.length - 1]!;
  return { x: e[0], z: e[1], yaw: 0 };
}
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** The way to the elevator on the floor one starts from (ending outside its doors), and away from it at the other. */
const approach = (pl: RiderPlaces, floor: number): P2[] => (floor <= 1 ? pl.lobby : pl.hall);
const leaving = (pl: RiderPlaces, floor: number): P2[] => [...approach(pl, floor)].reverse();

export type RiderNow = {
  done: boolean;
  /** The car: resting at `floor`, or going floor → to since `since` (seconds into the trip). */
  car: { floor: number; to: number | null; since: number };
  /** How open the doors are (0..1) at the car's floor. */
  doors: number;
  /** The rider: hidden (inside their apartment, or not yet come), or where, on which floor (or riding). */
  rider: { visible: boolean; x: number; z: number; yaw: number; walking: boolean; floor: number; riding: boolean };
};
/** Where everything is `t` seconds into a trip. */
export function riderAt(trip: RiderTrip, pl: RiderPlaces, t: number): RiderNow {
  const call = PER_FLOOR * Math.abs(trip.car0 - trip.from);
  const toLift = leaving(pl, trip.from).reverse(), walkUp = len(toLift) / SPEED;
  const away = leaving(pl, trip.to), walkAway = len(away) / SPEED;
  // Walking to the elevator while the car comes (whichever is longer), then doors open, in, doors shut.
  const arrive = Math.max(call, walkUp);
  const tOpen = arrive, tIn = tOpen + OPEN, tShut = tIn + IN, tRide = tShut + OPEN, ride = PER_FLOOR * Math.abs(trip.to - trip.from);
  const tOpen2 = tRide + ride, tOut = tOpen2 + OPEN, tShut2 = tOut + IN, tAway = tShut2, tEnd = Math.max(tShut2 + OPEN, tAway + walkAway);
  const hidden = { visible: false, x: 0, z: 0, yaw: 0, walking: false, floor: trip.from, riding: false };
  // The car.
  const car = t < call ? { floor: trip.car0, to: trip.from, since: 0 } : t < tRide ? { floor: trip.from, to: null, since: 0 } : t < tOpen2 ? { floor: trip.from, to: trip.to, since: tRide } : { floor: trip.to, to: null, since: 0 };
  const doors = t < tOpen ? 0 : t < tIn ? smooth((t - tOpen) / OPEN) : t < tShut ? 1 : t < tRide ? 1 - smooth((t - tShut) / OPEN)
    : t < tOpen2 ? 0 : t < tOut ? smooth((t - tOpen2) / OPEN) : t < tShut2 ? 1 : t < tShut2 + OPEN ? 1 - smooth((t - tShut2) / OPEN) : 0;
  let rider: RiderNow["rider"] = hidden;
  if (t < arrive) {
    // Coming to the elevator (from the street door, or out of the apartment), waiting outside its doors.
    const d = Math.min(len(toLift), t * SPEED), p = along(toLift, d);
    rider = { visible: true, ...p, yaw: d >= len(toLift) - 1e-3 ? Math.atan2(pl.car[0] - pl.out[0], pl.car[1] - pl.out[1]) : p.yaw, walking: d < len(toLift) - 1e-3, floor: trip.from, riding: false };
  } else if (t < tIn) rider = { visible: true, x: pl.out[0], z: pl.out[1], yaw: Math.atan2(pl.car[0] - pl.out[0], pl.car[1] - pl.out[1]), walking: false, floor: trip.from, riding: false };
  else if (t < tShut) {
    // In, and turned round to face the doors.
    const k = smooth((t - tIn) / (IN * 0.75)), turn = smooth((t - tIn - IN * 0.6) / (IN * 0.4));
    const x = pl.out[0] + (pl.car[0] - pl.out[0]) * k, z = pl.out[1] + (pl.car[1] - pl.out[1]) * k, inYaw = Math.atan2(pl.car[0] - pl.out[0], pl.car[1] - pl.out[1]);
    rider = { visible: true, x, z, yaw: inYaw + Math.PI * turn, walking: k < 1 || (turn > 0 && turn < 1), floor: trip.from, riding: false };
  } else if (t < tOut) {
    const facing = Math.atan2(pl.out[0] - pl.car[0], pl.out[1] - pl.car[1]);
    rider = { visible: true, x: pl.car[0], z: pl.car[1], yaw: facing, walking: false, floor: t < tOpen2 ? trip.from : trip.to, riding: t >= tRide && t < tOpen2 };
  } else if (t < tEnd) {
    // Out of the car and away (down the hallway to the door, or out through the lobby).
    const out: P2[] = [pl.car, ...away];
    const d = (t - tOut) * SPEED, total = len(out);
    if (d < total) rider = { visible: true, ...along(out, d), walking: true, floor: trip.to, riding: false };
  }
  return { done: t >= tEnd, car, doors, rider };
}
