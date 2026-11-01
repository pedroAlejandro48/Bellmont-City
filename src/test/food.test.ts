import { describe, expect, it } from "vitest";
import { generateCity, RESTAURANTS } from "@/game/config";
import { roomLayout } from "@/game/restaurantRoom";
import {
  FoodSim, GRAB_CONTACT, GRAB_TIME, atCounter, canReach, grabReach, greetingLine, menuOf, orderTotal, packOrder, placesOf, readSnapshot, runnerPose, toldLine, tripTimes,
} from "@/game/food";

const rooms = generateCity(1337, 0, 0).buildings.filter((b) => b.restaurant).map((b) => roomLayout(b));

describe("packing an order to go", () => {
  it("hands over one bag and one cup as they are", () => {
    expect(packOrder(1, 0)).toEqual([{ kind: "bag", bags: 1, cups: 0 }]);
    expect(packOrder(3, 1)).toEqual([{ kind: "bag", bags: 1, cups: 0 }, { kind: "cup", bags: 0, cups: 1 }]);
    expect(packOrder(0, 1)).toEqual([{ kind: "cup", bags: 0, cups: 1 }]);
  });
  it("puts two or more bags, or two or more cups, in big bags of 3 bags and 4 cups", () => {
    expect(packOrder(4, 0)).toEqual([{ kind: "big", bags: 2, cups: 0 }]);
    expect(packOrder(0, 2)).toEqual([{ kind: "big", bags: 0, cups: 2 }]);
    expect(packOrder(9, 4)).toEqual([{ kind: "big", bags: 3, cups: 4 }]);
    const many = packOrder(12, 5);
    expect(many.length).toBe(2);
    expect(many.every((p) => p.kind === "big" && p.bags <= 3 && p.cups <= 4)).toBe(true);
    expect(many.reduce((s, p) => s + p.bags, 0)).toBe(4);
    expect(many.reduce((s, p) => s + p.cups, 0)).toBe(5);
  });
});

describe("the menu and the cashier", () => {
  it("prices every item and adds up to the cent", () => {
    expect(orderTotal("burger", ["Classic Bell", "Fries", "Fountain Soda"])).toBe(12.97);
    for (const kind of Object.keys(RESTAURANTS) as (keyof typeof RESTAURANTS)[]) expect(menuOf(kind).flatMap((s) => s.items).every((i) => i.price > 0)).toBe(true);
    expect(menuOf("cafe")[0]!.items.every((i) => i.drink)).toBe(true);
  });
  it("greets with the place's name, never too short or too long, and rarely the same way twice", () => {
    const lines = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const line = greetingLine("burger", 13);
      expect(line).toContain("Big Bell Burgers");
      expect(line.length).toBeGreaterThan(25); expect(line.length).toBeLessThan(140);
      lines.add(line);
    }
    expect(lines.size).toBeGreaterThan(30);
    expect(toldLine("togo").length).toBeGreaterThan(20);
  });
});

describe("the counter", () => {
  it("serves whoever stands in front of the register, and lets them reach the pick-up spots", () => {
    for (const room of rooms) {
      const p = placesOf(room);
      expect(atCounter(p, p.customer.x, p.customer.z)).toBe(true);
      expect(atCounter(p, p.customer.x, p.customer.z + 2)).toBe(false);
      expect(p.slots.length).toBeGreaterThanOrEqual(4);
      // Every spot is on the counter top.
      for (const s of p.slots) { expect(Math.abs(s.x - room.counter.x)).toBeLessThan(room.counter.hx); expect(Math.abs(s.z - room.counter.z)).toBeLessThan(room.counter.hz); }
      // Standing against the counter (a body is 0.35 m round), the nearest spot is within reach.
      const s = p.slots[0]!;
      expect(canReach(s, s.x, room.counter.z + room.counter.hz + 0.36)).toBe(true);
    }
  });
  it("reaches up to the food and back to the waist in one movement", () => {
    expect(grabReach(0)).toBe(0); expect(grabReach(GRAB_CONTACT)).toBeCloseTo(1); expect(grabReach(GRAB_TIME)).toBeCloseTo(0);
  });
});

describe("orders, the kitchen runner and the food", () => {
  const room = rooms[0]!, places = placesOf(room), key = room.key;
  const make = () => new FoodSim((k) => (k === key ? { places, room } : null));
  const inside = (where: Record<string, string | null>) => (by: string, k: string) => where[by] === k;
  const present = () => true;

  it("brings food to go out to the counter, where it can be picked up", () => {
    const sim = make(), where = { me: key };
    sim.handle("me", { type: "greet", key, text: "Hi" }, 0);
    expect(sim.sessions.get(key)?.by).toBe("me");
    sim.handle("me", { type: "order", key, kind: room.kind, names: [menuOf(room.kind)[1]!.items[0]!.name, menuOf(room.kind)[0]!.items[0]!.name], mode: "togo", text: "Thanks!" }, 1);
    expect(sim.sessions.get(key)?.stage).toBe("told");
    expect(sim.packs.length).toBeGreaterThan(0);
    // Not out before it is cooked.
    sim.step(2, inside(where), present);
    expect(sim.trips.size).toBe(0);
    let t = 40;
    sim.step(t, inside(where), present);
    const trip = sim.trips.get(key)!;
    expect(trip.task).toBe("deliver");
    expect(sim.packs.filter((p) => p.where === "runner").length).toBe(trip.packs.length);
    const times = tripTimes(places, room, trip);
    t += times.done + 0.1;
    sim.step(t, inside(where), present);
    sim.step(t + 30, inside(where), present);
    expect(sim.packs.every((p) => p.where === "counter")).toBe(true);
    // Picked up: one per hand.
    const first = sim.packs[0]!;
    sim.handle("me", { type: "grab", pack: first.id, hand: "right" }, t + 31);
    expect(first.where).toBe("held");
    // A snapshot carries it all to the other players.
    const view = readSnapshot(JSON.parse(JSON.stringify(sim.snapshot(t + 31))))!;
    expect(view.packs.find((p) => p.id === first.id)?.holder).toBe("me");
    expect(view.sessions.get(key)?.stage).toBe("told");
  });

  it("takes food left on the counter back to the kitchen once whoever ordered it goes out", () => {
    const sim = make(), where: Record<string, string | null> = { me: key };
    sim.handle("me", { type: "greet", key, text: "Hi" }, 0);
    sim.handle("me", { type: "order", key, kind: room.kind, names: [menuOf(room.kind)[1]!.items[0]!.name], mode: "togo", text: "Thanks!" }, 0);
    let t = 60;
    for (let i = 0; i < 40; i++, t += 1) sim.step(t, inside(where), present);
    expect(sim.packs.length).toBe(1); expect(sim.packs[0]!.where).toBe("counter");
    where["me"] = null;
    sim.step(t, inside(where), present);
    expect(sim.trips.get(key)?.task).toBe("clear");
    for (let i = 0; i < 40; i++, t += 1) sim.step(t, inside(where), present);
    expect(sim.packs.length).toBe(0);
  });

  it("walks the runner out of the kitchen to the counter and back", () => {
    const trip = { task: "deliver" as const, slots: [0] };
    const start = runnerPose(places, room, trip, 0), times = tripTimes(places, room, trip);
    expect(start.z).toBeLessThan(room.divider.z);
    const there = runnerPose(places, room, trip, times.walk + 0.2);
    expect(there.z).toBeGreaterThan(room.divider.z); expect(there.z).toBeLessThan(room.counter.z);
    expect(there.carrying).toBe(true);
    expect(runnerPose(places, room, trip, times.handover + 0.05).carrying).toBe(false);
    expect(runnerPose(places, room, trip, times.done).z).toBeCloseTo(places.kitchen.z);
  });
});

describe("eating in", () => {
  const room = rooms[0]!, places = placesOf(room), key = room.key;
  const make = () => new FoodSim((k) => (k === key ? { places, room } : null));
  const inside = (by: string, k: string) => by === "me" && k === key;
  it("gives a two-digit sign, serves the tray where the sign is put, and clears it away when done", () => {
    const sim = make();
    const food = menuOf(room.kind)[1]!.items[0]!.name;
    sim.handle("me", { type: "greet", key, text: "Hi" }, 0);
    sim.handle("me", { type: "order", key, kind: room.kind, names: [food], mode: "here", text: "Sit anywhere" }, 0);
    const sign = sim.packs.find((p) => p.kind === "sign")!, tray = sim.packs.find((p) => p.kind === "tray")!;
    expect(sign.sign).toBeGreaterThanOrEqual(10); expect(sign.sign).toBeLessThanOrEqual(99);
    expect(sign.where).toBe("counter"); expect(tray.sign).toBe(sign.sign);
    sim.handle("me", { type: "grab", pack: sign.id, hand: "right" }, 1);
    sim.handle("me", { type: "set", pack: sign.id, where: "table", x: room.frame.ox, y: 0.93, z: room.frame.oz - 4, yaw: 0 }, 2);
    let t = 30;
    sim.step(t, inside, () => true);
    expect(sim.trips.get(key)?.task).toBe("serve");
    for (let i = 0; i < 40; i++, t += 1) sim.step(t, inside, () => true);
    expect(tray.where).toBe("table"); expect(sim.packs.includes(sign)).toBe(false);
    sim.handle("me", { type: "eat", pack: tray.id, item: food }, t);
    expect(tray.eating?.item).toBe(food);
    sim.handle("me", { type: "ate", pack: tray.id, item: food }, t + 3);
    expect(tray.items.length).toBe(0); expect(tray.done).toBe(true);
    sim.step(t + 4, inside, () => true);
    expect(sim.trips.get(key)?.task).toBe("bus");
    for (let i = 0; i < 40; i++, t += 1) sim.step(t + 4, inside, () => true);
    expect(sim.packs.length).toBe(0);
  });
  it("never gives two diners the same number at once", () => {
    const sim = make();
    for (let i = 0; i < 20; i++) sim.handle(`p${i}`, { type: "order", key, kind: room.kind, names: [menuOf(room.kind)[1]!.items[0]!.name], mode: "here", text: "" }, i);
    const signs = sim.packs.filter((p) => p.kind === "sign").map((p) => p.sign);
    expect(new Set(signs).size).toBe(signs.length);
  });
});
