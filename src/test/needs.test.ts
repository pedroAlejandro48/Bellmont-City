import { describe, expect, it } from "vitest";
import { canConsume, consume, nutrition, stepNeeds } from "@/game/needs";
import { menuOf } from "@/game/food";

describe("hunger, thirst and health", () => {
  it("runs thirst out in 24 in-game hours and hunger in 48", () => {
    const day = stepNeeds({ health: 100, hunger: 100, thirst: 100 }, 24 * 60 - 1);
    expect(day.thirst).toBeGreaterThan(0); expect(day.hunger).toBeCloseTo(50, 0);
    expect(stepNeeds({ health: 100, hunger: 100, thirst: 100 }, 24 * 60).thirst).toBe(0);
  });
  it("loses 10% health a minute with either at zero, and heals 1% a minute otherwise", () => {
    expect(stepNeeds({ health: 80, hunger: 0, thirst: 50 }, 1).health).toBeCloseTo(70);
    expect(stepNeeds({ health: 80, hunger: 50, thirst: 50 }, 1).health).toBeCloseTo(81);
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
    expect(nutrition("Fountain Soda", 1.99)).toEqual({ hunger: 5, thirst: 10 });
    expect(nutrition("Bottled Water", 1.49)).toEqual({ hunger: 0, thirst: 40 });
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
