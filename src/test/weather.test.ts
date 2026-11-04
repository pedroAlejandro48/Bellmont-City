import { describe, expect, it } from "vitest";
import { SPELL, spellKind, weatherAt } from "@/game/weather";

describe("weather", () => {
  it("is the same for everyone with the same seed and clock", () => {
    expect(weatherAt(12345, 7)).toEqual(weatherAt(12345, 7));
  });
  it("starts clear and has every kind over time", () => {
    expect(weatherAt(10, 1).kind).toBe("clear");
    const kinds = new Set(Array.from({ length: 200 }, (_, i) => spellKind(1, i + 1)));
    expect(kinds).toEqual(new Set(["clear", "cloudy", "rain", "fog"]));
  });
  it("fades smoothly between spells", () => {
    let spell = 1; while (!(spellKind(3, spell) === "clear" && spellKind(3, spell + 1) === "rain")) spell++;
    const at = (s: number) => weatherAt(spell * SPELL + s, 3).rain;
    expect(at(100)).toBe(0); expect(at(SPELL - 45)).toBeCloseTo(0.5, 1); expect(at(SPELL - 0.001)).toBeCloseTo(1, 2);
    for (let s = SPELL - 90; s < SPELL; s += 5) expect(Math.abs(at(s + 5) - at(s))).toBeLessThan(0.2);
  });
});
