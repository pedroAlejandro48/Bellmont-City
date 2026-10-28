import { describe, it, expect } from "vitest";
import { mergeSave, newerBackup, readSave } from "@/game/saves";
import { DEFAULT_SAVE } from "@/game/config";

describe("save update compatibility", () => {
  it("keeps player progress when new fields are missing", () => {
    const save = readSave({ elapsed: 1512, pos: [52, 0.15, 17], rotY: 2 });
    expect(save.elapsed).toBe(1512);
    expect(save.pos).toEqual([52, 0.15, 17]);
    expect(save.health).toBe(100);
  });
  it("preserves fields not understood by the current game version", () => {
    expect(mergeSave({ inventory: ["key"], coins: 48, elapsed: 900 }, { ...DEFAULT_SAVE, elapsed: 1512 })).toMatchObject({ inventory: ["key"], coins: 48, elapsed: 1512 });
  });
  it("rejects invalid positions and non-finite time", () => {
    expect(readSave({ pos: [1, "bad", 3], elapsed: Infinity })).toEqual(DEFAULT_SAVE);
  });
  it("recovers only a backup newer than the cloud save, even after death resets time", () => {
    const backup = { data: { elapsed: 0, health: 100 }, updated_at: "2026-10-26T22:00:01Z" };
    expect(newerBackup(backup, "2026-10-26T22:00:00Z")).toEqual(backup);
    expect(newerBackup(backup, "2026-10-26T22:00:02Z")).toBeNull();
  });
});