// Jobs while playing: starting one (from the phone), its stops, finishing and being paid.
import { generateCity, timeInfo } from "./config";
import { JOBS, deliveryPay, gainSkill, gainXp, levelOf, type JobId } from "./life";
import { lifeEvent, payJob } from "./lifeRuntime";
import { BUSK_SPOT, pickAddress } from "./places";
import { OUTSIDE, roomLayout, toWorld } from "./restaurantRoom";
import { shopPlaces } from "./shops";
import { toast, type GameState } from "./state";

/** How near (m) a stop must be to count as reached. */
export const STOP_REACH = 2.2;

export function canStart(state: GameState, id: JobId): string | null {
  const job = JOBS[id], { level } = levelOf(state.life.xp);
  if (level < job.minLevel) return `Needs level ${job.minLevel}`;
  if (state.job) return "Finish or quit your current job first";
  if (state.home) return "Go outside first";
  return null;
}

export function startJob(state: GameState, id: JobId): string | null {
  const why = canStart(state, id);
  if (why) return why;
  const random = Math.random, p = state.pos;
  if (id === "clerk") {
    const shop = shopPlaces(state.worldSeed).find((s) => s.kind === "grocery");
    if (!shop) return "No shop open";
    state.waypoint = { x: shop.door.x, z: shop.door.z, label: "Fresh Market" };
    toast(state, "Shop clerk", "info", "Go to Fresh Market, press E, then Work a shift.");
    return null;
  }
  if (id === "busker") {
    state.waypoint = { x: BUSK_SPOT.x, z: BUSK_SPOT.z, label: "Busking spot" };
    toast(state, "Street performer", "info", "Go to the busking spot in the park and press E to play.");
    return null;
  }
  let from: [number, number], label: string;
  if (id === "delivery") {
    // The nearest restaurant's door: the order waits there.
    const restaurants = generateCity(state.worldSeed, 0, 0).buildings.filter((b) => b.restaurant);
    const best = restaurants.map((b) => { const L = roomLayout(b); return toWorld(L.frame, OUTSIDE[0], OUTSIDE[1]); }).sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.z) - Math.hypot(b[0] - p.x, b[1] - p.z))[0];
    if (!best) return "No restaurant open";
    from = best; label = "Pick up the order at the restaurant";
  } else {
    const a = pickAddress(state.worldSeed, p.x, p.z, 30, 140, random);
    if (!a) return "No parcels right now";
    from = [a.x, a.z]; label = `Pick up the parcel at ${a.label}`;
  }
  const [min, max] = id === "delivery" ? [220, 520] : [120, 320];
  const to = pickAddress(state.worldSeed, from[0], from[1], min, max, random);
  if (!to) return "No addresses right now";
  state.job = { id, stage: "pickup", from, to: [to.x, to.z], label: to.label, startedAt: state.simulationTime, metres: Math.hypot(to.x - from[0], to.z - from[1]) };
  state.waypoint = { x: from[0], z: from[1], label };
  toast(state, JOBS[id].name, "info", label);
  return null;
}

export function quitJob(state: GameState) {
  if (state.busking) stopBusking(state);
  state.job = null; state.waypoint = null;
  toast(state, "Job cancelled", "warn");
}

/** At a stop with E: collect, or deliver and be paid. True if the press was used. */
export function jobInteract(state: GameState): boolean {
  const job = state.job;
  if (!job) return false;
  const p = state.pos, stop = job.stage === "pickup" ? job.from : job.to;
  if (Math.hypot(stop[0] - p.x, stop[1] - p.z) > STOP_REACH) return false;
  if (JOBS[job.id].needsBike && job.stage === "deliver" && !state.scooter.riding && Math.hypot(state.scooter.pos.x - p.x, state.scooter.pos.z - p.z) > 12) {
    toast(state, "Use your bike", "warn", "Bike deliveries are made by bike.");
  }
  if (job.stage === "pickup") {
    job.stage = "deliver"; job.startedAt = state.simulationTime;
    state.waypoint = { x: job.to[0], z: job.to[1], label: `Deliver to ${job.label}` };
    toast(state, job.id === "delivery" ? "Order collected" : "Parcel collected", "info", `Deliver to ${job.label} (${Math.round(job.metres)} m)`);
    return true;
  }
  const pay = deliveryPay(job.id, job.metres, state.simulationTime - job.startedAt);
  payJob(state, job.id, JOBS[job.id].name, pay.base, pay.tip);
  state.job = null; state.waypoint = null;
  return true;
}

// ---------- busking ----------
export function nearBuskSpot(state: GameState) { return Math.hypot(state.pos.x - BUSK_SPOT.x, state.pos.z - BUSK_SPOT.z) < BUSK_SPOT.r + 0.6; }
export function startBusking(state: GameState) {
  state.busking = { since: state.simulationTime, tips: 0, nextTip: state.simulationTime + 5 };
  state.keys.clear();
  if (state.waypoint?.label === "Busking spot") state.waypoint = null;
  toast(state, "Playing", "info", "People walking by may tip you. Move or press E to stop.");
}
export function stopBusking(state: GameState) {
  const b = state.busking;
  state.busking = null; state.foodScript = null;
  if (!b) return;
  if (b.tips > 0) {
    const day = timeInfo(state.elapsed).day, life = state.life;
    life.ledger.unshift({ day, label: "Busking tips (cash)", amount: Math.round(b.tips * 100) / 100 });
    life.earned += b.tips; life.jobsDone += 1;
    const up = gainXp(life, 15 + Math.round(b.tips * 2));
    if (up) toast(state, `Level ${up}!`, "level");
    gainSkill(life, "charm", 10 + b.tips * 2);
    lifeEvent(state, "work", 1); lifeEvent(state, "earn", b.tips);
  }
  toast(state, `Stopped playing`, "money", b.tips > 0 ? `You made $${b.tips.toFixed(2)} in tips.` : "No tips this time. Try when people are about.");
}
