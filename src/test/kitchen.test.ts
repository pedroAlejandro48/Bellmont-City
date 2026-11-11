import { describe, expect, it } from "vitest";
import { burnLevel, foodColors, newKitchen, readKitchen, stoveState } from "@/game/kitchen";
import { canConsume, consume } from "@/game/needs";
import { CANDY_EFFECT, CANDY_INFO, COOK_MINUTES, mealEffect, shelfSections } from "@/game/pantry";
import { GROCERY_PRICE } from "@/game/groceryRun";
import { ITEMS } from "@/game/inventory";

describe("pantry and kitchen", () => {
  it("a meal fills 35% a can (three fill you), 10% thirst and energy a can", () => {
    expect(mealEffect(1)).toEqual({ hunger: 35, thirst: 10, energy: 10 });
    expect(mealEffect(2).hunger).toBe(70);
    expect(mealEffect(3)).toEqual({ hunger: 100, thirst: 30, energy: 30 });
  });
  it("candy: half an energy drink's energy and harm, a little hunger", () => {
    const n = consume({ health: 100, hunger: 50, thirst: 50, energy: 50 }, CANDY_INFO.milkChocolate.name, 1);
    expect(n.energy).toBe(50 + CANDY_EFFECT.energy); expect(CANDY_EFFECT.energy).toBe(20);
    expect(n.health).toBe(100 - 7.5); expect(n.hunger).toBe(58);
    expect(canConsume({ health: 100, hunger: 100, thirst: 50, energy: 40 }, CANDY_INFO.lollipop.name)).toBe(true);
    expect(ITEMS.gummyBears.use).toBe("eat"); expect(ITEMS.tuna.use).toBe("hold");
  });
  it("everything on the shelves has a price; 12 cans, 8 candies", () => {
    const pantry = shelfSections("pantry", 3.2), secs = [...pantry, ...shelfSections("kitchenware", 3)];
    expect(pantry.filter((s) => s.side === 1).length).toBe(12);
    expect(pantry.filter((s) => s.side === -1).length).toBe(8);
    for (const s of secs) expect(GROCERY_PRICE[s.kind as keyof typeof GROCERY_PRICE]).toBeGreaterThan(0);
  });
  it("cooks for 30 game minutes, then is ready for 10, then burnt (going black) — two burners at once", () => {
    const k = newKitchen(), M = 2;
    expect(stoveState(k, 0, 0, M)).toBe("none");
    k.stoves[0] = { ware: "pot", cans: [], start: null }; expect(stoveState(k, 0, 0, M)).toBe("empty");
    k.stoves[0] = { ware: "pot", cans: ["tuna"], start: 100 };
    k.stoves[1] = { ware: "pan", cans: ["corn"], start: 100 + 20 * M };
    expect(stoveState(k, 0, 100 + 29 * M, M)).toBe("cooking");
    expect(stoveState(k, 0, 100 + 31 * M, M)).toBe("ready"); expect(stoveState(k, 1, 100 + 31 * M, M)).toBe("cooking");
    expect(stoveState(k, 0, 100 + 41 * M, M)).toBe("burnt"); expect(stoveState(k, 1, 100 + 51 * M, M)).toBe("ready");
    expect(burnLevel(COOK_MINUTES - 1)).toBe(0); expect(burnLevel(COOK_MINUTES + 10)).toBe(1);
    expect(foodColors(["tuna"], 1).a).toBe("#0e0e0e");
  });
  it("reads a saved kitchen defensively", () => {
    const k = readKitchen({ cupboard: ["pot", "plate", "nope"], rack: ["plate", "pan"], sink: ["cup"], stove: { ware: "pan", cans: ["tuna", "corn", "peas"], start: 5 }, hands: { left: { ware: "plate", food: ["tuna"], dirty: false } }, table: [{ chair: 1, ware: "plate", cans: ["corn"], eaten: true, silver: true }] });
    expect(k.cupboard).toEqual(["pot"]); expect(k.rack).toEqual(["plate"]); expect(k.stoves[0]!.cans).toEqual(["tuna", "corn"]); expect(k.stoves[1]).toBe(null);
    expect(k.hands.left!.food).toEqual(["tuna"]); expect(k.table[0]!.silver).toBe(true);
    expect(readKitchen(null)).toEqual(newKitchen());
  });
});
