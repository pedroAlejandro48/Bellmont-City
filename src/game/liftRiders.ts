// The apartment buildings' elevators, all together: each building's car (liftCar), the residents who ride them,
// and — in a room — keeping them the same for everyone: one player (the room's longest present) runs every car and
// every resident and shares them; the others send the floors they call or press and say where they are, and draw
// what's shared (carrying it on between updates). Up to three people (players and residents) ride at once.
import { aptFloor } from "./aptRoom";
import { APT_FLOORS, floorKey } from "./apartments";
import type { Building } from "./config";
import { atFloor, CAPACITY, carFloor, doorsOf, newCar, request, stepCar, type Car } from "./liftCar";
import type { LiftLink, LiftPeer, LiftRiderWire } from "./state";
import { SHAFT, venueLayout } from "./venueRoom";

type P2 = [number, number];
const SPEED = 1.25;
/** Where people stand in the car (its middle, toward the back and sides), in the building's frame from its middle. */
const SLOTS: P2[] = [[-0.55, -0.45], [0.55, -0.45], [0, 0.05]];
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

/** A building's elevator, in its frame: the car's middle, its doorway's line (z), and in front of it. */
export function shaftOf(b: Building) {
  const L = venueLayout(b), cx = L.bounds.minX + SHAFT / 2, cz = L.bounds.minZ + SHAFT / 2, front = L.bounds.minZ + SHAFT;
  return { L, cx, cz, front, out: [cx, front + 0.7] as P2 };
}
/** Someone in the car (its floor, inside its walls). */
export const inCarAt = (s: ReturnType<typeof shaftOf>, x: number, z: number) => Math.abs(x - s.cx) < SHAFT / 2 - 0.15 && Math.abs(z - s.cz) < SHAFT / 2 - 0.15;
/** Someone in its doorway (where the doors would shut on them). */
export const inDoorAt = (s: ReturnType<typeof shaftOf>, x: number, z: number) => Math.abs(x - s.cx) < 0.75 && Math.abs(z - s.front) < 0.4;

type Rider = {
  id: number; b: string; seed: number; from: number; to: number;
  st: "toLift" | "wait" | "enter" | "ride" | "exit"; path: P2[]; d: number; slot: number; since: number;
  x: number; z: number; yaw: number; walking: boolean; floor: number;
};

export class LiftSystem {
  cars = new Map<string, Car>();
  /** The residents to draw (the runner's own, or as shared). */
  riders: LiftRiderWire[] = [];
  private sim: Rider[] = [];
  private nextId = 1;
  private nextSpawn = new Map<string, number>();
  private lastN = -1;
  private publishAt = 0;
  private yErr = new Map<string, number>();
  private floors = new Map<string, ReturnType<typeof aptFloor>>();
  constructor(private byKey: Map<string, Building>) {}

  car(b: string) { let c = this.cars.get(b); if (!c) { c = newCar(); this.cars.set(b, c); } return c; }
  /** Where the car looks to be (floors): its own position plus what's left of a correction being eased out. */
  shownY(b: string) { return this.car(b).y + (this.yErr.get(b) ?? 0); }
  private floorOf(b: Building, n: number) {
    const k = floorKey(b, n); let f = this.floors.get(k);
    if (!f) { f = aptFloor(b, n); this.floors.set(k, f); }
    return f;
  }
  /** The way to the elevator from where one comes in: the lobby's street door, or an apartment's door. */
  private approach(b: Building, floor: number): P2[] {
    const s = shaftOf(b);
    if (floor <= 1) return [[0, s.L.bounds.maxZ - 0.5], [0, s.front + 1.0], s.out];
    const f = this.floorOf(b, Math.min(APT_FLOORS, floor)), hz = f.hallZ[0] + 0.8, dx = f.door.x - 0.5;
    return [[dx, f.wallZ - 0.35], [dx, hz], [s.cx, hz], s.out];
  }
  /** How many are in a car now (players and residents). */
  occupancy(b: string, peers: LiftPeer[]) {
    const s = this.byKey.get(b);
    if (!s) return 0;
    const sh = shaftOf(s);
    return peers.filter((p) => p.b === b && p.inCar).length + this.riders.filter((r) => r.b === b && (r.inCar || inCarAt(sh, r.x, r.z))).length;
  }

  /**
   * On by `dt`. `link`: the room's (none: playing alone, so this is the runner); `me`: where this player is;
   * `mine`: the floors this player called or pressed now; `rented(b)`: the floors people live on.
   */
  update(dt: number, now: number, link: LiftLink | null, me: LiftPeer, mine: { b: string; floor: number }[], rented: (b: string) => number[]) {
    const host = !link || link.isHost();
    const peers = [me, ...(link?.others() ?? [])];
    link?.setMe(me);
    for (const [b, e] of this.yErr) this.yErr.set(b, e * Math.exp(-5 * dt));
    if (!host && link) {
      // Following: the runner's cars (taken as they come, a moment on for the delay) and residents; my calls go to
      // the runner, and show here at once.
      for (const r of mine) { link.request(r.b, r.floor); request(this.car(r.b), r.floor); }
      const got = link.latest();
      if (got && got.n !== this.lastN) {
        this.lastN = got.n;
        for (const [b, c] of Object.entries(got.snap.cars)) {
          const was = this.shownY(b), next: Car = { ...c, stops: [...c.stops] };
          stepCar(next, 0.12, false);
          this.cars.set(b, next);
          if (Math.abs(was - next.y) < 1.5) this.yErr.set(b, was - next.y); else this.yErr.delete(b);
        }
        this.riders = got.snap.riders;
      } else for (const c of this.cars.values()) stepCar(c, dt, false);
      return;
    }
    // Running them: everyone's calls, the residents, every car.
    for (const r of [...mine, ...(link?.takeRequests() ?? [])]) request(this.car(r.b), r.floor);
    this.stepRiders(dt, now, peers, rented);
    for (const [b, c] of this.cars) {
      const s = this.byKey.get(b);
      if (!s) continue;
      const sh = shaftOf(s), f = carFloor(c);
      const blocked = c.phase !== "moving" && (peers.some((p) => p.b === b && p.inDoor && p.floor === f) || this.sim.some((r) => r.b === b && r.floor === f && inDoorAt(sh, r.x, r.z)));
      stepCar(c, dt, blocked);
    }
    this.riders = this.sim.map((r) => ({ id: r.id, b: r.b, seed: r.seed, x: r.x, z: r.z, yaw: r.yaw, floor: r.floor, walking: r.walking, inCar: r.st === "enter" || r.st === "ride", riding: r.st === "ride" }));
    if (link && now >= this.publishAt) {
      const busy = this.sim.length > 0 || [...this.cars.values()].some((c) => c.phase !== "idle");
      this.publishAt = now + (busy ? 0.25 : 1.5);
      link.publish({ cars: Object.fromEntries(this.cars), riders: this.riders });
    }
  }

  private stepRiders(dt: number, now: number, peers: LiftPeer[], rented: (b: string) => number[]) {
    // Someone comes along now and then, in each building where there's a player (two at most at a time).
    const wanted = new Set(peers.map((p) => p.b).filter((b): b is string => !!b && this.byKey.has(b)));
    this.sim = this.sim.filter((r) => wanted.has(r.b));
    for (const b of wanted) {
      const at = this.nextSpawn.get(b);
      if (at === undefined) { this.nextSpawn.set(b, now + 4 + Math.random() * 10); continue; }
      if (now < at || this.sim.filter((r) => r.b === b).length >= 2) continue;
      this.nextSpawn.set(b, now + 18 + Math.random() * 30);
      const floors = rented(b);
      if (!floors.length) continue;
      const f = floors[Math.floor(Math.random() * floors.length)]!, up = Math.random() < 0.5, from = up ? 1 : f;
      const path = this.approach(this.byKey.get(b)!, from), p0 = path[0]!;
      this.sim.push({ id: this.nextId++, b, seed: Math.floor(Math.random() * 1e6), from, to: up ? f : 1, st: "toLift", path, d: 0, slot: -1, since: now, x: p0[0], z: p0[1], yaw: 0, walking: true, floor: from });
    }
    for (const r of this.sim) {
      const bb = this.byKey.get(r.b)!, sh = shaftOf(bb), c = this.car(r.b);
      const walk = () => { r.d += SPEED * dt; const p = along(r.path, r.d); r.x = p.x; r.z = p.z; r.yaw = p.yaw; r.walking = r.d < len(r.path); return !r.walking; };
      const slotAt = (k: number): P2 => [sh.cx + SLOTS[k]![0], sh.cz + SLOTS[k]![1]];
      if (r.st === "toLift") { if (walk()) { r.st = "wait"; r.since = now; r.yaw = Math.atan2(sh.cx - r.x, sh.cz - r.z); request(c, r.from); } }
      else if (r.st === "wait") {
        // In when the car is here with its doors open and there's room (and a free spot).
        const taken = new Set(this.sim.filter((o) => o !== r && o.b === r.b && (o.st === "enter" || o.st === "ride")).map((o) => o.slot));
        const free = [0, 1, 2].find((k) => !taken.has(k));
        if (atFloor(c, r.from) && doorsOf(c) > 0.9 && free !== undefined && this.occupancy(r.b, peers) < CAPACITY) {
          r.st = "enter"; r.slot = free; r.path = [[r.x, r.z], [sh.cx, sh.front - 0.3], slotAt(free)]; r.d = 0;
        } else if (!atFloor(c, r.from) && !c.stops.includes(r.from)) request(c, r.from);
        else if (now - r.since > 90) { r.st = "exit"; r.path = [[r.x, r.z], ...[...this.approach(bb, r.from)].reverse()]; r.d = 0; }
      } else if (r.st === "enter") {
        if (walk()) { r.st = "ride"; r.yaw = 0; request(c, r.to); }
      } else if (r.st === "ride") {
        r.floor = carFloor(c); r.walking = false; r.yaw = Math.atan2(0, 1);
        if (atFloor(c, r.to) && doorsOf(c) > 0.9) { r.st = "exit"; r.floor = r.to; r.path = [[r.x, r.z], [sh.cx, sh.front - 0.3], ...[...this.approach(bb, r.to)].reverse()]; r.d = 0; }
        else if (!atFloor(c, r.to) && !c.stops.includes(r.to)) request(c, r.to);
      } else if (r.st === "exit") { if (walk()) r.d = -1; }
    }
    this.sim = this.sim.filter((r) => r.d !== -1);
  }
}
