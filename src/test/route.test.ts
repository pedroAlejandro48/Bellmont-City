import { describe, expect, it } from "vitest";
import { BLOCK, blockCenter, streetCenter, streetHalfWidth } from "@/game/config";
import { STREETS, curbPoint, routeLength, routeTo, sidewalkPoint } from "@/game/route";

describe("GPS routes", () => {
  it("on foot: the target goes to the nearest sidewalk, and the route is straight", () => {
    const c = blockCenter(3);
    const [x, z] = sidewalkPoint(c + 2, blockCenter(-2) + 1);
    const lx = Math.abs(x - c), lz = Math.abs(z - blockCenter(-2));
    expect(Math.max(lx, lz)).toBeGreaterThan(BLOCK / 2 - 4.5);
    expect(Math.max(lx, lz)).toBeLessThanOrEqual(BLOCK / 2);
    // Already on a sidewalk: unchanged.
    expect(sidewalkPoint(c + 18.5, blockCenter(1))).toEqual([c + 18.5, blockCenter(1)]);
    expect(routeTo([0, 0], [c + 18.5, blockCenter(1)], false)).toHaveLength(2);
  });
  it("on a vehicle: the target is at the kerb of the nearest street, the route along the streets", () => {
    const s = streetCenter(2), [x] = curbPoint(s + 3, blockCenter(4));
    expect(Math.abs(x - s)).toBeCloseTo(streetHalfWidth(s) - 1.6, 5);
    const from: [number, number] = [streetCenter(-3), blockCenter(-3)], to: [number, number] = [blockCenter(3), streetCenter(4)];
    const pts = routeTo(from, to, true);
    // Every leg runs along a street (one coordinate is a street centre) between the ends.
    for (let i = 2; i < pts.length - 2; i++) {
      const [a, b] = [pts[i - 1]!, pts[i]!];
      expect(a[0] === b[0] && STREETS.includes(a[0]) || a[1] === b[1] && STREETS.includes(a[1])).toBe(true);
    }
    const manhattan = Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]);
    expect(routeLength(pts)).toBeLessThan(manhattan + 60);
  });
});

import { nextTurn } from "@/game/route";
describe("the next move", () => {
  const S = (k: number) => streetCenter(k);
  it("on the bike: straight on, right, left or a U-turn at the next corner", () => {
    // Heading +z along the street x = S(2), next corner at z = S(3), then turning toward -x (right, facing +z).
    const pts: [number, number][] = [[S(2), S(1) + 5], [S(2), S(1) + 5], [S(2), S(3)], [S(1), S(3)], [S(1), S(3) + 20], [S(1) + 3, S(3) + 20]];
    expect(nextTurn(pts, 0, true, [blockCenter(1), blockCenter(4)])).toBe("right");
    const leftPts: [number, number][] = pts.map(([x, z]) => [2 * S(2) - x, z]);
    expect(nextTurn(leftPts, 0, true, [blockCenter(4), blockCenter(4)])).toBe("left");
    // The route runs back the way you're heading: turn round.
    expect(nextTurn(pts, Math.PI, true, [blockCenter(1), blockCenter(4)])).toBe("uturn");
    const ahead: [number, number][] = [[S(2), S(1) + 5], [S(2), S(1) + 5], [S(2), S(3)], [S(2), S(4)], [S(2), S(4) + 10], [S(2) + 3, S(4) + 10]];
    expect(nextTurn(ahead, 0, true, [blockCenter(3), blockCenter(5)])).toBe("straight");
  });
  it("in the destination's block: arrived (✓); on foot: which way it lies", () => {
    const t: [number, number] = [blockCenter(2) + 18, blockCenter(2)];
    expect(nextTurn([[blockCenter(2) - 10, blockCenter(2)], t], 0, false, t)).toBe("arrive");
    const far: [number, number] = [blockCenter(0), blockCenter(5)];
    expect(nextTurn([[blockCenter(0), blockCenter(1)], far], 0, false, far)).toBe("straight");
    expect(nextTurn([[blockCenter(0), blockCenter(1)], far], Math.PI, false, far)).toBe("uturn");
    // Facing +x, a place toward +z is on your right.
    expect(nextTurn([[blockCenter(0), blockCenter(1)], far], Math.PI / 2, false, far)).toBe("right");
  });
});
