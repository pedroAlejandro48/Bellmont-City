import { describe, expect, it } from "vitest";
import { DEFAULT_SAVE } from "@/game/config";
import { floorY } from "@/game/apartments";
import { readSave } from "@/game/saves";
import { createState, toSave } from "@/game/state";

describe("saving up in an apartment building", () => {
  it("comes back on the same floor, inside the building", () => {
    const s = createState(DEFAULT_SAVE);
    s.level = { building: "10:20", floor: 7, y: floorY(7) };
    s.interior = { key: "10:20#7", phase: "inside", startedAt: 0, from: [0, 0], fromYaw: 0, outside: [4, 5], outsideYaw: 1, cameraSet: true };
    s.pos.set(12, floorY(7), 30); s.rotY = 0.5;
    const save = readSave(JSON.parse(JSON.stringify(toSave(s))));
    expect(save.apt).toEqual({ building: "10:20", floor: 7, x: 12, z: 30, yaw: 0.5, outside: [4, 5], outsideYaw: 1 });
    const back = createState(save);
    expect(back.level).toEqual({ building: "10:20", floor: 7, y: floorY(7) });
    expect(back.interior?.key).toBe("10:20#7");
    expect(back.interior?.phase).toBe("inside");
    expect([back.pos.x, back.pos.y, back.pos.z]).toEqual([12, floorY(7), 30]);
  });
  it("in the lobby or outside, nothing is kept", () => {
    const s = createState(DEFAULT_SAVE);
    expect(toSave(s).apt).toBeNull();
    expect(readSave({ apt: { building: "1:2", floor: 1, x: 0, z: 0, outside: [0, 0] } }).apt).toBeNull();
  });
});
