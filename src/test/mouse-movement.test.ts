import { describe, expect, it } from "vitest";
import { cameraRelativeVelocity, cameraRecenterReady } from "@/game/config";

describe("restored mouse-directed walking", () => {
  it("forward follows the mouse view rather than the old character heading", () => {
    const [x, z] = cameraRelativeVelocity(-Math.PI / 2, 1, 0, 2.2);
    expect(x).toBeCloseTo(2.2);
    expect(z).toBeCloseTo(0);
  });
  it("left and right move to the corresponding screen side", () => {
    expect(cameraRelativeVelocity(0, 0, -1, 2.2)[0]).toBeCloseTo(-2.2);
    expect(cameraRelativeVelocity(0, 0, 1, 2.2)[0]).toBeCloseTo(2.2);
    expect(cameraRelativeVelocity(-Math.PI / 2, 0, 1, 2.2)[1]).toBeCloseTo(2.2);
  });
  it("keeps running speed consistent when moving diagonally", () => {
    const velocity = cameraRelativeVelocity(0, 1, 1, 6.2);
    expect(Math.hypot(...velocity)).toBeCloseTo(6.2);
  });
  it("waits more than one second of continuous forward walking", () => {
    expect(cameraRecenterReady(2000, 0, 2999)).toBe(false);
    expect(cameraRecenterReady(2000, 0, 3000)).toBe(false);
    expect(cameraRecenterReady(2000, 0, 3001)).toBe(true);
    expect(cameraRecenterReady(null, 0, 9000)).toBe(false);
  });
  it("mouse view changes interrupt recentering for another full second", () => {
    expect(cameraRecenterReady(0, 2400, 3000)).toBe(false);
    expect(cameraRecenterReady(0, 2400, 3400)).toBe(false);
    expect(cameraRecenterReady(0, 2400, 3401)).toBe(true);
  });
});