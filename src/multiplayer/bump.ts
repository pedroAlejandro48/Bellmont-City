import type { OtherBody } from "@/game/state";

/** How fast a player is eased away from someone leaning into them (m/s): a slow shove, never a launch. */
export const PUSH_SPEED = 0.9;
/** Bodies may squash to this share of their combined radius before they block outright. */
export const SQUASH = 0.85;

/**
 * Keeps one player (moved in place) out of other players' bodies. Inside full contact the player is
 * eased apart at PUSH_SPEED; closer than the squash limit they are blocked. Each computer moves only its
 * own player, so when one person walks into another, the other's computer eases them aside: they bump
 * and shove each other slowly without ever overlapping.
 */
export function bumpOthers(p: { x: number; z: number }, others: readonly OtherBody[], radius: number, dt: number) {
  for (const o of others) {
    let dx = p.x - o.x, dz = p.z - o.z;
    let d = Math.hypot(dx, dz);
    const contact = radius + o.r;
    if (d >= contact) continue;
    if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
    const target = Math.min(contact, Math.max(Math.hypot(p.x - o.x, p.z - o.z), contact * SQUASH) + PUSH_SPEED * dt);
    p.x = o.x + (dx / d) * target;
    p.z = o.z + (dz / d) * target;
  }
}
