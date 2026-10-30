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
    expect(steer(0, 0, [0, 10], [])).toEqual([0, 1]);
  });
  it("comes in pink and blue, about evenly", () => {
    const pink = Array.from({ length: 400 }, (_, i) => npcGender(1337, i)).filter((g) => g === "female").length;
    expect(pink).toBeGreaterThan(150); expect(pink).toBeLessThan(250);
  });
});
