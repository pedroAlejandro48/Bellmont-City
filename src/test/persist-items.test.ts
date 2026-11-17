import { describe, expect, it } from "vitest";
import { DEFAULT_SAVE } from "@/game/config";
import { readSave } from "@/game/saves";
import { createState, toSave } from "@/game/state";

describe("things put down and held are kept", () => {
  it("ground items, the held slot, trash and a grocery bag survive saving and loading", () => {
    const s = createState(readSave(DEFAULT_SAVE));
    s.life.inventory[2] = "water"; s.heldSlot = 2; s.groceryBag = ["apple", "banana"];
    s.groundItems.push({ id: 1, kind: "apple", x: 3, z: 4, yaw: 1, at: 0 }, { id: 2, kind: "groceryBag", x: 5, z: 6, y: 9.5, yaw: 0, at: 0, contents: ["water"] }, { id: 3, kind: "bottle", x: 1, z: 1, yaw: 0, at: 0 });
    const back = createState(readSave(JSON.parse(JSON.stringify(toSave(s)))));
    expect(back.groundItems.map((g) => [g.kind, g.x, g.z, g.y])).toEqual([["apple", 3, 4, undefined], ["groceryBag", 5, 6, 9.5], ["bottle", 1, 1, undefined]]);
    expect(back.groundItems[1]!.contents).toEqual(["water"]);
    expect(back.heldSlot).toBe(2); expect(back.groceryBag).toEqual(["apple", "banana"]);
    expect(back.life.inventory[2]).toBe("water");
  });
  it("trash in the hand comes back; a held slot that's empty doesn't", () => {
    const s = createState(readSave(DEFAULT_SAVE));
    s.heldTrash = "can"; s.heldSlot = 5;
    const back = createState(readSave(JSON.parse(JSON.stringify(toSave(s)))));
    expect(back.heldTrash).toBe("can"); expect(back.heldSlot).toBeNull();
  });
});
