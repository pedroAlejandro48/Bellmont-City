import { describe, expect, it } from "vitest";
import { bikeToClaim, CLAIM_METERS, shouldHandOver } from "@/multiplayer/RoomBikes";

describe("room bikes", () => {
  const player = { x: 0, z: 0 };

  it("takes the nearest free bike in reach", () => {
    expect(bikeToClaim(player, null, [{ id: "far", x: 5, z: 0 }, { id: "a", x: 1.2, z: 0 }, { id: "b", x: 0.8, z: 0 }])).toBe("b");
    expect(bikeToClaim(player, null, [{ id: "far", x: CLAIM_METERS + 0.1, z: 0 }])).toBeNull();
  });

  it("swaps only to a clearly closer bike, and never while using one", () => {
    expect(bikeToClaim(player, { id: "mine", distance: 1.2, busy: false }, [{ id: "x", x: 1.1, z: 0 }])).toBeNull();
    expect(bikeToClaim(player, { id: "mine", distance: 1.4, busy: false }, [{ id: "x", x: 0.6, z: 0 }])).toBe("x");
    expect(bikeToClaim(player, { id: "mine", distance: 1.4, busy: true }, [{ id: "x", x: 0.6, z: 0 }])).toBeNull();
  });

  it("hands an idle bike to a player standing clearly closer to it", () => {
    expect(shouldHandOver(1.2, { x: 0, z: 0 }, [{ x: 0.5, z: 0 }])).toBe(true);
    expect(shouldHandOver(1.2, { x: 0, z: 0 }, [{ x: 1.0, z: 0 }])).toBe(false);
    expect(shouldHandOver(2.5, { x: 0, z: 0 }, [{ x: 2, z: 0 }])).toBe(false);
  });
});
