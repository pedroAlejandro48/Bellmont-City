import { describe, expect, it } from "vitest";
import { BENCH_SEATS, BENCH_SIT_SECONDS, BENCH_STAND_SECONDS, DEFAULT_SAVE, PARK_ARCH, PARK_SOLIDS, PERSON_MASS, SCOOTER_MASS, bikePushShare, circleBoxPush, nearestBenchSeat, PARK_BENCHES, benchStandHeight, BENCH_SEAT_TOP, BENCH_BACK_TOP } from "@/game/config";
import { createState, toSave } from "@/game/state";
import { readSave } from "@/game/saves";

describe("park interaction rules", () => {
  it("provides exactly left and right seats for every bench", () => {
    expect(BENCH_SEATS).toHaveLength(8);
    for (let bench = 0; bench < 4; bench++) expect(BENCH_SEATS.filter((s) => s.bench === bench).map((s) => s.slot)).toEqual([0, 1]);
  });
  it("offers the closest reachable free seat and refuses an occupied seat", () => {
    const seat = BENCH_SEATS[0]; if (!seat) throw new Error("Missing seat");
    const x = seat.x + Math.sin(seat.yaw) * 0.45, z = seat.z + Math.cos(seat.yaw) * 0.45;
    expect(nearestBenchSeat(x, z, new Map())?.id).toBe(0);
    expect(nearestBenchSeat(x, z, new Map([[0, "another-player"]]))).toBeNull();
    expect(nearestBenchSeat(x + 20, z, new Map())).toBeNull();
  });
  it("persists sitting without resetting an old account save", () => {
    const state = createState(readSave({ ...DEFAULT_SAVE, benchSeat: 1 }));
    expect(state.bench?.seat).toBe(1); expect(state.seatOccupants.get(1)).toBe("player");
    expect(toSave(state).benchSeat).toBe(1);
    expect(createState(readSave({ ...DEFAULT_SAVE, benchSeat: 999 })).bench).toBeNull();
    expect(createState(readSave({ pos: [40, 0, 29] })).pos.toArray()).toEqual([40, 0, 29]);
  });
  it("uses staged two-second sit and a smooth stand action", () => {
    expect(BENCH_SIT_SECONDS).toBeLessThanOrEqual(0.5); expect(BENCH_STAND_SECONDS).toBeLessThanOrEqual(0.5);
  });
  it("lets the player stand on the seat, then the narrow backrest, only from above", () => {
    const b = PARK_BENCHES[0]!;
    expect(benchStandHeight(b.x, b.z, 0)).toBe(0);
    expect(benchStandHeight(b.x, b.z, 0.8)).toBe(BENCH_SEAT_TOP);
    const bx = b.x - Math.sin(b.rot) * 0.32, bz = b.z - Math.cos(b.rot) * 0.32;
    expect(benchStandHeight(bx, bz, 1.5)).toBe(BENCH_BACK_TOP);
    expect(benchStandHeight(b.x + Math.sin(b.rot) * 0.6, b.z + Math.cos(b.rot) * 0.6, 1.5)).toBe(0);
    expect(7.2 ** 2 / 44).toBeGreaterThan(BENCH_SEAT_TOP); expect(7.2 ** 2 / 44).toBeLessThan(BENCH_BACK_TOP);
  });
  it("keeps the 3.6m rock gate opening clear with solid pillars", () => {
    expect(PARK_ARCH.height).toBe(1.8 * 2);
    expect(PARK_ARCH.spring + PARK_ARCH.outer).toBeCloseTo(3.6);
    expect(PARK_SOLIDS.filter((s) => s.z === PARK_ARCH.z)).toHaveLength(2);
    for (const box of PARK_SOLIDS.filter((s) => s.z === PARK_ARCH.z)) expect(circleBoxPush(0, PARK_ARCH.z, 0.35, box)).toEqual([0, 0]);
    const pillar = PARK_SOLIDS.find((s) => s.z === PARK_ARCH.z); if (!pillar) throw new Error("Missing pillar");
    expect(Math.hypot(...circleBoxPush(pillar.x, pillar.z, 0.35, pillar))).toBeGreaterThan(0.35);
  });
  it("blocks walking through rotated benches and a heavier scooter", () => {
    const box = PARK_SOLIDS[0]; if (!box) throw new Error("Missing bench collider");
    expect(Math.hypot(...circleBoxPush(box.x, box.z, 0.35, box))).toBeGreaterThan(0);
    expect(SCOOTER_MASS).toBe(110); expect(PERSON_MASS).toBe(81);
    expect(bikePushShare()).toBeCloseTo(81 / 191); expect(bikePushShare()).toBeLessThan(0.5);
  });
  it("spawns facing the camera, with the gate behind, without changing saved headings", () => {
    expect(DEFAULT_SAVE.rotY).toBe(DEFAULT_SAVE.camYaw); expect(DEFAULT_SAVE.pos[2]).toBeGreaterThan(PARK_ARCH.z);
    expect(readSave({ ...DEFAULT_SAVE, rotY: 2.1 }).rotY).toBe(2.1);
  });
});
describe("bench backrest", () => {
  it("is a thin wall too high to jump onto from behind", async () => {
    const { BENCH_BACKRESTS, BENCH_BACK_TOP } = await import("@/game/config");
    expect(BENCH_BACKRESTS).toHaveLength(4); expect(BENCH_BACKRESTS[0]!.hz * 2).toBeCloseTo(0.085);
    expect(7.2 ** 2 / 44).toBeLessThan(BENCH_BACK_TOP);
  });
});
