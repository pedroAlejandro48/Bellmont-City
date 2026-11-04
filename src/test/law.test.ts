import { describe, expect, it } from "vitest";
import { GAME_MINUTE, MPH_TO_MPS, SIGNAL, SIGNALLED, signalState } from "@/game/config";
import { addFine, dailyBills, finesOwed, loanLimit, newLife, payFines, spend, FINE_DAYS } from "@/game/life";
import { SPEEDING_HOLD, TICKET_COOLDOWN, intersectionAt, newWatch, watchRider } from "@/game/law";

describe("traffic law", () => {
  it("tickets speeding only when held over the limit", () => {
    const w = newWatch(), v = 40 * MPH_TO_MPS;
    let t = null as ReturnType<typeof watchRider>;
    for (let s = 0; s < SPEEDING_HOLD - 0.2; s += 0.1) t = watchRider(w, s, 0.1, 500, 500, v, 0, 0) ?? t;
    expect(t).toBeNull();
    for (let s = 0; s < 0.5; s += 0.1) t = watchRider(w, 2 + s, 0.1, 500, 500, v, 0, 0) ?? t;
    expect(t?.kind).toBe("speeding");
    expect(watchRider(w, 3, 2, 500, 500, v, 0, 0)).toBeNull(); // cooldown
    expect(watchRider(newWatch(), 0, 5, 500, 500, 30 * MPH_TO_MPS, 0, 0)).toBeNull(); // at the limit: fine
    expect(TICKET_COOLDOWN).toBeGreaterThan(10);
  });
  it("tickets entering a signalled intersection on red, not on green", () => {
    const [ix, iz] = SIGNALLED[0]!;
    expect(intersectionAt(ix, iz)).toBe(0);
    const redX = (SIGNAL.green + SIGNAL.yellow + 1) * GAME_MINUTE;
    expect(signalState("x", redX)).toBe("red");
    const w = newWatch();
    watchRider(w, 0, 0.1, ix - 30, iz, 8, 0, redX);
    expect(watchRider(w, 0.1, 0.1, ix, iz, 8, 0, redX)?.kind).toBe("redLight");
    const g = newWatch();
    watchRider(g, 0, 0.1, ix - 30, iz, 8, 0, 1);
    expect(watchRider(g, 0.1, 0.1, ix, iz, 8, 0, 1)).toBeNull();
  });
});

describe("fines and spending", () => {
  it("pays fines from the bank, and overdue ones go on the loan and the record", () => {
    const life = newLife(1);
    addFine(life, 1, "Speeding", 35); addFine(life, 1, "Red light", 50);
    expect(finesOwed(life)).toBe(85);
    const limit = loanLimit(life);
    dailyBills(life, 1 + FINE_DAYS);
    expect(life.fines).toHaveLength(0);
    expect(life.record).toBe(2);
    expect(life.loan).toBeGreaterThanOrEqual(85 * 1.25);
    expect(loanLimit(life)).toBeLessThan(limit);
    const l2 = newLife(1); addFine(l2, 1, "Speeding", 35);
    expect(payFines(l2, 1)).toBe(true); expect(l2.bank).toBe(265);
  });
  it("spends cash first, then the card", () => {
    const life = newLife(1);
    expect(spend(life, 10, 25, 1, "Shop")).toEqual({ ok: true, cash: 0 });
    expect(life.bank).toBe(285);
    expect(spend(life, 0, 1000, 1, "Shop").ok).toBe(false);
  });
});
