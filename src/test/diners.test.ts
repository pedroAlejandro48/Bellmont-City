import { describe, expect, it } from "vitest";
import { generateCity } from "@/game/config";
import { makeRoom } from "@/game/restaurantRoom";
import { FoodSim, placesOf } from "@/game/food";
import { DinerSim, arrivalGap, type DinerContext } from "@/game/diners";
import type { DoorUse } from "@/game/doors";

const b = generateCity(1337, 0, 0).buildings.find((q) => q.restaurant === "burger")!;
const room = makeRoom(b), places = placesOf(room), key = room.key;

describe("restaurant customers", () => {
  it("comes busiest at lunch (breakfast at the café) and only to the burger place at night", () => {
    expect(arrivalGap("burger", 13)).toBeLessThan(arrivalGap("burger", 18));
    expect(arrivalGap("cafe", 8)).toBeLessThan(arrivalGap("cafe", 13));
    expect(arrivalGap("burger", 3)).toBe(100);
    expect(arrivalGap("pizza", 3)).toBe(Infinity);
  });
  for (const mode of ["here", "togo"] as const) it(`orders, gets the food (${mode}) and leaves`, () => {
    const food = new FoodSim((k) => (k === key ? { places, room } : null)), diners = new DinerSim();
    const uses: DoorUse[] = [];
    let r = 0.3;
    const ctx = (now: number): DinerContext => ({
      now, hours: 13, keys: [key], rooms: () => ({ room, places, kind: "burger" }), people: () => [], takenChairs: new Set(),
      doorUses: (k, leaf) => uses.filter((u) => u.key === k && u.leaf === leaf), addDoorUse: (u) => { uses.push(u); }, random: () => (r = (r * 9301 + 49297) % 233280 / 233280),
    });
    const seen = new Set<string>();
    let t = 0;
    for (; t < 400; t += 0.05) {
      const c = ctx(t);
      diners.step(c, food);
      for (const d of diners.diners) { d.mode = mode; seen.add(d.step); }
      food.step(t, (by, k) => (by.startsWith("npc:") ? diners.inside(by, k) : false), (by) => diners.present(by));
      if (seen.has("leave") && diners.diners.length === 0) break;
    }
    for (const step of ["arrive", "enter", "queue", "order", "toDoor", "exit"]) expect(seen.has(step)).toBe(true);
    if (mode === "here") { expect(seen.has("seat")).toBe(true); expect(seen.has("eat")).toBe(true); }
    else expect(seen.has("pickup")).toBe(true);
  });
});
