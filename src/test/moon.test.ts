import { describe, expect, it } from "vitest";
import { ROUNDS, blushFor, choices, moonFor, newMoonBond, readMoonBond, say, stageOf, startTalk } from "@/game/moon";

const r = () => 0.3;
describe("flirting with the moon", () => {
  it("a woman's moon is a man; a man's (or a guest's) a woman", () => {
    expect(moonFor("female")).toMatchObject({ name: "Lucio", she: false });
    expect(moonFor("male")).toMatchObject({ name: "Luna", she: true });
    expect(moonFor(null).she).toBe(true);
    expect(choices("female", r).some((c) => c.text.includes("beautiful"))).toBe(false);
  });
  it("never blushes at first; blushes once she's fond of you", () => {
    expect(blushFor(0, "blush")).toBe(0); expect(blushFor(30, "smile")).toBe(0);
    expect(blushFor(60, "blush")).toBeGreaterThan(0.5); expect(blushFor(95, "neutral")).toBeGreaterThan(0.4);
  });
  it("sweet words warm her up over the nights; rudeness cools her; boldness too soon puts her off", () => {
    let b = newMoonBond();
    for (let night = 1; night <= 12; night++) {
      b = startTalk(b, night);
      for (let i = 0; i < ROUNDS; i++) { b = { ...say(b, { kind: "poetic", text: "" }, r).bond, talkedTonight: b.talkedTonight + 1 }; }
    }
    expect(stageOf(b.affection)).toBe("smitten"); expect(b.nights).toBe(12);
    expect(say(newMoonBond(), { kind: "bold", text: "" }, r)).toMatchObject({ mood: "annoyed" });
    expect(say({ ...newMoonBond(), affection: 80 }, { kind: "bold", text: "" }, r).mood).toBe("blush");
    expect(say({ ...newMoonBond(), affection: 50 }, { kind: "rude", text: "" }, r).bond.affection).toBeLessThan(50);
    expect(readMoonBond({ affection: 300, nights: 2 })).toMatchObject({ affection: 100, nights: 2 });
  });
});
