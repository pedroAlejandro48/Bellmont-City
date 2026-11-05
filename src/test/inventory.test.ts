import { describe, expect, it } from "vitest";
import { SLOTS, addItem, freeSlots, newInventory, pressSlot, readInventory, removeItem } from "@/game/inventory";

describe("inventory", () => {
  it("always keeps the phone in the first slot", () => {
    const inv = newInventory();
    expect(inv).toHaveLength(SLOTS);
    expect(inv[0]).toBe("phone");
    expect(addItem(inv, "phone")).toBe(-1);
    expect(removeItem(inv, 0)).toBeNull();
    expect(readInventory(["water", "phone", "apple", "junk"])).toEqual(["phone", null, "apple", null, null, null, null, null, null]);
  });
  it("fills the first free slot, or the one asked for", () => {
    const inv = newInventory();
    expect(addItem(inv, "water")).toBe(1);
    expect(addItem(inv, "apple", 5)).toBe(5);
    expect(addItem(inv, "orange", 5)).toBe(2);
    expect(freeSlots(inv)).toBe(5);
    for (let i = 0; i < 5; i++) addItem(inv, "banana");
    expect(addItem(inv, "banana")).toBe(-1);
  });
  it("number keys take out, put away and store", () => {
    const inv = newInventory(); addItem(inv, "water");
    expect(pressSlot(inv, null, 1).kind).toBe("show");
    expect(pressSlot(inv, 1, 1).kind).toBe("hide");
    expect(pressSlot(inv, 1, 3).kind).toBe("store");
    expect(pressSlot(inv, null, 0).kind).toBe("show");
  });
});
