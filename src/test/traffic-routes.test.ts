import { describe, expect, it } from "vitest";
import { PITCH, WORLD_HALF, TRAFFIC_CORNER_SPEED, VEHICLE_SIZE, TRAFFIC_SPAWN_GAP, isTrafficRoad, roadLaneOffsets, roadLane, trafficSpawnClear, wildernessCenter, cityRoadDashes, MAIN_ROAD_CENTER, MAIN_ROAD_WIDTH, blockSpan, nextStreet } from "@/game/config";
import { makeTrafficTurn, turnSample, mayTurnAt, allowedTurns, turnDir, intersectionAhead, pointAlongTurn, progressOnTurn, turnLeavesCity } from "@/game/trafficRoutes";

describe("road traffic routes", () => {
  it("has two lanes each direction on main roads and one on side streets", () => {
    // Every lane is 6 m wide: one each way on streets, two each way on the 24 m main roads.
    expect(roadLaneOffsets(true)).toEqual([3, 9]); expect(roadLaneOffsets(false)).toEqual([3]);
    expect(MAIN_ROAD_CENTER).toBe(32); expect(MAIN_ROAD_WIDTH).toBe(24);
    expect([roadLane("x", -1, 32, 1), roadLane("x", -1, 32), roadLane("x", 1, 32), roadLane("x", 1, 32, 1)]).toEqual([23, 29, 35, 41]);
    expect([roadLane("x", -1, 90), roadLane("x", 1, 90)]).toEqual([87, 93]);
    // Avenues ring the park (z = ±20 kerbs) and every block past them is a full 40 m.
    expect(blockSpan(0)).toEqual([-20, 20]); expect(blockSpan(1)).toEqual([44, 84]); expect(blockSpan(2)).toEqual([96, 136]); expect(blockSpan(-1)).toEqual([-84, -44]);
    expect([nextStreet(10, 1), nextStreet(32, 1), nextStreet(40, -1), nextStreet(90, -1), nextStreet(0, -1), nextStreet(-32, -1)]).toEqual([32, 90, 32, 32, -32, -90]);
    expect(cityRoadDashes(0, 0).filter((d) => d.divider).length).toBeGreaterThan(0);
  });
  it("allows only road spawns including all four forest exits", () => {
    expect(isTrafficRoad(0, 0, 123)).toBe(false); expect(isTrafficRoad(0, 29, 123)).toBe(true);
    expect(isTrafficRoad(0, 43, 123)).toBe(true); expect(isTrafficRoad(0, 45, 123)).toBe(false);
    expect(isTrafficRoad(WORLD_HALF + 100, 400, 123)).toBe(false);
    for (const t of [-WORLD_HALF - 200, WORLD_HALF + 200]) for (const axis of ["x", "z"] as const) for (const offset of [-11, -9, -3, 3, 9, 11]) {
      const center = wildernessCenter(axis, t, 123) + offset;
      expect(isTrafficRoad(axis === "x" ? t : center, axis === "z" ? t : center, 123)).toBe(true);
    }
  });
  it("keeps over two bus lengths between bumpers and staggers adjacent lanes", () => {
    expect(TRAFFIC_SPAWN_GAP).toBeGreaterThan(2 * VEHICLE_SIZE.bus[0]);
    const existing = [{ x: 0, z: 35, kind: "car" as const }];
    expect(trafficSpawnClear(0, 41, 4.4, existing)).toBe(false);
    expect(trafficSpawnClear(4.4 + TRAFFIC_SPAWN_GAP - 0.001, 35, 4.4, existing)).toBe(false);
    expect(trafficSpawnClear(4.4 + TRAFFIC_SPAWN_GAP, 35, 4.4, existing)).toBe(true);
  });
  it("turns through a moving curve tangent to incoming and outgoing roads", () => {
    const turn = makeTrafficTurn({ axis: "x", dir: 1, lane: 93 }, 90, "right");
    const start = turnSample(turn, 0), mid = turnSample(turn, 0.5), end = turnSample(turn, 1);
    expect(start.yaw).toBeCloseTo(0); expect(end.yaw).toBeCloseTo(-Math.PI / 2);
    expect(mid.x).toBeGreaterThan(start.x); expect(mid.z).toBeGreaterThan(start.z);
    expect(mid.derivative).toBeGreaterThan(0); expect(end.z).toBeGreaterThan(mid.z);
  });
});
describe("keeping right through turns", () => {
  const main = MAIN_ROAD_CENTER;
  // The right-hand lanes of a road: heading +x they sit at +z of its centre, heading +z at -x.
  const onRightHalf = (next: { axis: "x" | "z"; dir: 1 | -1; lane: number }, center: number) =>
    (next.axis === "x" ? next.dir : -next.dir) * (next.lane - center) > 0;

  it("turns right toward the right-hand side and left toward the left", () => {
    expect(turnDir({ axis: "x", dir: 1 }, "right")).toBe(1);
    expect(turnDir({ axis: "x", dir: 1 }, "left")).toBe(-1);
    expect(turnDir({ axis: "z", dir: 1 }, "right")).toBe(-1);
    expect(turnDir({ axis: "z", dir: -1 }, "right")).toBe(1);
  });

  it("lets only the right lane turn right and only the left lane turn left on main roads", () => {
    expect(allowedTurns(true, 1)).toEqual(["right"]);
    expect(allowedTurns(true, 0)).toEqual(["left"]);
    expect(allowedTurns(false, 0)).toEqual(["left", "right"]);
  });

  it("always ends a turn on the right-hand half of the new road, in the matching lane", () => {
    for (const axis of ["x", "z"] as const) for (const dir of [1, -1] as const) for (const side of ["left", "right"] as const) {
      for (const kind of ["car", "bus"] as const) {
        for (const crossing of [main, 90, -90, WORLD_HALF, -WORLD_HALF]) {
          const turn = makeTrafficTurn({ axis, dir, lane: roadLane(axis, dir, 130) }, crossing, side, kind);
          expect(onRightHalf(turn.next, crossing)).toBe(true);
          const onMain = crossing === main;
          expect(turn.next.slot).toBe(onMain && side === "right" && kind !== "bus" ? 1 : 0);
          expect(Math.abs(turn.next.lane - crossing)).toBe(onMain && turn.next.slot === 1 ? 9 : 3);
        }
      }
    }
  });

  it("finds the main road as the next intersection, not a grid street that isn't there", () => {
    // Heading +x past the avenue at -32, the next crossing is the main road at 32 (never a street inside the park).
    expect(intersectionAhead({ axis: "x", dir: 1, lane: 93 }, -20)).toBe(main);
    expect(nextStreet(-32, 1)).toBe(main);
    expect(nextStreet(main, 1)).toBe(90);
    expect(nextStreet(90, -1)).toBe(main);
  });
});

it("rolls through corners a little faster than the former 4.5 m/s cap", () => { expect(TRAFFIC_CORNER_SPEED).toBeGreaterThan(4.5); expect(TRAFFIC_CORNER_SPEED).toBeLessThan(7); });

it("lets both perimeter lanes turn at ring corners", () => { expect(mayTurnAt(WORLD_HALF, WORLD_HALF + 3)).toBe(true); expect(mayTurnAt(WORLD_HALF, -WORLD_HALF - 3)).toBe(true); expect(mayTurnAt(WORLD_HALF + 52, 29)).toBe(false); });

describe("following a turn", () => {
  const turn = makeTrafficTurn({ axis: "x", dir: 1, lane: 93 }, 90, "right");
  it("aims a set distance along the curve, then straight down the new lane", () => {
    const a = pointAlongTurn(turn, 0, 3);
    expect(Math.hypot(a.x - turn.start[0], a.z - turn.start[1])).toBeCloseTo(3, 0);
    const beyond = pointAlongTurn(turn, 1, 5);
    expect(beyond.x).toBeCloseTo(turn.end[0]); expect(beyond.z).toBeCloseTo(turn.end[1] + 5 * turn.next.dir);
  });
  it("measures progress from where the vehicle really is, never backwards", () => {
    const mid = turnSample(turn, 0.5);
    expect(progressOnTurn(turn, mid.x, mid.z, 0.3)).toBeCloseTo(0.5, 1);
    expect(progressOnTurn(turn, turn.start[0], turn.start[1], 0.4)).toBe(0.4);
  });
});

describe("the ring road", () => {
  it("only turns inward, except onto a main road heading into the countryside", () => {
    // Heading -z along the east edge (x ≈ WORLD_HALF): a right turn heads +x, out of the city.
    const east = { axis: "z" as const, dir: -1 as const, lane: WORLD_HALF + 3 };
    expect(turnDir(east, "right")).toBe(1);
    expect(turnLeavesCity(east, WORLD_HALF, 506, "right")).toBe(true);
    expect(turnLeavesCity(east, WORLD_HALF, 506, "left")).toBe(false);
    expect(turnLeavesCity(east, WORLD_HALF, MAIN_ROAD_CENTER, "right")).toBe(false);
    // Streets inside the city may turn either way.
    expect(turnLeavesCity({ axis: "z", dir: -1, lane: 93 }, 90, 506, "left")).toBe(false);
  });
});

describe("points along a turn, walked once", () => {
  it("gives exactly the points the one-at-a-time version does", async () => {
    const { makeTrafficTurn, pointAlongTurn, pointsAlongTurn } = await import("@/game/trafficRoutes");
    for (const side of ["left", "right"] as const) for (const dir of [1, -1] as const) {
      const turn = makeTrafficTurn({ axis: "x", dir, lane: 93 * dir }, 90, side);
      for (const from of [0, 0.1, 0.5, 0.95]) {
        const ds = Array.from({ length: 18 }, (_, k) => 2.2 + k * 1.2);
        const once = pointsAlongTurn(turn, from, ds);
        expect(once.every((q) => Number.isFinite(q.x) && Number.isFinite(q.z))).toBe(true);
        ds.forEach((d, k) => { const one = pointAlongTurn(turn, from, d); expect(once[k]!.x).toBeCloseTo(one.x, 9); expect(once[k]!.z).toBeCloseTo(one.z, 9); });
      }
    }
  });
});
