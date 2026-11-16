import { describe, expect, it } from "vitest";
import { atFloor, DWELL, doorsOf, newCar, request, stepCar, type Car } from "../game/liftCar";

const run = (c: Car, secs: number, blocked = () => false, log?: number[]) => {
  for (let t = 0; t < secs; t += 0.05) { const was = c.phase; stepCar(c, 0.05, blocked()); if (log && was === "moving" && c.phase === "opening") log.push(c.y); }
};
describe("elevator car", () => {
  it("goes a floor a second, opens there for 8 s then shuts", () => {
    const c = newCar(); request(c, 5);
    run(c, 3.8); expect(c.phase).toBe("moving");
    run(c, 0.4); expect(atFloor(c, 5)).toBe(true);
    run(c, 1); expect(doorsOf(c)).toBe(1);
    run(c, DWELL - 0.5); expect(doorsOf(c)).toBe(1);
    run(c, 2); expect(c.phase).toBe("idle");
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
