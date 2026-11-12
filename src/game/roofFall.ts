// Falling (from a roof, down its hatch): a tenth of your health for a storey's height (3.5 m), and down you go —
// a plain crumple (no flinging), then up again the way you get up after a bike crash; a fall off the top of a
// building is more than anyone's health.
import { toast, type GameState } from "./state";

export const FALL_STOREY = 3.5;
export const fallDamage = (drop: number) => Math.round(10 * drop / FALL_STOREY);
/** Hurt by a fall of `drop` metres, and knocked down where you landed (from `fromY`: the body falls from there). */
export function fallHurt(state: GameState, drop: number, fromY?: number) {
  if (state.health <= 0 || state.accident) return;
  state.keys.clear(); state.jumpQueued = false;
  state.health = Math.max(0, state.health - fallDamage(drop));
  if (state.health === 0) { state.deathStartedAt = performance.now(); }
  const yaw = state.rotY;
  state.accident = { phase: "down", startedAt: state.simulationTime, riseStartedAt: null, vehicleId: null, direction: [Math.sin(yaw), Math.cos(yaw)], launchSpeed: 0, seed: Math.floor(Math.random() * 1e9), gentle: true, ...(fromY !== undefined ? { fromY } : {}) };
  if (state.health > 0) toast(state, "Ouch", "warn", `You fell ${drop < 5 ? "through the hatch" : `${Math.round(drop)} m`} (−${fallDamage(drop)} health).`);
}
