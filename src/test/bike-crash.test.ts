import { describe, expect, it } from "vitest";
import { BIKE_CRASH_SPEED, bikeImpactCrashes, bikeTouchesCircle, footprintBlocked, MPH_TO_MPS, scooterFootprint, vehicleFootprint } from "@/game/config";
import { createState, crashBike } from "@/game/state";
import { DEFAULT_SAVE } from "@/game/config";
import { readHit } from "@/multiplayer/RoomScene";

describe("bike crashes", () => {
  it("happen only above 20 mph", () => {
    expect(BIKE_CRASH_SPEED).toBeCloseTo(20 * MPH_TO_MPS);
    expect(bikeImpactCrashes(19.9 * MPH_TO_MPS)).toBe(false);
    expect(bikeImpactCrashes(20 * MPH_TO_MPS)).toBe(false);
    expect(bikeImpactCrashes(20.5 * MPH_TO_MPS)).toBe(true);
    expect(bikeImpactCrashes(-25 * MPH_TO_MPS)).toBe(true);
  });

  it("throw the rider, cost health, and drop the bike", () => {
    const state = createState({ ...DEFAULT_SAVE });
    state.scooter.riding = true;
    expect(crashBike(state, [0, 1], 15, 1)).toBe(true);
    expect(state.accident).toMatchObject({ phase: "down", vehicleId: null, direction: [0, 1] });
    expect(state.accident!.launchSpeed).toBeGreaterThan(0);
    expect(state.health).toBeLessThan(100);
    expect(state.scooter).toMatchObject({ riding: false, fallen: true, speed: 0 });
    // A second impact during the same accident does nothing.
    expect(crashBike(state, [1, 0], 15, 2)).toBe(false);
  });

  it("detect a bike touching a person", () => {
    // A bike at the origin heading +z (yaw 0) is 1.2 m long.
    expect(bikeTouchesCircle(0, 0, 0, { x: 0, z: 1.1, r: 0.35 })).toBe(true);
    expect(bikeTouchesCircle(0, 0, 0, { x: 0.8, z: 0, r: 0.35 })).toBe(false);
  });

  it("stop a pushed bike against people, vehicles and other bikes", () => {
    const lying = scooterFootprint(0, 0, 0, true, 1);
    expect(footprintBlocked(lying, [{ x: 1.4, z: 0, r: 0.35 }], [])).toBe(true);
    expect(footprintBlocked(lying, [{ x: 3, z: 0, r: 0.35 }], [])).toBe(false);
    expect(footprintBlocked(lying, [], [vehicleFootprint(0, 1.8, 0, "car")])).toBe(true);
    expect(footprintBlocked(lying, [], [vehicleFootprint(0, 3, 0, "car")])).toBe(false);
    expect(footprintBlocked(lying, [], [scooterFootprint(0, 2.5, 0, false)])).toBe(false);
    expect(footprintBlocked(lying, [], [scooterFootprint(0, 1.5, 0, false)])).toBe(true);
  });

  it("read crash messages from other players defensively", () => {
    expect(readHit({ peer: "p1", at: 5, direction: [1, 0], speed: 12 })).toEqual({ peer: "p1", at: 5, direction: [1, 0], speed: 12 });
    expect(readHit({ peer: "p1", at: 5, direction: [1], speed: 12 })).toBeNull();
    expect(readHit("nope")).toBeNull();
  });
});
