import { describe, expect, it } from "vitest";
import { DEFAULT_SAVE } from "@/game/config";
import { handFree, holding, holdingOther } from "@/game/handsHeld";
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
});
