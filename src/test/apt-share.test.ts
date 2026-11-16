import { describe, expect, it } from "vitest";
import { AptShare, fridgeOf, kitchenOf, type AptDoc } from "../game/aptShare";
import { DEFAULT_SAVE } from "../game/config";
import { createState, type GameState, type LiftLink } from "../game/state";

/** Two players' links: each sees the other's published apartments. */
function pair(): [LiftLink, LiftLink] {
  const docs: AptDoc[][] = [[], []];
  const mk = (me: number): LiftLink => ({
    isHost: () => me === 0, publish: () => {}, latest: () => null, request: () => {}, takeRequests: () => [], setMe: () => {}, others: () => [], setHome: () => {}, homes: () => [],
    setApts: (d) => { docs[me] = JSON.parse(JSON.stringify(d)); }, apts: () => docs[1 - me]!,
  });
  return [mk(0), mk(1)];
}
const KEY = "10:20#7";
function setup() {
  const owner = createState(DEFAULT_SAVE), guest = createState(DEFAULT_SAVE), [la, lb] = pair();
  owner.liftLink = la; guest.liftLink = lb;
  owner.life.home = { kind: "apartment", building: "10:20", floor: 7, since: 1, nextRent: 8, weekly: 900 };
  owner.life.kitchen.rack = ["plate", "silverware"]; owner.life.fridge = ["Canned Beans"];
  const a = new AptShare(), b = new AptShare();
  let now = 0;
  const run = (n = 4, busy = false) => { for (let i = 0; i < n; i++) { now += 0.3; a.step(owner, 0.3, now, null, false); b.step(guest, 0.3, now, KEY, busy); } };
  return { owner, guest, run };
}
const plate = (s: GameState) => kitchenOf(s).table;

describe("an apartment's kitchen shared with guests", () => {
  it("a guest sees the tenant's kitchen and fridge, with their own hands", () => {
    const { owner, guest, run } = setup(); run();
    expect(guest.aptHere?.key).toBe(KEY);
    expect(kitchenOf(guest).rack).toEqual(["plate", "silverware"]);
    expect(fridgeOf(guest)).toEqual(["Canned Beans"]);
    expect(kitchenOf(guest).hands).toBe(guest.life.kitchen.hands);
    expect(kitchenOf(owner)).toBe(owner.life.kitchen);
  });
  it("what a guest does shows for the tenant (and is theirs to keep), and the other way round", () => {
    const { owner, guest, run } = setup(); run();
    // The guest takes the plate, and later puts a meal on the table.
    kitchenOf(guest).rack.splice(0, 1); run();
    expect(owner.life.kitchen.rack).toEqual(["silverware"]);
    plate(guest).push({ chair: 1, ware: "plate", cans: ["bakedBeans"], eaten: false, silver: false }); run();
    expect(owner.life.kitchen.table).toHaveLength(1);
    // The tenant sits down in front of it and eats it.
    owner.life.kitchen.table[0]!.eaten = true; run();
    expect(plate(guest)[0]!.eaten).toBe(true);
    // The tenant cooks with a can: gone from the fridge for both.
    owner.life.fridge.splice(0, 1); run();
    expect(fridgeOf(guest)).toEqual([]);
  });
  it("nothing is taken from the others in the middle of a move; one's own change then stands", () => {
    const { owner, guest, run } = setup(); run();
    owner.life.kitchen.rack.push("cup"); run(4, true);
    expect(kitchenOf(guest).rack).toEqual(["plate", "silverware"]);
    kitchenOf(guest).sink.push("plate"); run();
    expect(owner.life.kitchen.sink).toEqual(["plate"]);
  });
});
