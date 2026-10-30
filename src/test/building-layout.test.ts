import { describe, expect, it } from "vitest";
import { blockCenter, buildingLayout, PITCH } from "@/game/config";

describe("building layout", () => {
  it("street sides point away from the block centre", () => {
    const L = buildingLayout({ x: blockCenter(2) - 8, z: blockCenter(1) + 8 });
    expect([L.sx, L.sz]).toEqual([-1, 1]);
  });
  it("has exactly one main door, on a street side", () => {
    const L = buildingLayout({ x: 8, z: 8 });
    expect(["x", "z"]).toContain(L.door);
  });
  it("back doors are occasional, at most one per building", () => {
    let count = 0;
    for (let i = -20; i < 20; i++) for (let j = -20; j < 20; j++) if (buildingLayout({ x: i * PITCH + 8.3, z: j * PITCH - 7.9 }).backDoor) count++;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(1600 * 0.5);
  });
});

describe("door side randomness", () => {
  it("uses both street sides for main doors across the city", () => {
    const sides = new Set<string>();
    for (let i = -5; i < 5; i++) for (const sx of [-8, 8]) for (const sz of [-8, 8]) sides.add(buildingLayout({ x: i * PITCH + sx, z: sz }).door);
    expect(sides).toEqual(new Set(["x", "z"]));
  });
});
