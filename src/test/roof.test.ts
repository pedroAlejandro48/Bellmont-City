import { describe, expect, it } from "vitest";
import { CLIMB, climbPose, ROOF_UP, RUNG, rungY } from "../game/roof";

describe("roof ladder climb", () => {
  it("starts on the floor and ends standing on the roof (and back)", () => {
    const a = climbPose("up", 0), b = climbPose("up", CLIMB.up);
    expect(a.y).toBe(0); expect(a.hands.left?.blend ?? 0).toBe(0);
    expect(b.y).toBeCloseTo(ROOF_UP); expect(b.z).toBeLessThan(0); expect(b.hands.right).toBeNull();
    const c = climbPose("down", 0), d = climbPose("down", CLIMB.down);
    expect(c.y).toBeCloseTo(ROOF_UP); expect(d.y).toBe(0);
    expect(CLIMB.up).toBeGreaterThan(6); expect(CLIMB.up).toBeLessThan(20);
  });
  it("holds are on rungs or the roof, and within reach of the body", () => {
    for (const dir of ["up", "down"] as const) {
      for (let t = 0; t <= CLIMB[dir]; t += 0.05) {
        const p = climbPose(dir, t);
        for (const h of [p.hands.left, p.hands.right]) {
          if (!h || h.blend < 1) continue;
          // shoulder ~ hips + 0.55 along the lean
          const hipY = p.y + 0.95 - p.legs.drop, sy = hipY + 0.55 * Math.cos(p.lean), sz = p.z - 0.55 * Math.sin(p.lean);
          const d = Math.hypot(h.at[1] - sy, h.at[2] - sz);
          expect(d, `${dir} t=${t.toFixed(2)} hand`).toBeLessThan(0.9);
        }
        for (const k of [p.legs.kneeL, p.legs.kneeR]) expect(Number.isFinite(k)).toBe(true);
      }
    }
  });
  it("the rungs reach just under the roof", () => { expect(rungY(RUNG.n - 1)).toBeLessThan(ROOF_UP); expect(rungY(RUNG.n - 1)).toBeGreaterThan(3); });
});
