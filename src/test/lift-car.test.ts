import { describe, expect, it } from "vitest";
import { atFloor, DWELL, doorsOf, newCar, request, stepCar, type Car } from "../game/liftCar";

const run = (c: Car, secs: number, blocked = () => false, log?: number[]) => {
  for (let t = 0; t < secs; t += 0.05) { const was = c.phase; stepCar(c, 0.05, blocked()); if (log && was === "moving" && c.phase === "opening") log.push(c.y); }
};
describe("elevator car", () => {
  it("goes 2 s a floor, eases into the stop, opens there for 8 s then shuts", () => {
    const c = newCar(); request(c, 5);
    // (4 floors: about 8.6 s — speeding up for half a second at the start and slowing for half a second at the end.)
    run(c, 8.0); expect(c.phase).toBe("moving");
    run(c, 1.0); expect(atFloor(c, 5)).toBe(true);
    run(c, 1); expect(doorsOf(c)).toBe(1);
    run(c, DWELL - 1.5); expect(doorsOf(c)).toBe(1);
    run(c, 3); expect(c.phase).toBe("idle");
  });
  it("slows down smoothly before a floor, no hard stop", () => {
    const c = newCar(); request(c, 3);
    const speeds: number[] = [];
    for (let t = 0; t < 10 && c.phase === "moving" || t === 0; t += 0.05) { stepCar(c, 0.05, false); if (c.phase === "moving") speeds.push(c.v ?? 0); }
    expect(Math.max(...speeds)).toBeCloseTo(0.5, 2);
    // The last moments before it stops are slow, and it never jumps between speeds.
    expect(speeds.at(-1)!).toBeLessThan(0.15);
    for (let i = 1; i < speeds.length; i++) expect(Math.abs(speeds[i]! - speeds[i - 1]!)).toBeLessThan(0.1);
  });
  it("keeps its direction: up through every floor asked up there, then down", () => {
    const c = newCar(); c.y = 5; request(c, 8); run(c, 1);
    request(c, 3); request(c, 12); request(c, 10);
    const stops: number[] = []; run(c, 120, () => false, stops);
    expect(stops).toEqual([8, 10, 12, 3]);
  });
  it("waits while someone stands in the doors, then a clear second", () => {
    const c = newCar(); request(c, 1); run(c, 1);
    let blocked = true; run(c, DWELL + 3, () => blocked); expect(doorsOf(c)).toBe(1);
    blocked = false; run(c, 0.6); expect(doorsOf(c)).toBe(1); run(c, 2); expect(c.phase).toBe("idle");
  });
  it("goes on to its floors with nobody in it", () => {
    const c = newCar(); request(c, 4); request(c, 2); const stops: number[] = []; run(c, 60, () => false, stops);
    expect(stops).toEqual([2, 4]);
  });
});
