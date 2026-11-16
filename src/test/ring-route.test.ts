import { describe, expect, it } from "vitest";
import { cornerPoint, ringPoint, ringRoute, WALK_RING } from "../game/pedestrians";
import { blockCenter } from "../game/config";

describe("sidewalk loop routes", () => {
  it("goes round the corners the short way to a point on another side", () => {
    const c = blockCenter(2), R = WALK_RING;
    const from: [number, number] = [c + R, blockCenter(1) + 3], to = ringPoint(2, 1, [c - 2, blockCenter(1) + R + 4]);
    const route = ringRoute(2, 1, from, to);
    expect(route[route.length - 1]).toEqual(to);
    expect(route[0]).toEqual(cornerPoint(2, 1, 0));
    expect(route.length).toBe(2);
  });
  it("no corners on the same side", () => {
    const c = blockCenter(0), R = WALK_RING;
    expect(ringRoute(0, 0, [c + R, 2], [c + R, -5]).length).toBe(1);
  });
});
