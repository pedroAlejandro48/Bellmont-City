// The apartment buildings' elevators and the people who live in the buildings, all together: each building's car
// (liftCar), and the city's people going home and coming out again. Someone from the street walks in through the
// lobby's door (it opens for them), calls the car, rides up with whoever else is in it (four at most), walks down
// the hallway, unlocks their door with their key and goes in — home. Later they come out of that door, ride down,
// and walk out of the lobby onto the street again (the same person: Pedestrians takes them back). Where no player
// is near, the same happens without being shown (straight home; straight out of the door). In a room, the longest-
// present player runs all of it and shares it; the others send their calls and presses and say where they are.
import { aptFloor, INNER_WALL } from "./aptRoom";
import { APT_FLOORS, floorKey } from "./apartments";
import type { Building } from "./config";
import { OPENER_PASS } from "./doors";
import { atFloor, CAPACITY, carFloor, doorsOf, newCar, request, stepCar, type Car } from "./liftCar";
import { ENTER, LEAVE, enterLead, enterPose, leaveLead, leavePose, toWorld } from "./restaurantRoom";
import type { LiftLink, LiftPeer, LiftRiderWire } from "./state";
import { SHAFT, venueLayout } from "./venueRoom";

type P2 = [number, number];
const SPEED = 1.25;
/** How far apart people waiting for the elevator stand in line. */
const QUEUE_GAP = 0.75;
/** Where people stand in the car (from its middle; the doors are toward +z). */
const SLOTS: P2[] = [[-0.55, -0.5], [0.55, -0.5], [-0.55, 0.3], [0.55, 0.3]];
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

/** A building's elevator, in its frame: the car's middle, its doorway's line (z), and in front of it. */
export function shaftOf(b: Building) {
  const L = venueLayout(b), cx = L.bounds.minX + SHAFT / 2, cz = L.bounds.minZ + SHAFT / 2, front = L.bounds.minZ + SHAFT;
  return { L, cx, cz, front, out: [cx, front + 0.7] as P2 };
}
export const inCarAt = (s: ReturnType<typeof shaftOf>, x: number, z: number) => Math.abs(x - s.cx) < SHAFT / 2 - 0.15 && Math.abs(z - s.cz) < SHAFT / 2 - 0.15;
export const inDoorAt = (s: ReturnType<typeof shaftOf>, x: number, z: number) => Math.abs(x - s.cx) < 0.75 && Math.abs(z - s.front) < 0.4;

/** The lobby's street door: where one stands outside to go in, and inside before going out. */
export const LOBBY_IN: P2 = [0.55, 2.3], LOBBY_OUT: P2 = [0, -1.25];
/** Unlocking an apartment door: walk up, reach, turn, back. */
const KEY = { reach: 0.55, turn: 0.5, back: 0.45 };
const KEY_T = KEY.reach + KEY.turn + KEY.back;

type Stage = "lobbyIn" | "toLift" | "wait" | "enter" | "ride" | "exit" | "toDoor" | "key" | "inApt" | "aptOut" | "toExit" | "lobbyOut";
type Rider = {
  id: number; b: string; from: number; to: number; st: Stage; path: P2[]; d: number; slot: number; since: number;
  x: number; z: number; yaw: number; walking: boolean; floor: number; lean: number;
  reach: [number, number, number, number] | null; key: boolean; off: P2;
};
/** What the street hands over (someone at a lobby's door going in) and gets back (someone out of the door). */
export type LiftBridge = {
  /** `direct`: home out of sight (not through the lobby). */
  arrive: (id: number, b: string, direct?: boolean) => void;
  release: (id: number, b: string) => void;
  takeOut: () => { id: number; x: number; z: number; yaw: number }[];
  /** Who's at home where (for choosing who comes out). */
  homeOf: (id: number) => string | null;
};

export class LiftSystem {
  cars = new Map<string, Car>();
  riders: LiftRiderWire[] = [];
  /** Apartment doors standing open (a resident going through), by floor key. */
  aptDoors = new Map<string, number>();
  private sim: Rider[] = [];
  /** Apartment doors swinging shut by themselves once a resident is through: from how open, since when. */
  private shutting: { key: string; a: number; at: number }[] = [];
  private homes = new Map<number, { b: string; floor: number }>();
  private queueIn: { id: number; b: string; direct: boolean }[] = [];
  private queueOut: { id: number; b: string }[] = [];
  private outbox: { id: number; x: number; z: number; yaw: number }[] = [];
  private lastN = -1;
  private publishAt = 0;
  private yErr = new Map<string, number>();
  private floors = new Map<string, ReturnType<typeof aptFloor>>();
  /** Lobby doors to swing (for whoever draws them): a resident going in or out. */
  doorUses: { key: string; leaf: "left" | "right"; at: number; lead: number }[] = [];
  private seenDoor = new Set<string>();
  /** Floors players have pressed or called the car to (per building), until it stops there. */
  private asked = new Map<string, Set<number>>();
  rented: (b: string) => number[] = () => [];
  constructor(private byKey: Map<string, Building>) {}

  bridge: LiftBridge = {
    arrive: (id, b, direct) => { this.queueIn.push({ id, b, direct: !!direct }); },
    release: (id, b) => { this.queueOut.push({ id, b }); },
    takeOut: () => this.outbox.splice(0),
    homeOf: (id) => this.homes.get(id)?.b ?? null,
  };

  car(b: string) { let c = this.cars.get(b); if (!c) { c = newCar(); this.cars.set(b, c); } return c; }
  shownY(b: string) { return this.car(b).y + (this.yErr.get(b) ?? 0); }
  private floorOf(b: Building, n: number) {
    const k = floorKey(b, n); let f = this.floors.get(k);
    if (!f) { f = aptFloor(b, n); this.floors.set(k, f); }
    return f;
  }
  /** On a floor: in front of the apartment's door (hallway side), and the way between it and the elevator. */
  private hall(b: Building, floor: number) {
    const s = shaftOf(b), f = this.floorOf(b, Math.max(2, Math.min(APT_FLOORS, floor))), hz = f.hallZ[0] + 0.8, dx = f.door.x;
    const stand: P2 = [dx - 0.45, f.wallZ + INNER_WALL - 0.72];
    return { f, stand, toLift: [stand, [stand[0], hz], [s.cx + 0.6, hz], s.out] as P2[] };
  }
  private lobbyPath(b: Building): P2[] { const s = shaftOf(b); return [[0.5, -2.7], [0, s.front + 1.1], s.out]; }
  occupancy(b: string, peers: LiftPeer[]) {
    const s = this.byKey.get(b);
    if (!s) return 0;
    const sh = shaftOf(s), c = this.car(b);
    return peers.filter((p) => p.b === b && p.inCar).length + this.sim.filter((r) => r.b === b && (r.st === "enter" || r.st === "ride" || (r.floor === carFloor(c) && inCarAt(sh, r.x, r.z)))).length;
  }

  update(dt: number, now: number, link: LiftLink | null, me: LiftPeer, mine: { b: string; floor: number }[]) {
    const host = !link || link.isHost();
    const peers = [me, ...(link?.others() ?? [])];
    link?.setMe(me);
    for (const [b, e] of this.yErr) this.yErr.set(b, e * Math.exp(-5 * dt));
    if (!host && link) {
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
        this.aptDoors = new Map(Object.entries(got.snap.aptDoors ?? {}));
      } else for (const c of this.cars.values()) stepCar(c, dt, false);
      this.noteDoors(now);
      return;
    }
    for (const r of [...mine, ...(link?.takeRequests() ?? [])]) {
      const c = this.car(r.b), f = Math.round(r.floor);
      request(c, f);
      if (c.stops.includes(f)) { let a = this.asked.get(r.b); if (!a) this.asked.set(r.b, (a = new Set())); a.add(f); }
    }
    this.stepPeople(dt, now, peers);
    for (const [b, c] of this.cars) {
      const s = this.byKey.get(b);
      if (!s) continue;
      // Only floors someone wants stay lit: a player's press or call, a resident waiting there for it, or the
      // one floor each resident inside it is going to (the lobby, for everyone from upstairs).
      const asked = this.asked.get(b) ?? new Set<number>();
      const want = new Set(asked);
      for (const r of this.sim) {
        if (r.b !== b) continue;
        if (r.st === "wait") want.add(r.from);
        else if (r.st === "enter" || r.st === "ride") want.add(r.to);
      }
      c.stops = c.stops.filter((f) => want.has(f));
      const sh = shaftOf(s), f = carFloor(c);
      const blocked = c.phase !== "moving" && (peers.some((p) => p.b === b && p.inDoor && p.floor === f) || this.sim.some((r) => r.b === b && r.floor === f && inDoorAt(sh, r.x, r.z)));
      stepCar(c, dt, blocked);
      for (const f of asked) if (!c.stops.includes(f)) asked.delete(f);
    }
    this.riders = this.sim.map((r) => ({ id: r.id, b: r.b, seed: r.id, x: r.x + r.off[0], z: r.z + r.off[1], yaw: r.yaw, floor: r.floor, walking: r.walking, inCar: r.st === "enter" || r.st === "ride", riding: r.st === "ride", lean: r.lean, reach: r.reach, key: r.key, door: r.st === "lobbyIn" || r.st === "lobbyOut" ? { leaf: r.st === "lobbyIn" ? "right" : "left", t: now - r.since } : null }));
    this.noteDoors(now);
    if (link && now >= this.publishAt) {
      const busy = this.sim.length > 0 || [...this.cars.values()].some((c) => c.phase !== "idle");
      this.publishAt = now + (busy ? 0.25 : 1.5);
      link.publish({ cars: Object.fromEntries(this.cars), riders: this.riders, aptDoors: Object.fromEntries(this.aptDoors) });
    }
  }

  /** A resident starting through the lobby's door (in or out): its leaf swings for them (once per passage). */
  private noteDoors(now: number) {
    for (const r of this.riders) {
      if (!r.door) continue;
      const id = `${r.id}|${r.door.leaf}|${Math.round((now - r.door.t) * 2)}`;
      if (this.seenDoor.has(id)) continue;
      this.seenDoor.add(id);
      const lead = r.door.leaf === "right" ? enterLead(LOBBY_IN) : leaveLead(LOBBY_OUT);
      this.doorUses.push({ key: r.b, leaf: r.door.leaf, at: now - r.door.t, lead });
    }
    if (this.seenDoor.size > 200) this.seenDoor.clear();
    this.doorUses = this.doorUses.filter((u) => now - u.at < 30);
  }

  private stepPeople(dt: number, now: number, peers: LiftPeer[]) {
    const shown = new Set(peers.map((p) => p.b).filter((b): b is string => !!b && this.byKey.has(b)));
    // Arrivals and departures: shown where a player is (or near); otherwise straight home / straight out.
    // (One through the street door at a time: whoever comes while someone's still coming in waits outside a moment.)
    const later: typeof this.queueIn = [];
    for (const q of this.queueIn.splice(0)) {
      const bb = this.byKey.get(q.b);
      if (!bb || this.sim.some((r) => r.id === q.id)) continue;
      if (!q.direct && shown.has(q.b) && this.sim.some((r) => r.b === q.b && r.st === "lobbyIn" || r.b === q.b && r.st === "toLift" && r.from === 1 && r.d < 1.4)) { later.push(q); continue; }
      const floors = this.rented(q.b), floor = this.homes.get(q.id)?.b === q.b ? this.homes.get(q.id)!.floor : floors[Math.floor(Math.random() * floors.length)] ?? 2 + Math.floor(Math.random() * (APT_FLOORS - 1));
      if (!shown.has(q.b) || q.direct) { this.homes.set(q.id, { b: q.b, floor }); continue; }
      this.sim.push(this.rider(q.id, q.b, 1, floor, "lobbyIn", now, LOBBY_IN));
    }
    this.queueIn.push(...later);
    for (const q of this.queueOut.splice(0)) {
      const bb = this.byKey.get(q.b);
      if (!bb) continue;
      const home = this.homes.get(q.id);
      const floor = home?.b === q.b ? home.floor : 2 + Math.floor(Math.random() * (APT_FLOORS - 1));
      this.homes.delete(q.id);
      if (!shown.has(q.b)) { this.out(bb, q.id); continue; }
      const h = this.hall(bb, floor);
      this.sim.push(this.rider(q.id, q.b, floor, 1, "aptOut", now, [h.stand[0], h.f.wallZ + INNER_WALL + 0.9]));
    }
    // Nobody about any more: everyone in the building gets where they were going (home, or out).
    this.sim = this.sim.filter((r) => {
      if (shown.has(r.b)) return true;
      const bb = this.byKey.get(r.b)!;
      if (r.to > 1) this.homes.set(r.id, { b: r.b, floor: r.to }); else this.out(bb, r.id);
      return false;
    });
    this.aptDoors.clear();
    this.shutting = this.shutting.filter((d) => now - d.at < 1.6);
    for (const d of this.shutting) this.aptDoors.set(d.key, Math.max(this.aptDoors.get(d.key) ?? 0, d.a * (1 - smooth((now - d.at) / 1.5))));
    const others = (r: Rider) => [
      ...this.sim.filter((o) => o !== r && o.b === r.b && o.floor === r.floor).map((o) => [o.x + o.off[0], o.z + o.off[1]] as P2),
      ...peers.filter((p) => p.b === r.b && p.floor === r.floor && p.x !== undefined).map((p) => [p.x!, p.z!] as P2),
    ];
    /** Who's waiting for the car on r's floor of r's building, first come first. */
    const waiting = (r: Rider) => this.sim.filter((o) => o.b === r.b && o.st === "wait" && o.from === r.from && o !== r || o === r && r.st === "wait").sort((a, b) => a.since - b.since || a.id - b.id);
    for (const r of this.sim) {
      const bb = this.byKey.get(r.b)!, sh = shaftOf(bb), c = this.car(r.b), t = now - r.since;
      r.reach = null; r.key = false; r.lean = 0;
      const next = (st: Stage, path: P2[] = []) => { r.st = st; r.path = path; r.d = 0; r.since = now; };
      // Walking a way: slowing for anyone just ahead and stepping round them (never into anyone).
      const walk = () => {
        const p0 = along(r.path, r.d), ahead = along(r.path, r.d + 0.4), dx = ahead.x - p0.x, dz = ahead.z - p0.z, l = Math.hypot(dx, dz) || 1;
        let slow = 1, push: P2 = [0, 0];
        for (const [ox, oz] of others(r)) {
          const ex = ox - (r.x + r.off[0]), ez = oz - (r.z + r.off[1]), d = Math.hypot(ex, ez);
          if (d < 0.9 && (ex * dx + ez * dz) / l > 0.1) slow = Math.min(slow, Math.max(0.15, (d - 0.45) / 0.45));
          if (d < 0.75 && d > 1e-3) { const side = (-dz * ex + dx * ez) / l > 0 ? -1 : 1; push = [push[0] + (-dz / l) * side * (0.75 - d), push[1] + (dx / l) * side * (0.75 - d)]; }
        }
        const k = 1 - Math.exp(-4 * dt);
        r.off = [Math.max(-0.45, Math.min(0.45, r.off[0] + (push[0] * 1.5 - r.off[0] * 0.3) * k)), Math.max(-0.45, Math.min(0.45, r.off[1] + (push[1] * 1.5 - r.off[1] * 0.3) * k))];
        r.d += SPEED * slow * dt; const p = along(r.path, r.d); r.x = p.x; r.z = p.z; r.yaw = p.yaw; r.walking = r.d < len(r.path); return !r.walking;
      };
      const settle = () => { r.off = [r.off[0] * Math.exp(-3 * dt), r.off[1] * Math.exp(-3 * dt)]; };
      const slotAt = (k: number): P2 => [sh.cx + SLOTS[k]![0], sh.cz + SLOTS[k]![1]];
      if (r.st === "lobbyIn") {
        // In through the street door (it opens for them).
        const total = ENTER.done + enterLead(LOBBY_IN), pose = enterPose(Math.min(t, total), LOBBY_IN, Math.PI);
        r.x = pose.x; r.z = pose.z; r.yaw = pose.yaw; r.lean = pose.lean; r.walking = true;
        if (t >= ENTER.free + enterLead(LOBBY_IN)) next("toLift", [[r.x, r.z], ...this.lobbyPath(bb).slice(1)]);
      } else if (r.st === "toLift") {
        // To the elevator — or, with others already waiting, to the end of their line (back along the way in).
        const ahead = waiting(r).length, stop = len(r.path) - QUEUE_GAP * ahead;
        if (ahead > 0 && r.d >= stop - 0.02) { r.st = "wait"; r.since = now; r.walking = false; request(c, r.from); }
        else if (walk()) { r.st = "wait"; r.since = now; r.yaw = Math.atan2(sh.cx - r.x, sh.cz - r.z); request(c, r.from); }
      } else if (r.st === "wait") {
        settle();
        // In line: each one QUEUE_GAP behind the one ahead, stepping up as the line moves.
        const line = waiting(r), place = line.indexOf(r), spot = len(r.path) - QUEUE_GAP * Math.max(0, place);
        if (r.d < spot - 0.02) {
          r.d = Math.min(spot, r.d + SPEED * 0.8 * dt);
          const p = along(r.path, r.d); r.x = p.x; r.z = p.z; r.yaw = p.yaw; r.walking = true;
        } else { r.walking = false; if (place === 0) r.yaw = Math.atan2(sh.cx - r.x, sh.cz - r.z); }
        const taken = new Set(this.sim.filter((o) => o !== r && o.b === r.b && (o.st === "enter" || o.st === "ride")).map((o) => o.slot));
        const free = [0, 1, 2, 3].find((k) => !taken.has(k));
        // One at a time through the doors: the first in line, once whoever went in before is clear of the doorway.
        const doorwayBusy = this.sim.some((o) => o !== r && o.b === r.b && o.st === "enter" && o.d < 1.3);
        if (place === 0 && !r.walking && !doorwayBusy && atFloor(c, r.from) && doorsOf(c) > 0.9 && free !== undefined && this.occupancy(r.b, peers) < CAPACITY) {
          r.slot = free; next("enter", [[r.x, r.z], [sh.cx, sh.front - 0.3], slotAt(free)]);
        } else if (atFloor(c, r.from) ? c.phase === "idle" : !c.stops.includes(r.from)) request(c, r.from);
      } else if (r.st === "enter") {
        if (walk()) { next("ride"); request(c, r.to); }
      } else if (r.st === "ride") {
        settle();
        r.floor = carFloor(c); r.walking = false; r.yaw = 0;
        // Off one at a time too: after whoever got off before is clear of the doorway.
        const doorwayBusy = this.sim.some((o) => o !== r && o.b === r.b && o.st === "exit" && o.floor === r.to && o.d < 1.3);
        if (atFloor(c, r.to) && doorsOf(c) > 0.9 && !doorwayBusy) {
          r.floor = r.to;
          if (r.to > 1) { const h = this.hall(bb, r.to); next("exit", [[r.x, r.z], [sh.cx, sh.front - 0.3], ...[...h.toLift].reverse()]); }
          else next("exit", [[r.x, r.z], [sh.cx, sh.front - 0.3], sh.out, [0, sh.front + 1.1], LOBBY_OUT]);
        } else if (!atFloor(c, r.to) && !c.stops.includes(r.to)) request(c, r.to);
      } else if (r.st === "exit") {
        if (walk()) {
          if (r.to > 1) next("key");
          else { next("lobbyOut"); }
        }
      } else if (r.st === "key") {
        // At their door: the key into the lock (in hand), a turn, back in the pocket.
        settle();
        const h = this.hall(bb, r.to), lock: [number, number, number] = [h.f.door.x - 0.13, 1.05, h.f.wallZ - 0.05];
        r.x = h.stand[0]; r.z = h.stand[1]; r.yaw = 0; r.walking = false; r.key = t < KEY_T - 0.2;
        const reach = smooth(t / KEY.reach), turn = smooth((t - KEY.reach) / KEY.turn), back = smooth((t - KEY.reach - KEY.turn) / KEY.back);
        r.reach = [lock[0] + 0.03 * Math.sin(turn * Math.PI), lock[1] + 0.02 * turn, lock[2], reach * (1 - back)];
        if (t >= KEY_T) next("inApt");
      } else if (r.st === "inApt") {
        // Pushing the door open into their apartment, through, and it swings shut behind them: home.
        const h = this.hall(bb, r.to), from: P2 = [-0.45, -0.72], total = LEAVE.done + leaveLead(from), pose = leavePose(Math.min(t, total), from, 0);
        const dx = h.f.door.x, oz = h.f.wallZ + INNER_WALL, squeeze = (v: number) => (v > 0.35 ? 0.35 + (v - 0.35) * 0.35 : v);
        r.x = dx + pose.x; r.z = oz + squeeze(pose.z); r.yaw = pose.yaw; r.lean = pose.lean; r.walking = true;
        if (r.slot !== -2) this.aptDoors.set(h.f.key, pose.door.left);
        if (pose.right) r.reach = [dx + pose.right.at[0], pose.right.at[1], oz + pose.right.at[2], pose.right.blend];
        // Through: the door swings shut behind them (they walk on in), and they're home.
        if (t >= LEAVE.free + leaveLead(from) && r.slot !== -2) { r.slot = -2; this.shutting.push({ key: h.f.key, a: pose.door.left, at: now }); }
        if (t >= total) { this.homes.set(r.id, { b: r.b, floor: r.to }); r.d = -1; }
      } else if (r.st === "aptOut") {
        // Out of their door (pulled open from inside), into the hallway.
        const h = this.hall(bb, r.from), dx = h.f.door.x, oz = h.f.wallZ + INNER_WALL, from: P2 = [0.5, 0.9], free = ENTER.free + enterLead(from), done = ENTER.done + enterLead(from);
        const pose = enterPose(Math.min(t, done), from, -Math.PI);
        const squeeze = (v: number) => (v < -0.35 ? -0.35 + (v + 0.35) * 0.35 : v);
        r.x = dx - pose.x; r.z = oz + squeeze(pose.z); r.yaw = -pose.yaw; r.lean = pose.lean; r.walking = true;
        this.aptDoors.set(h.f.key, pose.door.right);
        if (pose.left) r.reach = [dx - pose.left.at[0], pose.left.at[1], oz + pose.left.at[2], pose.left.blend];
        if (t >= free) { this.shutting.push({ key: h.f.key, a: pose.door.right, at: now }); next("toLift", [[r.x, r.z], ...h.toLift.slice(1)]); }
      } else if (r.st === "lobbyOut") {
        // Out through the street door, onto the sidewalk: back to the street.
        const total = LEAVE.done + leaveLead(LOBBY_OUT), pose = leavePose(Math.min(t, total), LOBBY_OUT, 0);
        r.x = pose.x; r.z = pose.z; r.yaw = pose.yaw; r.lean = pose.lean; r.walking = true;
        if (t >= LEAVE.free + leaveLead(LOBBY_OUT)) { this.out(bb, r.id, r.x, r.z); r.d = -1; }
      }
    }
    this.sim = this.sim.filter((r) => r.d !== -1);
  }
  private rider(id: number, b: string, from: number, to: number, st: Stage, now: number, at: P2): Rider {
    return { id, b, from, to, st, path: [], d: 0, slot: -1, since: now, x: at[0], z: at[1], yaw: 0, walking: true, floor: from, lean: 0, reach: null, key: false, off: [0, 0] };
  }
  /** Someone out of the lobby's door onto the sidewalk (world), for the street to take back. */
  private out(b: Building, id: number, x = -0.45, z = 2.6) {
    const L = venueLayout(b), [wx, wz] = toWorld(L.frame, x, Math.max(z, 2.4));
    this.outbox.push({ id, x: wx, z: wz, yaw: L.frame.rot });
  }
}
export { OPENER_PASS };
