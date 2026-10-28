import { describe, expect, it } from "vitest";
import { PITCH, WORLD_HALF, TRAFFIC_CORNER_SPEED, VEHICLE_SIZE, TRAFFIC_SPAWN_GAP, isTrafficRoad, roadLaneOffsets, roadLane, trafficSpawnClear, wildernessCenter, cityRoadDashes } from "@/game/config";
import { makeTrafficTurn, turnSample, mayTurnAt } from "@/game/trafficRoutes";

describe("road traffic routes", () => {
  it("has two lanes each direction on main roads and one on side streets", () => {
    expect(roadLaneOffsets(true)).toEqual([1.5, 4.5]); expect(roadLaneOffsets(false)).toEqual([3]);
    expect([roadLane("x", -1, 26, 1), roadLane("x", -1, 26), roadLane("x", 1, 26), roadLane("x", 1, 26, 1)]).toEqual([21.5, 24.5, 27.5, 30.5]);
    expect(cityRoadDashes(0, 0).filter((d) => d.divider).length).toBeGreaterThan(0);
  });
  it("allows only road spawns including all four forest exits", () => {
    expect(isTrafficRoad(0, 0, 123)).toBe(false); expect(isTrafficRoad(0, 29, 123)).toBe(true);
    expect(isTrafficRoad(WORLD_HALF + 100, 400, 123)).toBe(false);
    for (const t of [-WORLD_HALF - 200, WORLD_HALF + 200]) for (const axis of ["x", "z"] as const) for (const offset of [-4.5, -1.5, 1.5, 4.5]) {
      const center = wildernessCenter(axis, t, 123) + offset;
      expect(isTrafficRoad(axis === "x" ? t : center, axis === "z" ? t : center, 123)).toBe(true);
    }
  });
  it("reserves a bus length between bumpers and staggers adjacent lanes", () => {
    expect(TRAFFIC_SPAWN_GAP).toBe(VEHICLE_SIZE.bus[0]);
    const existing = [{ x: 0, z: 27.5, kind: "car" as const }];
    expect(trafficSpawnClear(0, 30.5, 4.4, existing)).toBe(false);
    expect(trafficSpawnClear(15.499, 27.5, 4.4, existing)).toBe(false);
    expect(trafficSpawnClear(15.5, 27.5, 4.4, existing)).toBe(true);
  });
  it("turns through a moving curve tangent to incoming and outgoing roads", () => {
    const turn = makeTrafficTurn({ axis: "x", dir: 1, lane: 29 }, PITCH + 26, 1);
    const start = turnSample(turn, 0), mid = turnSample(turn, 0.5), end = turnSample(turn, 1);
    expect(start.yaw).toBeCloseTo(0); expect(end.yaw).toBeCloseTo(-Math.PI / 2);
    expect(mid.x).toBeGreaterThan(start.x); expect(mid.z).toBeGreaterThan(start.z);
    expect(mid.derivative).toBeGreaterThan(0); expect(end.z).toBeGreaterThan(mid.z);
  });
});
it("rolls through corners a little faster than the former 4.5 m/s cap", () => { expect(TRAFFIC_CORNER_SPEED).toBeGreaterThan(4.5); expect(TRAFFIC_CORNER_SPEED).toBeLessThan(7); });

it("lets both perimeter lanes turn at ring corners", () => { expect(mayTurnAt(WORLD_HALF, WORLD_HALF + 3)).toBe(true); expect(mayTurnAt(WORLD_HALF, -WORLD_HALF - 3)).toBe(true); expect(mayTurnAt(WORLD_HALF + 52, 29)).toBe(false); });
