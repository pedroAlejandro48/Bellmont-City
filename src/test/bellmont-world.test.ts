import { describe, expect, it } from "vitest";
import { BLOCK, DEFAULT_SAVE, HALF, N, PITCH, WORLD_HALF, generateCity, isWildernessRoad, rampTurn, resetProgress, wildernessCenter, PARK_TREES, PARK_BENCHES, PARK_CORNERS, PARK_RING_RADIUS, PARK_OBELISK_HEIGHT, GREEN_BLOCK_CHANCE, SIDEWALK_TREE_CENTER, TREE_BED_RADIUS, SIDEWALK_CANOPY_RADIUS, BUILDING_ENTRANCE, cityRoadDashes } from "@/game/config";
import { readSave } from "@/game/saves";
import { createState, toSave } from "@/game/state";

describe("Bellmont world rules", () => {
  it("bounds streaming road markings locally even at opposite city corners", () => {
    for (const [x, z] of [[0, 0], [900, -900], [-900, 900], [700, 100]]) {
      const dashes = cityRoadDashes(x ?? 0, z ?? 0);
      expect(dashes.length).toBeLessThan(1400);
      expect(dashes.every((d) => Math.abs(d.x - (x ?? 0)) <= 260 && Math.abs(d.z - (z ?? 0)) <= 260)).toBe(true);
    }
    expect(cityRoadDashes(900, -900)).toEqual(cityRoadDashes(900, -900));
  });
  it("keeps the park trees and furnishing fixed across different worlds", () => {
    for (const seed of [123, 999, 45678]) {
      const trees = generateCity(seed).trees.filter((t) => Math.abs(t.x) < 16 && Math.abs(t.z) < 16);
      expect(trees).toEqual(PARK_TREES);
      expect(generateCity(seed).trees.filter((t) => Math.abs(t.x) < 20 && Math.abs(t.z) < 20)).toEqual(generateCity(123).trees.filter((t) => Math.abs(t.x) < 20 && Math.abs(t.z) < 20));
    }
    expect(PARK_BENCHES).toHaveLength(4);
    expect(PARK_CORNERS).toEqual([[-17, -17], [17, -17], [17, 17], [-17, 17]]);
  });
  it("leaves a circular lawn with an obelisk five times the 1.8m character height", () => {
    expect(PARK_RING_RADIUS).toBe(6);
    expect(PARK_OBELISK_HEIGHT).toBe(1.8 * 5);
    expect(PARK_TREES.every((t) => Math.hypot(t.x, t.z) > PARK_RING_RADIUS)).toBe(true);
  });
  it("makes non-central green blocks occasional", () => {
    expect(GREEN_BLOCK_CHANCE).toBe(0.02);
    let green = 0;
    for (let seed = 1; seed <= 100; seed++) green += generateCity(seed).blocks.filter((b) => b.park && (b.x !== 0 || b.z !== 0)).length;
    expect(green / 4800).toBeLessThan(0.03);
  });
  it("keeps rock beds fully on sidewalks and foliage clear of buildings", () => {
    const city = generateCity(123);
    for (const t of city.trees.filter((t) => t.sidewalk)) {
      // Each bed sits the same distance in from its kerb as on a full block, and fully on the pavement.
      const block = city.blocks.find((b) => Math.abs(t.x - b.x) <= b.w / 2 && Math.abs(t.z - b.z) <= b.d / 2)!;
      const fromKerb = Math.min(block.w / 2 - Math.abs(t.x - block.x), block.d / 2 - Math.abs(t.z - block.z));
      expect(fromKerb).toBeCloseTo(BLOCK / 2 - SIDEWALK_TREE_CENTER);
      expect(fromKerb - TREE_BED_RADIUS * t.s).toBeGreaterThan(0);
      for (const b of city.buildings) {
        const clearance = Math.hypot(Math.max(0, Math.abs(t.x - b.x) - b.w / 2), Math.max(0, Math.abs(t.z - b.z) - b.d / 2));
        expect(clearance).toBeGreaterThan(SIDEWALK_CANOPY_RADIUS * t.s);
      }
    }
    expect(PARK_TREES.every((t) => !t.sidewalk)).toBe(true);
    expect(generateCity(123, WORLD_HALF + 300, 0).trees.filter((t) => Math.abs(t.x) > WORLD_HALF).every((t) => !t.sidewalk)).toBe(true);
  });
  it("keeps buildings on their blocks, clear of the wider main roads", () => {
    for (const focus of [[0, 0], [60, 60], [300, -200]] as const) {
      const city = generateCity(7, focus[0], focus[1]);
      for (const b of city.buildings) {
        const block = city.blocks.find((k) => Math.abs(b.x - k.x) <= k.w / 2 && Math.abs(b.z - k.z) <= k.d / 2)!;
        expect(block).toBeDefined();
        expect(block.w / 2 - (Math.abs(b.x - block.x) + b.w / 2)).toBeGreaterThan(4);
        expect(block.d / 2 - (Math.abs(b.z - block.z) + b.d / 2)).toBeGreaterThan(4);
      }
    }
  });
  it("keeps double-door entrances closed with glazing only on the ground floor", () => {
    expect(BUILDING_ENTRANCE).toEqual({ doors: 2, accessible: false, floorHeight: 3 });
  });
  it("bounds downtown twenty blocks outward in each direction", () => {
    expect(HALF).toBe(20); expect(N).toBe(41);
    expect(generateCity(123, WORLD_HALF + 400, 0).buildings).toHaveLength(0);
  });
  it("uses a full central park block and spawns at its entrance", () => {
    const city = generateCity(123);
    expect(city.blocks.find((b) => b.x === 0 && b.z === 0)?.park).toBe(true);
    expect(city.buildings.some((b) => Math.abs(b.x) < 20 && Math.abs(b.z) < 20)).toBe(false);
    expect(DEFAULT_SAVE.pos).toEqual([0, 0.15, 18]);
  });
  it("keeps the world seed and existing position across saves and updates", () => {
    const saved = readSave({ ...DEFAULT_SAVE, worldSeed: 8742, pos: [100, 0.15, 200] });
    expect(toSave(createState(saved))).toMatchObject({ worldSeed: 8742, pos: [100, 0.15, 200] });
    expect(generateCity(8742)).toEqual(generateCity(8742));
    expect(generateCity(8742).buildings).not.toEqual(generateCity(8743).buildings);
  });
  it("creates a different random world on death while resetting time and health", () => {
    const reset = resetProgress(1337);
    expect(reset.worldSeed).not.toBe(1337);
    expect(reset.elapsed).toBe(0); expect(reset.health).toBe(100);
  });
  it("continues all four cardinal roads arbitrarily far with forest clearance", () => {
    for (const t of [-1000000, 1000000]) for (const axis of ["x", "z"] as const) {
      const center = wildernessCenter(axis, t, 123);
      expect(isWildernessRoad(axis === "x" ? t : center, axis === "x" ? center : t, 123)).toBe(true);
      expect(Number.isFinite(center)).toBe(true);
    }
    const forest = generateCity(123, WORLD_HALF + 300, PITCH / 2);
    expect(forest.trees.length).toBeGreaterThan(100);
    expect(forest.trees.every((t) => t.s >= 0.98 && t.s <= 1.02)).toBe(true);
    expect(forest.trees.filter((t) => Math.abs(t.x) > WORLD_HALF + 9).every((t) => !isWildernessRoad(t.x, t.z, 123, 12))).toBe(true);
  });
  it("turns softly for taps, faster when held, and stops on release", () => {
    const tap = rampTurn(0, 1, 0.05);
    const held = rampTurn(tap, 1, 0.6);
    expect(tap).toBeCloseTo(0.17); expect(held).toBeGreaterThan(tap * 5);
    expect(rampTurn(held, 0, 0.05)).toBe(0);
    expect(rampTurn(held, -1, 0.05)).toBeCloseTo(-0.17);
  });
});