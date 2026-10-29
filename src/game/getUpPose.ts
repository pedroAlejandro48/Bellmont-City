// Pure keyframed stand-up: all fours -> kneel with right foot planted -> push up -> stand.
// Local frame: +z is facing, +x is the character's left. Units in meters.
export type V3 = [number, number, number];
export type Joint = "hipL" | "hipR" | "kneeL" | "kneeR" | "footL" | "footR" | "neck" | "head" | "shL" | "shR" | "elL" | "elR" | "handL" | "handR";
export type Pose = Record<Joint, V3>;

const FOURS: Pose = {
  hipL: [0.13, 0.55, -0.1], hipR: [-0.13, 0.55, -0.1], kneeL: [0.13, 0.08, -0.05], kneeR: [-0.13, 0.08, -0.05],
  footL: [0.13, 0.06, -0.5], footR: [-0.13, 0.06, -0.5], neck: [0, 0.6, 0.45], head: [0, 0.72, 0.7],
  shL: [0.2, 0.6, 0.45], shR: [-0.2, 0.6, 0.45], elL: [0.21, 0.33, 0.47], elR: [-0.21, 0.33, 0.47], handL: [0.2, 0.05, 0.5], handR: [-0.2, 0.05, 0.5],
};
const KNEEL: Pose = {
  hipL: [0.13, 0.6, 0], hipR: [-0.13, 0.6, 0], kneeL: [0.13, 0.08, -0.1], kneeR: [-0.13, 0.55, 0.46],
  footL: [0.13, 0.06, -0.55], footR: [-0.13, 0.04, 0.46], neck: [0, 1.12, 0.18], head: [0, 1.36, 0.25],
  shL: [0.2, 1.1, 0.18], shR: [-0.2, 1.1, 0.18], elL: [0.45, 0.97, 0.2], elR: [-0.22, 0.83, 0.3], handL: [0.66, 0.9, 0.25], handR: [-0.17, 0.6, 0.42],
};
const PUSH: Pose = {
  hipL: [0.13, 0.88, 0.28], hipR: [-0.13, 0.88, 0.3], kneeL: [0.13, 0.46, 0.12], kneeR: [-0.13, 0.5, 0.52],
  footL: [0.13, 0.08, -0.12], footR: [-0.13, 0.04, 0.46], neck: [0, 1.4, 0.42], head: [0, 1.64, 0.48],
  shL: [0.2, 1.38, 0.42], shR: [-0.2, 1.38, 0.42], elL: [0.46, 1.24, 0.44], elR: [-0.46, 1.24, 0.44], handL: [0.68, 1.14, 0.5], handR: [-0.68, 1.14, 0.5],
};
const STAND: Pose = {
  hipL: [0.13, 0.95, 0.46], hipR: [-0.13, 0.95, 0.46], kneeL: [0.13, 0.49, 0.46], kneeR: [-0.13, 0.49, 0.46],
  footL: [0.13, 0.04, 0.46], footR: [-0.13, 0.04, 0.46], neck: [0, 1.5, 0.46], head: [0, 1.75, 0.46],
  shL: [0.2, 1.5, 0.46], shR: [-0.2, 1.5, 0.46], elL: [0.21, 1.2, 0.46], elR: [-0.21, 1.2, 0.46], handL: [0.2, 0.92, 0.48], handR: [-0.2, 0.92, 0.48],
};
/** Where the standing figure ends relative to the get-up origin (the planted right foot). */
export const STAND_FORWARD = 0.46;
export const FOURS_END = 0.3;
const KEYS: [number, Pose][] = [[FOURS_END, FOURS], [0.55, KNEEL], [0.82, PUSH], [1, STAND]];
const JOINTS = Object.keys(FOURS) as Joint[];

// Tangent (pose velocity) at each keyframe so the motion flows through the
// intermediate poses instead of easing to a stop at each one. Interior keys
// use the slope between their neighbors (Catmull-Rom style); the first and
// last keys ease from/to rest.
const TANGENTS: Pose[] = KEYS.map(([tk, pose], k) => {
  const out = {} as Pose;
  if (k === 0 || k === KEYS.length - 1) {
    for (const j of JOINTS) out[j] = [0, 0, 0];
    return out;
  }
  const [tPrev, prev] = KEYS[k - 1]!;
  const [tNext, next] = KEYS[k + 1]!;
  const scale = 1 / (tNext - tPrev);
  for (const j of JOINTS) {
    const p = prev[j]; const n = next[j];
    out[j] = [(n[0] - p[0]) * scale, (n[1] - p[1]) * scale, (n[2] - p[2]) * scale];
  }
  return out;
});

/** Pose for progress in [FOURS_END, 1]; earlier progress blends from the ragdoll toward all fours. */
export function getUpPose(progress: number): Pose {
  const t = Math.max(FOURS_END, Math.min(1, progress));
  for (let k = 1; k < KEYS.length; k++) {
    const [t1, b] = KEYS[k]!; const [t0, a] = KEYS[k - 1]!;
    if (t <= t1) {
      const dt = t1 - t0;
      const u = (t - t0) / dt;
      const u2 = u * u; const u3 = u2 * u;
      // Cubic Hermite: passes through both key poses with matching velocity,
      // so segments join into one continuous movement.
      const h00 = 2 * u3 - 3 * u2 + 1; const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2; const h11 = u3 - u2;
      const m0 = TANGENTS[k - 1]!; const m1 = TANGENTS[k]!;
      const out = {} as Pose;
      for (const j of JOINTS) {
        const pa = a[j]; const pb = b[j]; const ta = m0[j]; const tb = m1[j];
        out[j] = [
          h00 * pa[0] + h10 * ta[0] * dt + h01 * pb[0] + h11 * tb[0] * dt,
          h00 * pa[1] + h10 * ta[1] * dt + h01 * pb[1] + h11 * tb[1] * dt,
          h00 * pa[2] + h10 * ta[2] * dt + h01 * pb[2] + h11 * tb[2] * dt,
        ];
      }
      return out;
    }
  }
  return STAND;
}
export const FOURS_POSE = FOURS;
