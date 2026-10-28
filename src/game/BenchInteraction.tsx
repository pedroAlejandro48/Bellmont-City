import { useFrame } from "@react-three/fiber";
import { BENCH_SEATS, BENCH_SIT_SECONDS, BENCH_STAND_SECONDS, nearestBenchSeat, canInteractScooter } from "./config";
import type { GameState } from "./state";
import { InteractionPrompt } from "./InteractionPrompt";

export function BenchInteraction({ state }: { state: GameState }) {
  const pickupNearby = () => state.scooter.fallen && canInteractScooter([state.pos.x, state.pos.z], [state.scooter.pos.x, state.scooter.pos.z], state.scooter.yaw, true, state.scooter.fallSide);
  const candidate = () => state.bench ? BENCH_SEATS[state.bench.seat] ?? null : nearestBenchSeat(state.pos.x, state.pos.z, state.seatOccupants);
  useFrame(() => {
    const bench = state.bench, now = state.simulationTime;
    if (bench?.phase === "sit" && now - bench.startedAt >= BENCH_SIT_SECONDS) bench.phase = "seated";
    if (bench?.phase === "stand" && now - bench.startedAt >= BENCH_STAND_SECONDS) { state.seatOccupants.delete(bench.seat); state.bench = null; }
    if (!state.interactQueued) return;
    state.interactQueued = false;
    if (state.accident || state.health <= 0) return;
    if (state.bench) {
      if (state.bench.phase === "seated") { state.bench.phase = "stand"; state.bench.startedAt = now; }
      return;
    }
    if (state.scooter.riding || state.scooter.action) { state.scooter.interactQueued = true; return; }
    if (pickupNearby()) { state.scooter.interactQueued = true; return; }
    const seat = candidate();
    if (seat) {
      // Claim synchronously before animation; never steal an occupied seat.
      if (state.seatOccupants.has(seat.id)) return;
      state.seatOccupants.set(seat.id, "player");
      state.bench = { seat: seat.id, phase: "sit", startedAt: now, origin: state.pos.clone(), originYaw: state.rotY };
      state.keys.clear(); state.jumpQueued = false;
    } else if (canInteractScooter([state.pos.x, state.pos.z], [state.scooter.pos.x, state.scooter.pos.z], state.scooter.yaw, state.scooter.fallen, state.scooter.fallSide)) state.scooter.interactQueued = true;
  }, -0.5);
  return <InteractionPrompt sample={() => {
    const seat = !state.bench && pickupNearby() ? null : candidate();
    return { visible: !!seat && !state.scooter.riding && !state.scooter.action && !state.accident && state.health > 0 && (!state.bench || state.bench.phase === "seated"), x: seat?.x ?? 0, y: 1.6, z: seat?.z ?? 0, time: state.simulationTime };
  }} />;
}