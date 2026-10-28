import { describe, expect, it } from "vitest";
import { deathScreenFinished, healthAfterImpact, resetProgress, DEFAULT_SAVE } from "@/game/config";
import { createState, hitByVehicle, toSave } from "@/game/state";

describe("vehicle damage and death", () => {
  it("each distinct vehicle impact removes 20 percentage points", () => {
    const state = createState(DEFAULT_SAVE);
    for (let i = 1; i <= 5; i++) {
      hitByVehicle(state, i * 1500);
      expect(state.health).toBe(100 - i * 20);
    }
    expect(state.deathStartedAt).toBe(7500);
    expect(healthAfterImpact(0)).toBe(0);
  });
  it("does not deal repeated damage on adjacent collision frames", () => {
    const state = createState(DEFAULT_SAVE);
    hitByVehicle(state, 2000);
    expect(hitByVehicle(state, 2016)).toBe(false);
    expect(state.health).toBe(80);
  });
  it("the death screen lasts five real seconds", () => {
    expect(deathScreenFinished(1200, 6199)).toBe(false);
    expect(deathScreenFinished(1200, 6200)).toBe(true);
  });
  it("resets time and all saved progress with full health", () => {
    expect(resetProgress()).toMatchObject({ health: 100, elapsed: 0, pos: [0, 0.15, 18], rotY: 0, camYaw: 0 });
    const fresh = resetProgress();
    fresh.pos[0] = 999;
    expect(DEFAULT_SAVE.pos[0]).toBe(0);
  });
  it("persists remaining health with the other progress", () => {
    const state = createState({ ...DEFAULT_SAVE, health: 60 });
    expect(toSave(state).health).toBe(60);
  });
});
