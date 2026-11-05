import { describe, expect, it } from "vitest";
import { generateCity } from "@/game/config";
import { GRAB_BAG, HOLD_OUT, PER_ITEM, clerkAt, landingSpot, payPlan, pickItem, planAt, sources, takeBasket } from "@/game/groceryRun";
import { venueLayout } from "@/game/venueRoom";

const store = venueLayout(generateCity(1337, 0, 0).buildings.find((b) => b.venue === "grocery")!);

describe("grocery moves", () => {
  it("every crate and the water shelf can be picked from, standing in front of it", () => {
    const s = sources(store);
    expect(s.map((x) => x.kind)).toEqual(expect.arrayContaining(["apple", "banana", "orange", "water"]));
    for (const src of s) expect(Math.hypot(src.stand[0] - src.take[0], src.stand[1] - src.take[2])).toBeGreaterThan(0.3);
  });
  it("taking a basket picks it up at the bottom of the squat, and ends standing with it at the waist", () => {
    const pile = store.fixtures.find((f) => f.type === "baskets")!;
    const p = takeBasket([0, -2.5], Math.PI, pile, false);
    let ev: string[] = [], prev = -1;
    for (let t = 0; t <= p.total + 0.01; t += 0.05) { const r = planAt(p, t, prev); ev = ev.concat(r.events); prev = t; }
    expect(ev).toEqual(["basket"]);
    const end = planAt(p, p.total + 1).pose;
    expect(end.crouch).toBeCloseTo(0, 5);
    expect(end.right?.blend).toBe(1);
  });
  it("picking one takes it, then drops it in, without jumps between the pieces", () => {
    const src = sources(store)[0]!;
    const p = pickItem([src.stand[0] + 1, src.stand[1]], 0, src, false);
    const ev: string[] = []; let prev = -1, last = planAt(p, 0).pose;
    for (let t = 0; t <= p.total + 0.01; t += 0.02) {
      const r = planAt(p, t, prev); ev.push(...r.events); prev = t;
      expect(Math.hypot(r.pose.x - last.x, r.pose.z - last.z)).toBeLessThan(0.1);
      last = r.pose;
    }
    expect(ev).toEqual(["take", "drop"]);
  });
  it("the clerk holds the bag out exactly when the customer's hand comes up for it", () => {
    const n = 3, svc = store.service, pay = payPlan([svc.x, svc.z], svc.yaw, store, n);
    let down = -1, bag = -1, prev = -1;
    for (let t = 0; t <= pay.total + 0.01; t += 0.01) { const r = planAt(pay, t, prev); if (r.events.includes("basketDown")) down = t; if (r.events.includes("bag")) bag = t; prev = t; }
    expect(bag - down).toBeCloseTo(n * PER_ITEM + GRAB_BAG + HOLD_OUT, 1);
    const at = () => [0, 1, 0] as [number, number, number];
    expect(clerkAt(n * PER_ITEM + GRAB_BAG + 0.1, n, at, store).holding).toBe("bag");
    expect(clerkAt(0.6, n, at, store).holding).toBe(0);
    expect(clerkAt(n * PER_ITEM + GRAB_BAG + HOLD_OUT + 0.1, n, at, store).given).toBe(true);
  });
  it("things land inside the basket, stacking where they fall on others", () => {
    let k = 0; const rnd = () => [0.5, 0.5, 0.5, 0.5, 0.1, 0.9][k++ % 6]!;
    const a = landingSpot([], rnd), b = landingSpot([a], rnd);
    expect(a.y).toBe(0); expect(b.y).toBeGreaterThan(0);
    expect(Math.abs(a.x)).toBeLessThan(0.16); expect(Math.abs(a.z)).toBeLessThan(0.1);
  });
});
