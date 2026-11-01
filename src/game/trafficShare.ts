// Sharing traffic across a multiplayer room (pure, testable): the host runs the vehicles and publishes where
// they are; everyone else draws them a moment in the past, smoothly in between the snapshots.

/** One vehicle: [id, x, z, yaw, vx, vz, flags, lane, slot]; flags: 1 braking, 2 on the z axis, 4 heading -1, 8 avenue. */
export type TrafficRow = [number, number, number, number, number, number, number, number, number];
export type TrafficSnapshot = { v: 1; rows: TrafficRow[] };

/** How the traffic is shared in a room (null playing alone: this player runs it). */
export type TrafficLink = {
  isHost: () => boolean;
  publish: (snapshot: TrafficSnapshot) => void;
  /** The host's latest snapshot, and when it arrived here (ms), or null. */
  latest: () => { snapshot: TrafficSnapshot; at: number } | null;
  /** This player was knocked down by vehicle `id` (the host stops it). */
  sendHit: (id: number) => void;
  /** Vehicles other players were hit by, since last asked (host only). */
  takeHits: () => number[];
};

export const TRAFFIC_SEND_SECONDS = 0.1;
/** Others draw the traffic this far in the past, so there is always a snapshot either side. */
export const TRAFFIC_DELAY_MS = 180;

const r2 = (n: number) => Math.round(n * 100) / 100;
export function trafficRow(id: number, x: number, z: number, yaw: number, vx: number, vz: number, brake: boolean, axis: "x" | "z", dir: 1 | -1, central: boolean, lane: number, slot: number): TrafficRow {
  return [id, r2(x), r2(z), r2(yaw), r2(vx), r2(vz), (brake ? 1 : 0) | (axis === "z" ? 2 : 0) | (dir === -1 ? 4 : 0) | (central ? 8 : 0), r2(lane), slot];
}

export function readTrafficSnapshot(value: unknown): TrafficSnapshot | null {
  const v = value as { v?: unknown; rows?: unknown } | null;
  if (typeof v !== "object" || v === null || v.v !== 1) return null;
  // The realtime database can hand lists back as objects keyed by index, and leaves out empty ones.
  const list = Array.isArray(v.rows) ? v.rows : typeof v.rows === "object" && v.rows !== null ? Object.values(v.rows) : [];
  const rows = list.filter((row): row is TrafficRow => Array.isArray(row) && row.length === 9 && row.every((n) => typeof n === "number" && Number.isFinite(n)));
  return { v: 1, rows };
}

const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** A vehicle as drawn at one moment. */
export type TrafficPose = { x: number; z: number; yaw: number; vx: number; vz: number; flags: number; lane: number; slot: number };

/**
 * The last few snapshots received, and each vehicle where it was `TRAFFIC_DELAY_MS` ago: in between the two
 * snapshots around that moment, or carried on from the newest at its speed for a moment if none is newer.
 * A vehicle that jumped (moved to a new road) is not slid across the city.
 */
export class TrafficBuffer {
  private shots: { at: number; rows: Map<number, TrafficRow> }[] = [];
  push(snapshot: TrafficSnapshot, at: number) {
    const last = this.shots[this.shots.length - 1];
    if (last && at <= last.at) return;
    this.shots.push({ at, rows: new Map(snapshot.rows.map((row) => [row[0], row])) });
    while (this.shots.length > 4) this.shots.shift();
  }
  get size() { return this.shots.length; }
  sample(id: number, now: number): TrafficPose | null {
    const t = now - TRAFFIC_DELAY_MS;
    let a: { at: number; rows: Map<number, TrafficRow> } | undefined, b: typeof a;
    for (const s of this.shots) { if (s.at <= t) a = s; else { b = s; break; } }
    const pose = (row: TrafficRow, ahead = 0): TrafficPose => ({ x: row[1] + row[4] * ahead, z: row[2] + row[5] * ahead, yaw: row[3], vx: row[4], vz: row[5], flags: row[6], lane: row[7], slot: row[8] });
    const ra = a?.rows.get(id), rb = b?.rows.get(id);
    if (ra && rb && a && b) {
      if (Math.hypot(rb[1] - ra[1], rb[2] - ra[2]) > 15) return pose(rb);
      const k = (t - a.at) / Math.max(1, b.at - a.at);
      return { x: ra[1] + (rb[1] - ra[1]) * k, z: ra[2] + (rb[2] - ra[2]) * k, yaw: lerpAngle(ra[3], rb[3], k), vx: ra[4] + (rb[4] - ra[4]) * k, vz: ra[5] + (rb[5] - ra[5]) * k, flags: k < 0.5 ? ra[6] : rb[6], lane: rb[7], slot: rb[8] };
    }
    if (ra && a) return pose(ra, Math.min(0.3, (t - a.at) / 1000));
    if (rb) return pose(rb);
    return null;
  }
}
