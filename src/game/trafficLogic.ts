import { CROSSWALK, TRAFFIC_FOLLOW_GAP, brakingGap, isSignalled, nearestStreet, nextStreet, signalState, stopLineFrom, streetHalfWidth, forwardDistance, queueMayResume, roadForward, sameRoad, VEHICLE_SIZE, type RoadPath, type VehicleKind } from "./config";
import type { RoadIncident } from "./state";
import { pointAlongTurn, turnSample, type TrafficTurn } from "./trafficRoutes";

export type TrafficAgent = RoadPath & { id: number; kind: VehicleKind; x: number; z: number; vx: number; vz: number; speed: number; heldBy: number | null; crashUntil: number; brake: boolean; turn?: unknown };
export function holdAccidentQueue(vehicles: TrafficAgent[], source: TrafficAgent, incident: RoadIncident) {
  for (const vehicle of vehicles) {
    if (vehicle.id !== source.id && sameRoad(vehicle, source) && forwardDistance(source, [vehicle.x, vehicle.z], incident.origin) > 0) vehicle.heldBy = source.id;
  }
}
export function trafficTargetSpeed(vehicle: TrafficAgent, all: TrafficAgent[], incidents: RoadIncident[], now: number) {
  if (now < vehicle.crashUntil) return 0;
  let hold: RoadIncident | undefined;
  if (vehicle.heldBy !== null) for (let i = incidents.length - 1; i >= 0; i--) {
    const incident = incidents[i];
    if (incident?.vehicleId === vehicle.heldBy) { hold = incident; break; }
  }
  if (hold && !queueMayResume(hold.stoodUpAt, now) && !(hold.scooterCrash && now - hold.startedAt >= 15 && hold.stoodUpAt !== null)) return 0;
  if (hold) vehicle.heldBy = null;
  let target = vehicle.speed;
  const [length, , width] = VEHICLE_SIZE[vehicle.kind];
  // In a turn, a vehicle checks the path its curve will actually take, a point at a time, for anything on it.
  const myTurn = vehicle.turn as TrafficTurn | null | undefined;
  const turning = myTurn && myTurn.progress > 0.02;
  const path = turning ? Array.from({ length: 18 }, (_, k) => ({ d: length / 2 + k * 1.2, ...pointAlongTurn(myTurn, myTurn.progress, length / 2 + k * 1.2) })) : [];
  const [fx, fz] = turning ? (() => { const yaw = turnSample(myTurn, myTurn.progress).yaw; return [Math.cos(yaw), -Math.sin(yaw)]; })() : roadForward(vehicle);
  for (const other of all) {
    if (other.id === vehicle.id) continue;
    const dx = other.x - vehicle.x; const dz = other.z - vehicle.z;
    if (turning) {
      if (Math.abs(dx) > 35 || Math.abs(dz) > 35) continue;
      const otherSwinging = ((other.turn as { progress?: number } | null | undefined)?.progress ?? 0) > 0.02;
      const [ol, , ow] = VEHICLE_SIZE[other.kind];
      const hx = other.axis === "x" || otherSwinging ? ol / 2 : ow / 2, hz = other.axis === "z" || otherSwinging ? ol / 2 : ow / 2;
      for (const p of path) {
        const ox = Math.max(0, Math.abs(p.x - other.x) - hx), oz = Math.max(0, Math.abs(p.z - other.z) - hz);
        if (Math.hypot(ox, oz) < width / 2 + 0.35) {
          const gap = p.d - length / 2 - 0.6;
          target = Math.min(target, gap < 1 ? 0 : Math.sqrt(2 * 3 * gap));
          break;
        }
      }
      continue;
    }
    const ahead = dx * fx + dz * fz;
    const lateral = Math.abs(dx * fz - dz * fx);
    // A vehicle swinging through a turn sticks out every which way: treat it as wide as it is long.
    const swinging = ((other.turn as { progress?: number } | null | undefined)?.progress ?? 0) > 0.02;
    const halfOther = other.axis === vehicle.axis && !swinging ? VEHICLE_SIZE[other.kind][0] / 2 : swinging ? VEHICLE_SIZE[other.kind][0] / 2 : VEHICLE_SIZE[other.kind][2] / 2;
    const crossOther = other.axis === vehicle.axis && !swinging ? VEHICLE_SIZE[other.kind][2] / 2 : VEHICLE_SIZE[other.kind][0] / 2;
    const gap = ahead - VEHICLE_SIZE[vehicle.kind][0] / 2 - halfOther;
    if (ahead > 0 && lateral < VEHICLE_SIZE[vehicle.kind][2] / 2 + crossOther + 0.4 && gap < brakingGap(Math.hypot(vehicle.vx, vehicle.vz))) {
      const leaderSpeed = Math.max(0, other.vx * fx + other.vz * fz);
      target = Math.min(target, gap < TRAFFIC_FOLLOW_GAP ? 0 : leaderSpeed + Math.max(0, gap - TRAFFIC_FOLLOW_GAP) * 0.5);
    }
    // Yield predictively at crossings, using stable ID priority to avoid deadlock.
    if (other.axis !== vehicle.axis && vehicle.id > other.id) {
      const rvx = vehicle.vx - other.vx; const rvz = vehicle.vz - other.vz;
      const relativeSpeed2 = rvx * rvx + rvz * rvz;
      const closestTime = relativeSpeed2 > 0.1 ? (dx * rvx + dz * rvz) / relativeSpeed2 : -1;
      if (closestTime > 0 && closestTime < 2 && Math.hypot(dx - rvx * closestTime, dz - rvz * closestTime) < (VEHICLE_SIZE[vehicle.kind][0] + VEHICLE_SIZE[other.kind][0]) / 2 + 1) target = 0;
    }
  }
  return Math.max(0, target);
}
/**
 * At a signalled intersection ahead, how far the vehicle's front is from where it must stop (m), or null when
 * it may go on: the light is green, there is no signal ahead, or its front is already on the crossing (so on a
 * yellow it carries on through rather than stopping on the zebra).
 */
export function signalStopDistance(axis: "x" | "z", dir: 1 | -1, t: number, roadCenter: number, length: number, elapsed: number): number | null {
  let c = nextStreet(t - dir * 40, dir);
  for (let n = 0; n < 5; n++, c = nextStreet(c, dir)) {
    const rel = (c - t) * dir;
    if (rel > 90) break;
    const [ix, iz] = axis === "x" ? [c, roadCenter] : [roadCenter, c];
    if (rel < -streetHalfWidth(c) || !isSignalled(ix, iz)) continue;
    if (signalState(axis, elapsed) === "green") return null;
    const toLine = rel - stopLineFrom(c) - length / 2;
    return toLine < -0.3 ? null : toLine;
  }
  return null;
}

// ---------- right of way at intersections ----------

export type Move = "straight" | "right" | "left";
/** Where another vehicle comes from, as the vehicle deciding sees it. */
export type Relation = "opposite" | "right" | "left";
/** A vehicle as the intersection rules see it: which way it came in, where it is, and what it is doing there. */
export type CrossingAgent = {
  id: number; x: number; z: number;
  /** The road it came in on (its axis, direction and centre line) and how along that road it is. */
  axis: "x" | "z"; dir: 1 | -1; road: number; t: number;
  length: number; speed: number; move: Move;
  /** Stopped last frame to give way here. */
  waiting: boolean;
  /** At the corner last frame with nothing to give way to: pulling away into the intersection. */
  going: boolean;
};

/** The intersection a vehicle is at or coming up to: the crossing street's centre along its road, and the box. */
export function crossingOf(a: CrossingAgent) {
  const near = nearestStreet(a.t);
  const c = (near - a.t) * a.dir > -(streetHalfWidth(near) + a.length / 2) ? near : nextStreet(near, a.dir);
  const [ix, iz] = a.axis === "x" ? [c, a.road] : [a.road, c];
  const front = a.t + a.dir * a.length / 2;
  // How far its front is from the box's near edge (negative once in).
  const toEntry = (c - a.dir * streetHalfWidth(c) - front) * a.dir;
  return { c, ix, iz, toEntry };
}
/** Whether any of the vehicle is in the intersection box at (ix, iz). */
export function inBox(a: CrossingAgent, ix: number, iz: number) {
  const reach = a.length * 0.4;
  return Math.abs(a.x - ix) < streetHalfWidth(ix) + reach && Math.abs(a.z - iz) < streetHalfWidth(iz) + reach;
}
/** Where `other` comes from, seen by `me` (null: the same way, i.e. ahead or behind in the same flow). */
export function relationOf(me: { axis: "x" | "z"; dir: 1 | -1 }, other: { axis: "x" | "z"; dir: 1 | -1 }): Relation | null {
  if (me.axis === other.axis) return me.dir === other.dir ? null : "opposite";
  // My right-hand side: heading +x it is +z, heading +z it is -x. Someone heading toward my right came from my left.
  const [fx, fz] = me.axis === "x" ? [me.dir, 0] : [0, me.dir];
  const [ox, oz] = other.axis === "x" ? [other.dir, 0] : [0, other.dir];
  return ox * -fz + oz * fx > 0 ? "left" : "right";
}

/**
 * Who gives way to whom (right-hand traffic):
 * - Turning right: wait only for traffic from the left going straight (and, if already in the box, an oncoming
 *   left turn heading for the same lane). Oncoming straight traffic and anything from the right never stop it.
 * - Turning left: wait for anything oncoming, anything from the left, and traffic from the right unless it is
 *   turning right.
 * - Straight on: never waits for someone still coming up to the intersection (they give way to it), only for a
 *   path already in the box that crosses or joins its own: an oncoming left turn, anything from the right, or
 *   anything from the left but a right turn.
 */
export function mustGiveWay(mine: Move, from: Relation, theirs: Move, theyAreIn: boolean) {
  if (mine === "right") return (from === "left" && theirs === "straight") || (theyAreIn && from === "opposite" && theirs === "left");
  if (mine === "left") return from === "opposite" || from === "left" || (from === "right" && theirs !== "right");
  if (!theyAreIn) return false;
  if (from === "opposite") return theirs === "left";
  if (from === "right") return true;
  return theirs !== "right";
}

/**
 * How far this vehicle may still go before it has to wait at the intersection ahead (from its front), or null if
 * it need not wait: it is already in the box (committed), or nobody it must give way to is in it or coming.
 * Someone coming counts while within 30 m of the box and moving, or waiting there with a lower id (so two
 * vehicles that both give way to each other never both wait for ever).
 */
export function crossingStopDistance(me: CrossingAgent, all: readonly CrossingAgent[]): number | null {
  const mine = crossingOf(me);
  if (mine.toEntry < -0.3 || mine.toEntry > 45) return null;
  for (const other of all) {
    if (other.id === me.id) continue;
    const from = relationOf(me, other);
    const theirs = crossingOf(other);
    if (Math.abs(theirs.ix - mine.ix) > 1 || Math.abs(theirs.iz - mine.iz) > 1) continue;
    const inside = inBox(other, mine.ix, mine.iz) && theirs.toEntry < 0.5;
    if (!from) {
      // The same way: someone ahead still swinging through a turn in the box is waited for at the corner.
      if (inside && other.move !== "straight" && me.move !== "straight" && (other.t - me.t) * me.dir > 0) {
        const signalled = isSignalled(mine.ix, mine.iz);
        return mine.toEntry - (signalled ? CROSSWALK.gap + CROSSWALK.width + 0.4 : 1.2);
      }
      continue;
    }
    // Someone coming: moving up to the box, pulling away from the corner into it, or (both waiting, and this one
    // not already pulling away) ahead by id.
    const coming = !inside && theirs.toEntry >= -0.3 && theirs.toEntry < 30 && (other.speed > 0.5 || other.going || (other.waiting && other.id < me.id && !me.going));
    // Two pulling away into crossing paths at once: the lower id goes first (as if already in the box).
    const racing = !inside && other.going && other.id < me.id && theirs.toEntry < 6;
    if ((inside || coming || racing) && mustGiveWay(me.move, from, other.move, inside || racing)) {
      const signalled = isSignalled(mine.ix, mine.iz);
      return mine.toEntry - (signalled ? CROSSWALK.gap + CROSSWALK.width + 0.4 : 1.2);
    }
  }
  return null;
}
