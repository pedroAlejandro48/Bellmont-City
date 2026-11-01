// Restaurant front doors shared by everyone (pure, testable). Each leaf works one way: the right one is pulled
// open going in, the left one pushed open coming out. Whoever presses E at a closed leaf opens it; anyone else
// who presses E before it starts closing just walks through behind them; it closes once the last of them is
// through, and someone pressing E while it closes waits until it is shut, then opens it again.
import { ENTER, LEAVE } from "./restaurantRoom";

export type Leaf = "left" | "right";
/** One person using a leaf: from `start` (seconds, this player's clock), `lead` seconds walking up first, through at `start + pass`. */
export type DoorUse = { key: string; leaf: Leaf; mode: "open" | "follow"; start: number; lead: number; pass: number };
export type DoorPhase = "closed" | "opening" | "open" | "closing";

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
const seg = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
/** How long each leaf takes to swing shut. */
export const CLOSING: Record<Leaf, number> = { right: ENTER.close[1] - ENTER.close[0], left: LEAVE.close[1] - LEAVE.close[0] };
/** When the opener is through (so the leaf may start closing), after their walk up. */
export const OPENER_PASS: Record<Leaf, number> = { right: ENTER.close[0], left: LEAVE.close[0] };
/** When the leaf is fully open, after the opener's walk up. */
const WIDE: Record<Leaf, number> = { right: ENTER.release + 0.8, left: LEAVE.push[1] + 0.6 };

/** How far open (degrees) the opener has the leaf `t` seconds after their walk up. */
export function openDegrees(leaf: Leaf, t: number) {
  if (leaf === "right") return t < ENTER.release ? 35 * seg(t, ENTER.open, ENTER.release) : 35 + 65 * Math.sin(Math.PI / 2 * clamp01((t - ENTER.release) / 0.8));
  const pushed = seg(t, LEAVE.push[0], LEAVE.push[1]), coast = clamp01((t - LEAVE.push[1]) / 0.6);
  return 70 * pushed + 25 * Math.sin(Math.PI / 2 * coast);
}

/** A leaf right now, from everyone's uses of it: how open (radians) and what it is doing. */
export function doorState(uses: readonly DoorUse[], now: number): { angle: number; phase: DoorPhase; closesAt: number; closedAt: number } {
  let opener: DoorUse | null = null;
  for (const u of uses) if (u.mode === "open" && u.start <= now && (!opener || u.start > opener.start)) opener = u;
  if (!opener) return { angle: 0, phase: "closed", closesAt: -Infinity, closedAt: -Infinity };
  const o = opener;
  let closesAt = o.start + o.pass;
  for (const u of uses) if (u !== o && u.start >= o.start && u.start <= now) closesAt = Math.max(closesAt, u.start + u.pass);
  const closedAt = closesAt + CLOSING[o.leaf];
  if (now >= closedAt) return { angle: 0, phase: "closed", closesAt, closedAt };
  const t = now - o.start - o.lead;
  const angle = openDegrees(o.leaf, t) * (1 - seg(now, closesAt, closedAt)) * Math.PI / 180;
  return { angle, phase: now >= closesAt ? "closing" : t < WIDE[o.leaf] ? "opening" : "open", closesAt, closedAt };
}

/** How the doors are shared in a room: this player's current use, and everyone else's (null playing alone). */
export type DoorLink = {
  publish: (use: DoorUse) => void;
  /** Others' uses, with `start` on this player's clock (`now`, seconds). */
  others: (now: number) => DoorUse[];
};
