import { describe, expect, it } from "vitest";
import { DEFAULT_SAVE } from "@/game/config";
import { handFree, holding, holdingOther, needFreeHands } from "@/game/handsHeld";
import { consumeHeld } from "@/game/invRuntime";
import { pressInventorySlot } from "@/game/invRuntime";
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
  it("a thing from the inventory can't come out into a hand that holds something else", () => {
    const s = createState(DEFAULT_SAVE);
    s.life.inventory[1] = "apple";
    s.life.kitchen.hands.right = { ware: "plate", food: null, dirty: false };
    pressInventorySlot(s, 1);
    expect(s.heldSlot).toBe(null);
    expect(s.toasts.some((t) => t.title === "Your right hand is full")).toBe(true);
    s.life.kitchen.hands.right = null;
    pressInventorySlot(s, 1);
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
