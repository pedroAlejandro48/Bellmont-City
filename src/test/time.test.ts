import { describe, expect, it } from "vitest";
import { timeInfo } from "@/game/config";

describe("day/night cycle", () => {
  it("daytime lasts 10 minutes", () => {
    expect(timeInfo(599).isDay).toBe(true);
    expect(timeInfo(601).isDay).toBe(false);
  });
  it("night lasts 10 minutes then a new day starts", () => {
    expect(timeInfo(1199).isDay).toBe(false);
    expect(timeInfo(1201).isDay).toBe(true);
    expect(timeInfo(1201).day).toBe(2);
  });
  it("starts on day 1", () => {
    expect(timeInfo(0).day).toBe(1);
  });
  it("smoothly blends all lighting across sunset and sunrise", () => {
    for (const horizon of [600, 1200]) {
      expect(Math.abs(timeInfo(horizon - 0.01).darkness - timeInfo(horizon + 0.01).darkness)).toBeLessThan(0.001);
    }
    expect(timeInfo(300).darkness).toBe(0); expect(timeInfo(900).darkness).toBe(1);
    expect(timeInfo(580).darkness).toBeLessThan(timeInfo(620).darkness);
    expect(timeInfo(1180).darkness).toBeGreaterThan(timeInfo(1220).darkness);
  });
});
