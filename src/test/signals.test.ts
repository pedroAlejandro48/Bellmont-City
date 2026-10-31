import { describe, expect, it } from "vitest";
import { GAME_MINUTE, SIGNALLED, SIGNAL_POLES, crosswalks, isSignalled, onCrosswalk, signalState, stopLineFrom, streetCenter, MAIN_ROAD_CENTER } from "@/game/config";
import { signalStopDistance } from "@/game/trafficLogic";
import { allowedTurns } from "@/game/trafficRoutes";
import { mayCross, nextLeg, cornerPoint, redRemaining, steer, npcGender } from "@/game/pedestrians";

describe("traffic lights", () => {
  it("runs green 7, yellow 3, red 10 in-game minutes, the two roads opposite", () => {
    const at = (min: number) => min * GAME_MINUTE + 0.01;
    expect([signalState("x", at(0)), signalState("x", at(6.9)), signalState("x", at(7.1)), signalState("x", at(9.9)), signalState("x", at(10.1)), signalState("x", at(19.9))]).toEqual(["green", "green", "yellow", "yellow", "red", "red"]);
    // Whenever one road is green or yellow, the other is red; and the reverse.
    for (let m = 0; m < 40; m += 0.25) {
      const x = signalState("x", at(m)), z = signalState("z", at(m));
      expect(x === "red" || z === "red").toBe(true);
      expect(x === "red" && z === "red").toBe(false);
    }
  });
  it("sits only where an avenue meets every third street, with a pole for each approach", () => {
    expect(SIGNALLED).toHaveLength(28);
    expect(isSignalled(MAIN_ROAD_CENTER, streetCenter(3))).toBe(true);
    expect(isSignalled(MAIN_ROAD_CENTER, streetCenter(2))).toBe(false);
    expect(isSignalled(streetCenter(3), streetCenter(6))).toBe(false);
    expect(SIGNAL_POLES).toHaveLength(28 * 4);
  });
  it("has four zebra crossings squaring off each signalled intersection", () => {
    const [x, z] = SIGNALLED[0]!;
    const c = crosswalks(x, z);
    expect(c).toHaveLength(4);
    for (const w of c) expect(onCrosswalk(w.x, w.z)).toBe(true);
    expect(onCrosswalk(x, z)).toBe(false);
  });
  it("stops at the line on yellow and red, but carries on once the front is on the crossing", () => {
    const road = MAIN_ROAD_CENTER, cross = streetCenter(3), line = cross - stopLineFrom(cross);
    const yellow = 8 * GAME_MINUTE, green = 1, length = 4.4;
    expect(signalStopDistance("x", 1, line - 20 - length / 2, road, length, green)).toBeNull();
    expect(signalStopDistance("x", 1, line - 20 - length / 2, road, length, yellow)).toBeCloseTo(20);
    expect(signalStopDistance("x", 1, line + 1 - length / 2, road, length, yellow)).toBeNull();
    // A street that only crosses small streets has no lights at all.
    expect(signalStopDistance("x", 1, 100, streetCenter(4), length, yellow)).toBeNull();
  });
  it("only turns right (or goes straight) from either lane at lights", () => {
    expect(allowedTurns(true, 1).filter((s) => s !== "left")).toEqual(["right"]);
  });
});

describe("pedestrians", () => {
  it("cross avenues only at signalled corners, and only with time on the red", () => {
    const random = () => 0.1;
    // From block (1, 1)'s (-x, -z) corner both crossings are onto avenues at a signalled corner.
    const leg = nextLeg(1, 1, 2, 1, random);
    expect(leg.kind).toBe("cross");
    if (leg.kind !== "cross") return;
    expect(leg.avenue).toBe(true);
    const redAt = (min: number) => (leg.roadAxis === "x" ? 10.05 : 0.05) * GAME_MINUTE + min * GAME_MINUTE;
    expect(mayCross(leg, redAt(0))).toBe(true);
    expect(mayCross(leg, redAt(9.5))).toBe(false);
    expect(redRemaining(leg.roadAxis, redAt(0))).toBeGreaterThan(14);
  });
  it("never crosses an avenue between lights", () => {
    // Block (1, 2) faces the avenue at x = 32 on its -x side, at a corner with street 1 (not signalled).
    for (let n = 0; n < 50; n++) {
      const leg = nextLeg(1, 2, 2, 1, () => (n % 10) / 10);
      if (leg.kind === "cross") expect(leg.avenue).toBe(false);
    }
    expect(cornerPoint(0, 0, 0)).toEqual([18.4, 18.4]);
  });
  it("steps around something in the way and keeps heading for the target", () => {
    const [dx, dz] = steer(0, 0, [0, 10], [{ x: 0.1, z: 1.2, r: 0.3 }]);
    expect(dz).toBeGreaterThan(0.3);
    expect(Math.abs(dx)).toBeGreaterThan(0.2);
    expect(steer(0, 0, [0, 10], []).slice(0, 2)).toEqual([0, 1]);
  });
  it("comes in pink and blue, about evenly", () => {
    const pink = Array.from({ length: 400 }, (_, i) => npcGender(1337, i)).filter((g) => g === "female").length;
    expect(pink).toBeGreaterThan(150); expect(pink).toBeLessThan(250);
  });
});

describe("how many people are about", () => {
  it("is 50 by day, 22 from 8 pm to 1 am, and 10 from 1 am to 6 am", async () => {
    const { npcTarget } = await import("@/game/pedestrians");
    expect([6, 12, 19.9].map(npcTarget)).toEqual([50, 50, 50]);
    expect([20, 23.5, 0.5].map(npcTarget)).toEqual([22, 22, 22]);
    expect([1, 3, 5.9].map(npcTarget)).toEqual([10, 10, 10]);
  });
});

describe("people steering round vehicles", () => {
  it("keeps clear of a parked car's ends, not just its middle", async () => {
    const { boxObstacles, steer } = await import("@/game/pedestrians");
    const car = { x: 0, z: 0, hx: 2.2, hz: 0.95, yaw: 0 };
    const circles = boxObstacles(car);
    expect(Math.max(...circles.map((c) => c.x + c.r))).toBeGreaterThanOrEqual(2.2);
    expect(Math.min(...circles.map((c) => c.x - c.r))).toBeLessThanOrEqual(-2.2);
    // Walking straight at the car's front end from 2 m away: they bend aside.
    const [dx] = steer(3.6, -0.3, [-10, -0.3], circles);
    expect(Math.abs(dx)).toBeLessThan(1);
  });
});

describe("walking round a bus in the way", () => {
  it("heads for the nearer end of a bus parked across the way, keeps to that side, then carries on", async () => {
    const { detour, segmentHitsBox } = await import("@/game/pedestrians");
    // A 12 m bus lying across x (the walker comes up from z = -6 heading for z = +8), slightly off-centre.
    const bus = { x: 1, z: 0, hx: 6, hz: 1.3, yaw: 0 };
    expect(segmentHitsBox(bus, [0, -6], [0, 8], 0.5)).toBe(true);
    const corner = detour(0, -6, [0, 8], [bus], null)!;
    expect(corner).not.toBeNull();
    // The nearer end is the -x one (the bus sticks out further on +x).
    expect(corner[0]).toBeLessThan(-5); expect(corner[1]).toBeLessThan(0);
    // A step later it still goes the same way round (no dithering), even if the other side is nearly as short.
    const again = detour(-1, -5.5, [0, 8], [bus], corner)!;
    expect(again[0]).toBeLessThan(-5);
    // Once past the end, round the far corner and on.
    const past = detour(-7.2, -1.8, [0, 8], [bus], corner);
    expect(past === null || past[1] > 0).toBe(true);
    // Nothing in the way: no detour.
    expect(detour(0, -6, [0, 8], [{ ...bus, x: 30 }], null)).toBeNull();
  });
});

describe("people stepping round each other", () => {
  it("passes someone standing in the way, or walking the other way, with room to spare", async () => {
    const { steer, NPC_RADIUS } = await import("@/game/pedestrians");
    const walk = (others: { x: number; z: number; t?: [number, number] }[]) => {
      const me = { x: 0, z: 0, t: [0, 8] as [number, number] }, all = [me, ...others];
      let gap = Infinity;
      for (let k = 0; k < 600; k++) {
        for (const p of all) {
          if (!p.t || Math.hypot(p.t[0] - p.x, p.t[1] - p.z) < 0.45) continue;
          const [dx, dz] = steer(p.x, p.z, p.t, all.filter((o) => o !== p).map((o) => ({ x: o.x, z: o.z, r: NPC_RADIUS })));
          p.x += dx * 1.3 / 60; p.z += dz * 1.3 / 60;
        }
        gap = Math.min(gap, Math.hypot(me.x - others[0]!.x, me.z - others[0]!.z));
      }
      return { gap, there: Math.hypot(me.t[0] - me.x, me.t[1] - me.z) < 0.5 };
    };
    for (const result of [walk([{ x: 0, z: 4 }]), walk([{ x: 0.2, z: 4 }]), walk([{ x: 0, z: 8, t: [0, 0] }])]) {
      expect(result.there).toBe(true);
      expect(result.gap).toBeGreaterThan(0.95);
    }
  });
});

describe("a gap too narrow to pass", () => {
  it("goes round the far side of someone standing by a tree, not into the gap between them", async () => {
    const { steer, NPC_RADIUS } = await import("@/game/pedestrians");
    // A tree trunk and someone standing 1.1 m from it, right across the way.
    const fixed = [{ x: -0.55, z: 3, r: 0.3 }, { x: 0.55, z: 3, r: NPC_RADIUS }];
    const me = { x: 0, z: 0 }; let side: 1 | -1 = 1, closest = Infinity;
    for (let k = 0; k < 600; k++) {
      const [dx, dz, s] = steer(me.x, me.z, [0, 8], fixed, side);
      side = s; me.x += dx * 1.3 / 60; me.z += dz * 1.3 / 60;
      for (const o of fixed) closest = Math.min(closest, Math.hypot(me.x - o.x, me.z - o.z) - o.r - NPC_RADIUS);
    }
    expect(Math.hypot(me.x, me.z - 8)).toBeLessThan(0.5);
    expect(closest).toBeGreaterThan(0.15);
  });
});
