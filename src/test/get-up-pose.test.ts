import { describe, expect, it } from "vitest";
import { FOURS_END, FOURS_POSE, getUpPose, type Joint, type Pose } from "@/game/getUpPose";

const JOINTS = Object.keys(FOURS_POSE) as Joint[];
const dist = (a: Pose, b: Pose) => Math.max(...JOINTS.map((j) => Math.hypot(a[j][0] - b[j][0], a[j][1] - b[j][1], a[j][2] - b[j][2])));

describe("stand-up animation", () => {
  it("starts at all fours and ends standing", () => {
    expect(dist(getUpPose(FOURS_END), FOURS_POSE)).toBeLessThan(1e-9);
    const stand = getUpPose(1);
    expect(stand.head[1]).toBeCloseTo(1.75, 5);
    expect(stand.footL[1]).toBeCloseTo(0.04, 5);
  });
  it("clamps progress before all fours and after standing", () => {
    expect(dist(getUpPose(0), FOURS_POSE)).toBeLessThan(1e-9);
    expect(dist(getUpPose(2), getUpPose(1))).toBeLessThan(1e-9);
  });
  it("keeps moving through the intermediate poses instead of stopping at them", () => {
    // Velocity (pose change per step) must not drop to zero at the kneel/push keyframes.
    const e = 0.004;
    for (const key of [0.55, 0.82]) {
      const before = dist(getUpPose(key), getUpPose(key - e));
      const after = dist(getUpPose(key + e), getUpPose(key));
      expect(after).toBeGreaterThan(before * 0.25);
    }
  });
  it("moves continuously with no jumps between frames", () => {
    let prev = getUpPose(FOURS_END);
    for (let t = FOURS_END + 0.02; t <= 1.001; t += 0.02) {
      const pose = getUpPose(t);
      expect(dist(pose, prev)).toBeLessThan(0.12);
      prev = pose;
    }
  });
});
