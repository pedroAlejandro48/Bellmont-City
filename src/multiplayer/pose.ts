import * as THREE from "three";
import type { AvatarRig } from "@/game/state";

/**
 * One player's look at one instant, as sent to room peers in presence (well under its 4 KiB cap).
 * Each transform is 7 numbers: position xyz then quaternion xyzw.
 * - `b`: the animated body, one transform per BODY_PARTS group (root first); `bv` 0 while it is hidden.
 * - `r`: the ragdoll's part transforms, only while it is shown (knocked down / getting up).
 * - `s`: the controlled bike's root transform, then its front wheel's steering angle; `sf` bits: 1 riding,
 *   2 braking, 4 controls a bike (else `s` is meaningless and no bike is drawn with this player).
 */
export type PoseWire = { ts: number; b: number[]; bv: 0 | 1; r?: number[]; s: number[]; sf: number };

export const SEND_HZ = 30;
/** Remote players are drawn this far in the past so there is almost always a newer pose to blend toward. */
export const RENDER_DELAY_MS = 80;

const round = (n: number) => Math.round(n * 1000) / 1000;

function pushTransform(out: number[], o: THREE.Object3D) {
  const p = o.position, q = o.quaternion;
  out.push(round(p.x), round(p.y), round(p.z), round(q.x), round(q.y), round(q.z), round(q.w));
}

export function capturePose(rig: AvatarRig, scooter: { riding: boolean; braking: boolean; id: string | null }, ts: number): PoseWire | null {
  const root = rig.body[0];
  const bike = rig.scooter[0];
  if (!root || !bike) return null;
  const b: number[] = [];
  for (const part of rig.body) pushTransform(b, part);
  const s: number[] = [];
  pushTransform(s, bike);
  s.push(round(rig.scooter[1]?.rotation.y ?? 0));
  const pose: PoseWire = { ts, b, bv: root.visible ? 1 : 0, s, sf: (scooter.riding ? 1 : 0) | (scooter.braking ? 2 : 0) | (scooter.id !== null ? 4 : 0) };
  if (rig.ragdoll[1]?.visible) {
    const r: number[] = [];
    for (const part of rig.ragdoll) pushTransform(r, part);
    pose.r = r;
  }
  return pose;
}

export function isPoseWire(value: unknown): value is PoseWire {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["ts"] === "number" && Array.isArray(v["b"]) && Array.isArray(v["s"]) && v["b"].every((n) => typeof n === "number")
    && v["s"].every((n) => typeof n === "number") && (v["r"] === undefined || (Array.isArray(v["r"]) && v["r"].every((n) => typeof n === "number")));
}

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();

/** Blends transform `i` of two packed arrays into `o`. */
function blendTransform(o: THREE.Object3D, a: number[], b: number[], i: number, t: number) {
  const k = i * 7;
  if (b.length < k + 7) return;
  const from = a.length >= k + 7 ? a : b;
  o.position.set(
    THREE.MathUtils.lerp(from[k]!, b[k]!, t),
    THREE.MathUtils.lerp(from[k + 1]!, b[k + 1]!, t),
    THREE.MathUtils.lerp(from[k + 2]!, b[k + 2]!, t),
  );
  qa.set(from[k + 3]!, from[k + 4]!, from[k + 5]!, from[k + 6]!).normalize();
  qb.set(b[k + 3]!, b[k + 4]!, b[k + 5]!, b[k + 6]!).normalize();
  o.quaternion.slerpQuaternions(qa, qb, t);
}

export type RemoteRig = { body: (THREE.Object3D | null)[]; ragdoll: (THREE.Object3D | null)[]; scooter: THREE.Object3D | null; front: THREE.Object3D | null };

/** Poses the remote player's scene objects between two received poses. */
export function applyPose(rig: RemoteRig, a: PoseWire, b: PoseWire, t: number) {
  rig.body.forEach((o, i) => { if (o) blendTransform(o, a.b, b.b, i, t); });
  const root = rig.body[0];
  if (root) root.visible = b.bv === 1;
  const ragdoll = b.r;
  rig.ragdoll.forEach((o, i) => {
    if (!o) return;
    o.visible = !!ragdoll;
    if (ragdoll) blendTransform(o, a.r ?? ragdoll, ragdoll, i, t);
  });
  if (rig.scooter) {
    rig.scooter.visible = (b.sf & 4) === 4;
    // Never slide a bike across the map when its rider swaps bikes: snap instead.
    blendTransform(rig.scooter, (a.sf & 4) === 4 && Math.hypot(a.s[0]! - b.s[0]!, a.s[2]! - b.s[2]!) < 3 ? a.s : b.s, b.s, 0, t);
  }
  if (rig.front) rig.front.rotation.y = THREE.MathUtils.lerp(a.s[7] ?? 0, b.s[7] ?? 0, t);
}

/**
 * The last few poses from one peer, drawn RENDER_DELAY_MS behind. The sender's timestamps keep the
 * spacing true; the smallest recent arrival-minus-send gap absorbs clock skew and the base latency.
 */
export class PoseBuffer {
  private samples: PoseWire[] = [];
  private gaps: { at: number; gap: number }[] = [];

  push(pose: PoseWire, arrivedAt: number) {
    const last = this.samples[this.samples.length - 1];
    if (last && pose.ts <= last.ts) return;
    this.samples.push(pose);
    if (this.samples.length > 12) this.samples.shift();
    this.gaps.push({ at: arrivedAt, gap: arrivedAt - pose.ts });
    while (this.gaps.length > 1 && arrivedAt - this.gaps[0]!.at > 3000) this.gaps.shift();
  }

  latest() { return this.samples[this.samples.length - 1] ?? null; }

  /** The two poses around the render instant and the blend between them, or null before any pose. */
  sample(now: number): { a: PoseWire; b: PoseWire; t: number } | null {
    const newest = this.latest();
    if (!newest) return null;
    const offset = Math.min(...this.gaps.map((g) => g.gap));
    const at = now - offset - RENDER_DELAY_MS;
    for (let i = this.samples.length - 1; i > 0; i--) {
      const a = this.samples[i - 1]!, b = this.samples[i]!;
      if (a.ts <= at && at <= b.ts) return { a, b, t: b.ts === a.ts ? 1 : (at - a.ts) / (b.ts - a.ts) };
    }
    const oldest = this.samples[0]!;
    return at < oldest.ts ? { a: oldest, b: oldest, t: 1 } : { a: newest, b: newest, t: 1 };
  }
}
