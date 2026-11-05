import { describe, expect, it } from "vitest";
import { canConsume, consume, nutrition, stepNeeds } from "@/game/needs";
import { menuOf } from "@/game/food";

describe("hunger, thirst and health", () => {
  it("runs thirst out in 24 in-game hours and hunger in 48", () => {
    const day = stepNeeds({ health: 100, hunger: 100, thirst: 100 }, 24 * 60 - 1);
    expect(day.thirst).toBeGreaterThan(0); expect(day.hunger).toBeCloseTo(50, 0);
    expect(stepNeeds({ health: 100, hunger: 100, thirst: 100 }, 24 * 60).thirst).toBe(0);
  });
  it("loses 10% health a minute with either at zero, and heals 10% a day otherwise", () => {
    expect(stepNeeds({ health: 80, hunger: 0, thirst: 50 }, 1).health).toBeCloseTo(70);
    expect(stepNeeds({ health: 80, hunger: 100, thirst: 100 }, 12 * 60).health).toBeCloseTo(85);
    expect(stepNeeds({ health: 100, hunger: 50, thirst: 50 }, 5).health).toBe(100);
  });
  it("fills hunger by price, 10% to 50%, and never past 100%", () => {
    expect(nutrition("Almond Biscotti", 2.25).hunger).toBeCloseTo(10);
    expect(nutrition("A5 Wagyu Tataki", 34).hunger).toBeCloseTo(50);
    const mid = nutrition("Classic Bell", 7.99).hunger;
    expect(mid).toBeGreaterThan(10); expect(mid).toBeLessThan(50);
    expect(consume({ health: 50, hunger: 95, thirst: 50 }, "A5 Wagyu Tataki", 34).hunger).toBe(100);
  });
  it("gives drinks 5% hunger and 10% thirst, and water 40% thirst", () => {
    expect(nutrition("Fountain Soda", 1.99)).toEqual({ hunger: 5, thirst: 10, energy: 0 });
    expect(nutrition("Bottled Water", 1.49)).toEqual({ hunger: 0, thirst: 40, energy: 0 });
    expect(consume({ health: 50, hunger: 50, thirst: 70 }, "Bottled Water", 1.49).thirst).toBe(100);
  });
  it("refuses food on a full stomach", () => {
    expect(canConsume({ health: 100, hunger: 100, thirst: 50 }, "Fries")).toBe(false);
    expect(canConsume({ health: 100, hunger: 100, thirst: 50 }, "Fountain Soda")).toBe(true);
  });
  it("sells bottled water everywhere", () => {
    for (const kind of ["cafe", "pizza", "fine", "burger"] as const) expect(menuOf(kind).flatMap((s) => s.items).some((i) => i.name === "Bottled Water" && i.drink)).toBe(true);
  });
});

import { CYCLE, timeInfo } from "@/game/config";
import { DRINK_EFFECTS, canSleepAt, stepEnergy, wakeElapsed } from "@/game/needs";
describe("energy and sleep", () => {
  it("energy runs down 75% a day, three times as fast running; an energy drink gives 40%", () => {
    expect(stepEnergy(100, 24 * 60, false)).toBeCloseTo(25, 5);
    expect(stepEnergy(100, 60, true)).toBeCloseTo(100 - 75 / 24 * 3, 5);
    expect(DRINK_EFFECTS["Volt Energy"]!.energy).toBe(40);
    expect(consume({ health: 80, hunger: 50, thirst: 50, energy: 30 }, "Volt Energy", 2).energy).toBe(70);
  });
  it("bed only from 9 PM to 5 AM, up at 6 AM (the next morning, or the same one after midnight)", () => {
    expect(canSleepAt(20.9)).toBe(false); expect(canSleepAt(21)).toBe(true); expect(canSleepAt(2)).toBe(true); expect(canSleepAt(5.2)).toBe(false);
    const at = (day: number, hours: number) => { for (let e = (day - 1) * CYCLE; e < day * CYCLE; e += 1) if (Math.abs(timeInfo(e).hours - hours) < 0.02) return e; return NaN; };
    const evening = at(3, 22), small = at(3, 2);
    expect(Math.round(timeInfo(wakeElapsed(evening)).hours)).toBe(6); expect(timeInfo(wakeElapsed(evening)).day).toBe(4);
    expect(Math.round(timeInfo(wakeElapsed(small)).hours)).toBe(6); expect(wakeElapsed(small) - small).toBeLessThan(CYCLE / 2);
  });
});

import { hoursTo6, sleepEnergy } from "@/game/needs";
describe("sleep energy and the energy drink's cost", () => {
  it("an hour or less gives 20%, eight or more fills it, evenly in between", () => {
    expect(sleepEnergy(30, 0.5)).toBe(50); expect(sleepEnergy(30, 1)).toBe(50);
    expect(sleepEnergy(10, 8)).toBe(100); expect(sleepEnergy(10, 9)).toBe(100);
    expect(sleepEnergy(0, 4.5)).toBeCloseTo(60, 5);
    expect(sleepEnergy(90, 3)).toBe(100);
    expect(hoursTo6(22)).toBe(8); expect(hoursTo6(2)).toBe(4); expect(hoursTo6(21)).toBe(9);
  });
  it("an energy drink takes 15% health", () => {
    expect(consume({ health: 80, hunger: 50, thirst: 50, energy: 30 }, "Volt Energy", 2).health).toBe(65);
    expect(consume({ health: 80, hunger: 50, thirst: 50, energy: 30 }, "Cola", 1).health).toBe(80);
  });
});
