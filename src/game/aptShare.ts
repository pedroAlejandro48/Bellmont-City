// An apartment's kitchen shared by everyone in it (a room): what's in the cupboard, on the counter, in the sink, on
// the stove, on the table, and in the fridge. (What's in each player's hands is their own.) Whoever changes
// something publishes the whole lot with a number one higher; everyone else there — and the tenant, wherever they
// are — takes the highest-numbered one. The tenant's copy is the one that's saved (it's their life.kitchen/fridge).
import { newKitchen, readKitchen, type Kitchen } from "./kitchen";
import type { GameState } from "./state";

/** (`j`: the shared things as JSON text — one value, so nothing in it is lost on the way.) */
export type AptDoc = { key: string; n: number; j: string };
type Shared = { k: Pick<Kitchen, "cupboard" | "rack" | "sink" | "stoves" | "table">; fridge: string[] };
const parse = (j: string): Shared | null => { try { const v = JSON.parse(j) as Shared; return v && typeof v === "object" && v.k && Array.isArray(v.fridge) ? v : null; } catch { return null; } };
const homeKey = (s: GameState) => (s.life.home ? `${s.life.home.building}#${s.life.home.floor}` : null);

/** The kitchen (and fridge) of the apartment on floor `key`, if it's yours or you're a guest in it. */
export function kitchenAt(s: GameState, key: string): Kitchen | null { return homeKey(s) === key ? s.life.kitchen : s.aptHere?.key === key ? s.aptHere.kitchen : null; }
export function fridgeAt(s: GameState, key: string): string[] | null { return homeKey(s) === key ? s.life.fridge : s.aptHere?.key === key ? s.aptHere.fridge : null; }
/** The kitchen and fridge where you are: the apartment you're a guest in, else your own. */
export const kitchenOf = (s: GameState): Kitchen => s.aptHere?.kitchen ?? s.life.kitchen;
export const fridgeOf = (s: GameState): string[] => s.aptHere?.fridge ?? s.life.fridge;
/** Nothing (for drawing a floor that's nobody's you know). */
export const NO_KITCHEN = newKitchen();

const shared = (k: Kitchen, fridge: string[]) => ({ k: { cupboard: k.cupboard, rack: k.rack, sink: k.sink, stoves: k.stoves, table: k.table }, fridge });

export class AptShare {
  private own = { n: 1, json: "" };
  private guest = { key: "", n: 0, json: "" };
  private linger: (AptDoc & { until: number }) | null = null;
  private timer = 0;
  /** Each frame. `guestKey`: the floor you're on if it's another player's apartment; `busy`: in the middle of a
   * kitchen move (nothing is taken from the others until it's done). */
  step(s: GameState, dt: number, now: number, guestKey: string | null, busy: boolean) {
    const link = s.liftLink;
    if (!link) { s.aptHere = null; return; }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const remote = link.apts();
    const best = (key: string) => remote.filter((d) => d.key === key && parse(d.j)).sort((a, b) => b.n - a.n || (b.j > a.j ? 1 : -1))[0];
    const docs: AptDoc[] = [];
    // Your own apartment (wherever you are): others' changes come home; yours go out.
    const hk = homeKey(s);
    if (hk) {
      const r = best(hk), mine = JSON.stringify(shared(s.life.kitchen, s.life.fridge));
      if (this.own.json === "") this.own.json = mine;
      const rj = r ? r.j : "", rv = r ? parse(r.j) : null;
      // (What you've just changed yourself goes out first, over anything that came meanwhile.)
      if (mine !== this.own.json) this.own = { n: Math.max(this.own.n, r?.n ?? 0) + 1, json: mine };
      else if (r && rv && !busy && (r.n > this.own.n || (r.n === this.own.n && rj > mine))) {
        const k = readKitchen({ ...rv.k, hands: s.life.kitchen.hands });
        Object.assign(s.life.kitchen, { cupboard: k.cupboard, rack: k.rack, sink: k.sink, stoves: k.stoves, table: k.table });
        s.life.fridge = rv.fridge.filter((x) => typeof x === "string").slice(0, 40);
        this.own = { n: r.n, json: JSON.stringify(shared(s.life.kitchen, s.life.fridge)) };
      }
      docs.push({ key: hk, n: this.own.n, j: this.own.json });
    } else this.own = { n: 1, json: "" };
    // Someone else's apartment you're in: theirs as last published, and your changes to it.
    if (guestKey && guestKey !== hk) {
      if (this.guest.key !== guestKey) { this.guest = { key: guestKey, n: 0, json: "" }; s.aptHere = null; }
      const r = best(guestKey), here = s.aptHere, mine = here ? JSON.stringify(shared(here.kitchen, here.fridge)) : "";
      const rj = r ? r.j : "", rv = r ? parse(r.j) : null;
      if (here && mine !== this.guest.json) this.guest = { key: guestKey, n: Math.max(this.guest.n, r?.n ?? 0) + 1, json: mine };
      else if (r && rv && !busy && (!here || r.n > this.guest.n || (r.n === this.guest.n && rj > mine))) {
        const k = readKitchen({ ...rv.k, hands: null });
        k.hands = s.life.kitchen.hands;
        s.aptHere = { key: guestKey, kitchen: k, fridge: rv.fridge.filter((x) => typeof x === "string").slice(0, 40) };
        this.guest = { key: guestKey, n: r.n, json: JSON.stringify(shared(k, s.aptHere.fridge)) };
      }
      if (s.aptHere) { s.aptHere.kitchen.hands = s.life.kitchen.hands; docs.push({ key: guestKey, n: this.guest.n, j: this.guest.json }); }
    } else {
      // Gone from it: what you last did there stays published a few seconds (so it isn't lost).
      if (s.aptHere && this.guest.json) this.linger = { key: this.guest.key, n: this.guest.n, j: this.guest.json, until: now + 6 };
      s.aptHere = null; this.guest = { key: "", n: 0, json: "" };
    }
    if (this.linger && now < this.linger.until && !docs.some((d) => d.key === this.linger!.key)) { const { until: _u, ...d } = this.linger; void _u; docs.push(d); }
    else if (this.linger && now >= this.linger.until) this.linger = null;
    link.setApts(docs);
  }
}
