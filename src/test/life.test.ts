import { describe, expect, it } from "vitest";
import { GUIDE, borrow, rentApartment, moveOut, dailyBills, deliveryPay, deposit, gainXp, levelOf, loanLimit, newLife, payslip, progressQuest, readLife, repay, rollQuests, withdraw } from "@/game/life";

describe("life: money", () => {
  it("moves cash in and out of the bank, never more than there is", () => {
    const life = newLife();
    let r = deposit(life, 50, 80, 1); expect(r.ok).toBe(true); expect(r.cash).toBe(0); expect(life.bank).toBe(350);
    r = withdraw(life, 0, 1000, 1); expect(r.cash).toBe(350); expect(life.bank).toBe(0);
    expect(life.ledger[0]!.amount).toBe(-350);
  });
  it("taxes pay at 10% and rewards work skill", () => {
    expect(payslip(100, 0)).toEqual({ gross: 100, tax: 10, net: 90 });
    expect(payslip(100, 2500).gross).toBeGreaterThan(100);
  });
  it("lends by credit score, charges interest daily and puts unpaid bills on the loan", () => {
    const life = newLife();
    const limit = loanLimit(life); expect(limit).toBeGreaterThan(0);
    expect(borrow(life, limit + 1000, 1)).toBe(true); expect(life.loan).toBe(limit);
    life.bank = 0;
    const before = life.credit;
    dailyBills(life, 2);
    expect(life.credit).toBeLessThan(before);
    expect(life.loan).toBeGreaterThan(limit);
    life.bank = 10000; expect(repay(life, 10000, 3)).toBe(true); expect(life.loan).toBe(0);
  });
  it("rents an apartment with the first week free, then charges the week's rent every seventh day", () => {
    const life = newLife(1);
    life.bank = 2000;
    expect(rentApartment(life, "56:-72", 9, 950, 1)).toBe("ok");
    expect(life.inventory).toContain("key");
    const bank = life.bank;
    dailyBills(life, 7);
    expect(life.bank).toBeGreaterThan(bank - 7 * 3 - 1);
    dailyBills(life, 8);
    expect(life.home?.nextRent).toBe(15);
    expect(life.ledger.some((t) => t.label.startsWith("Rent") && t.amount === -950)).toBe(true);
    moveOut(life, 9);
    expect(life.home).toBeNull();
    expect(life.inventory).not.toContain("key");
  });
});

describe("life: progress", () => {
  it("levels up with experience, a little slower each level", () => {
    expect(levelOf(0).level).toBe(1);
    const life = newLife();
    expect(gainXp(life, 120)).toBe(2);
    expect(levelOf(life.xp).level).toBe(2);
  });
  it("rolls three goals a day, the same for everyone that day, and finishes them", () => {
    expect(rollQuests(5)).toEqual(rollQuests(5));
    expect(rollQuests(5)).toHaveLength(3);
    const life = newLife();
    life.quests = [{ id: "walk", goal: 600, progress: 0, done: false, reward: 15 }];
    expect(progressQuest(life, "walk", 500)).toHaveLength(0);
    expect(progressQuest(life, "walk", 200)).toHaveLength(1);
    expect(GUIDE.length).toBeGreaterThan(3);
  });
  it("pays deliveries by distance, with a tip for speed", () => {
    const slow = deliveryPay("courier", 300, 600), fast = deliveryPay("courier", 300, 100);
    expect(slow.tip).toBe(0); expect(fast.tip).toBeGreaterThan(0); expect(fast.base).toBe(slow.base);
  });
  it("reads a broken save as a fresh life", () => {
    expect(readLife(null).bank).toBe(300);
    expect(readLife({ bank: "lots", credit: 9999 }).credit).toBe(850);
  });
});
