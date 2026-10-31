import { describe, expect, it } from "vitest";
import { crossingStopDistance, mustGiveWay, relationOf, type CrossingAgent, type Move } from "@/game/trafficLogic";
import { allowedTurns } from "@/game/trafficRoutes";

describe("who gives way at an intersection", () => {
  it("tells oncoming, from-the-right and from-the-left traffic apart (right-hand traffic)", () => {
    const north = { axis: "z" as const, dir: 1 as const };
    expect(relationOf(north, { axis: "z", dir: -1 })).toBe("opposite");
    expect(relationOf(north, { axis: "z", dir: 1 })).toBeNull();
    // Heading +z the right-hand side is -x: someone heading -x is driving toward it, so came from the left.
    expect(relationOf(north, { axis: "x", dir: -1 })).toBe("left");
    expect(relationOf(north, { axis: "x", dir: 1 })).toBe("right");
  });
  it("turning right: waits only for traffic from the left going straight", () => {
    for (const theirs of ["straight", "right", "left"] as Move[]) {
      expect(mustGiveWay("right", "opposite", theirs, false)).toBe(false);
      expect(mustGiveWay("right", "right", theirs, false)).toBe(false);
      expect(mustGiveWay("right", "left", theirs, false)).toBe(theirs === "straight");
    }
    // An oncoming left turn already heading for the same lane is waited for once it is in the intersection.
    expect(mustGiveWay("right", "opposite", "left", true)).toBe(true);
  });
  it("turning left: waits for anything oncoming or from the left, and from the right unless it turns right", () => {
    for (const theirs of ["straight", "right", "left"] as Move[]) {
      expect(mustGiveWay("left", "opposite", theirs, false)).toBe(true);
      expect(mustGiveWay("left", "left", theirs, false)).toBe(true);
      expect(mustGiveWay("left", "right", theirs, false)).toBe(theirs !== "right");
    }
  });
  it("an oncoming left turn waits for a right turn heading into the same lane", () => {
    expect(mustGiveWay("left", "opposite", "right", false)).toBe(true);
  });
  it("going straight: never stops for someone still coming, only for a crossing path already in the box", () => {
    for (const from of ["opposite", "right", "left"] as const) for (const theirs of ["straight", "right", "left"] as Move[]) expect(mustGiveWay("straight", from, theirs, false)).toBe(false);
    expect(mustGiveWay("straight", "opposite", "straight", true)).toBe(false);
    expect(mustGiveWay("straight", "opposite", "left", true)).toBe(true);
    expect(mustGiveWay("straight", "right", "straight", true)).toBe(true);
    expect(mustGiveWay("straight", "left", "right", true)).toBe(false);
  });
  it("turns only from the matching lane of a two-lane road", () => {
    expect(allowedTurns(true, 1)).toEqual(["right"]);
    expect(allowedTurns(true, 0)).toEqual(["left"]);
  });
});

describe("waiting at the corner", () => {
  // The streets at 90 cross at (90, 90); its box spans 84..96 each way.
  const car = (id: number, axis: "x" | "z", dir: 1 | -1, t: number, move: Move, speed = 8, waiting = false): CrossingAgent => {
    const lane = 90 + (axis === "x" ? dir : -dir) * 3;
    return { id, axis, dir, road: 90, t, x: axis === "x" ? t : lane, z: axis === "z" ? t : lane, length: 4.4, speed, move, waiting, going: false };
  };
  it("a left turn waits behind the corner for oncoming traffic, then goes", () => {
    const me = car(1, "z", 1, 75, "left");
    const stop = crossingStopDistance(me, [me, car(2, "z", -1, 104, "straight")]);
    expect(stop).not.toBeNull();
    expect(stop!).toBeLessThan(9);
    expect(crossingStopDistance(me, [me, car(2, "z", -1, 70, "straight")])).toBeNull();
  });
  it("a right turn does not wait for oncoming traffic going straight, but does for straight traffic from the left", () => {
    const me = car(1, "z", 1, 75, "right");
    expect(crossingStopDistance(me, [me, car(2, "z", -1, 104, "straight")])).toBeNull();
    expect(crossingStopDistance(me, [me, car(3, "x", -1, 104, "straight")])).not.toBeNull();
    expect(crossingStopDistance(me, [me, car(3, "x", -1, 104, "left")])).toBeNull();
  });
  it("straight traffic waits when a turn is already under way across its path", () => {
    const me = car(1, "z", 1, 76, "straight");
    expect(crossingStopDistance(me, [me, car(2, "z", -1, 90, "left")])).not.toBeNull();
    expect(crossingStopDistance(me, [me, car(2, "z", -1, 104, "left")])).toBeNull();
  });
  it("two left turns facing each other never both wait for ever", () => {
    const a = car(1, "z", 1, 80, "left", 0, true), b = car(2, "z", -1, 100, "left", 0, true);
    const waits = [crossingStopDistance(a, [a, b]), crossingStopDistance(b, [a, b])].filter((d) => d !== null);
    expect(waits).toHaveLength(1);
  });
  it("once one of them pulls away, the other keeps waiting even before it picks up speed", () => {
    const a = { ...car(1, "z", 1, 80, "left", 0, false), going: true }, b = car(2, "z", -1, 100, "left", 0, true);
    expect(crossingStopDistance(b, [a, b])).not.toBeNull();
  });
});
