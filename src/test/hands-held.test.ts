import { describe, expect, it } from "vitest";
import { DEFAULT_SAVE } from "@/game/config";
import { handFree, holding, holdingOther, needFreeHands } from "@/game/handsHeld";
import { consumeHeld } from "@/game/invRuntime";
import { pressInventorySlot, stepInventory } from "@/game/invRuntime";
import { createState } from "@/game/state";

describe("one thing per hand", () => {
  it("knows what's in each hand, whatever it is", () => {
    const s = createState(DEFAULT_SAVE);
    expect(handFree(s, "left")).toBe(true); expect(handFree(s, "right")).toBe(true);
    s.groceryBag = ["apple"]; expect(holding(s, "left")).toBe("the grocery bag");
    s.life.kitchen.hands.right = { ware: "pot", food: null, dirty: false };
    expect(holding(s, "right")).toBe("pot"); expect(holdingOther(s, "right")).toBe(false);
    s.heldTrash = "bottle"; expect(holdingOther(s, "right")).toBe(true);
  });
  it("taking a thing out of the inventory with the right hand full: passed to the left, or put down when both are full", () => {
    const s = createState(DEFAULT_SAVE);
    const run = (secs: number) => { for (let i = 0; i < secs * 20; i++) { s.simulationTime += 0.05; stepInventory(s); } };
    s.life.inventory[1] = "apple";
    s.life.kitchen.hands.right = { ware: "plate", food: null, dirty: false };
    // The left hand's free: the plate goes over to it, then the apple comes out.
    pressInventorySlot(s, 1);
    expect(s.invAct?.kind).toBe("pass");
    run(1);
    expect(s.life.kitchen.hands.left?.ware).toBe("plate");
    expect(s.life.kitchen.hands.right).toBe(null);
    expect(s.heldSlot).toBe(1);
    // Both full (a cup in the right, the plate in the left): the cup goes down on the floor, then the apple comes out.
    s.heldSlot = null;
    s.life.kitchen.hands.right = { ware: "cup", food: null, dirty: false };
    pressInventorySlot(s, 1);
    expect(s.invAct?.kind).toBe("drop");
    run(2);
    expect(s.life.kitchen.hands.right).toBe(null);
    expect(s.groundItems.some((g) => g.kind === "cup")).toBe(true);
    expect(s.heldSlot).toBe(1);
  });
  it("showering, sleeping, changing clothes, eating… need empty hands", () => {
    const s = createState(DEFAULT_SAVE);
    expect(needFreeHands(s, "showering")).toBe(true);
    s.groceryBag = ["apple"];
    expect(needFreeHands(s, "showering")).toBe(false);
    expect(s.toasts.some((t) => t.title === "Your hands are full")).toBe(true);
    // Eating what's in the right hand: not with the bag in the left.
    s.life.inventory[1] = "apple"; s.heldSlot = 1; s.hunger = 50;
    consumeHeld(s); expect(s.invAct).toBe(null);
    s.groceryBag = null; consumeHeld(s); expect(s.invAct?.kind).toBe("eat");
  });
});
