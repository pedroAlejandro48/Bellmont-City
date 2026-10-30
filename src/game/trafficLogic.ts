import { TRAFFIC_FOLLOW_GAP, brakingGap, forwardDistance, queueMayResume, roadForward, sameRoad, VEHICLE_SIZE, type RoadPath, type VehicleKind } from "./config";
import type { RoadIncident } from "./state";

export type TrafficAgent = RoadPath & { id: number; kind: VehicleKind; x: number; z: number; vx: number; vz: number; speed: number; heldBy: number | null; crashUntil: number; brake: boolean };
export function holdAccidentQueue(vehicles: TrafficAgent[], source: TrafficAgent, incident: RoadIncident) {
  for (const vehicle of vehicles) {
    if (vehicle.id !== source.id && sameRoad(vehicle, source) && forwardDistance(source, [vehicle.x, vehicle.z], incident.origin) > 0) vehicle.heldBy = source.id;
  }
}
export function trafficTargetSpeed(vehicle: TrafficAgent, all: TrafficAgent[], incidents: RoadIncident[], now: number) {
  if (now < vehicle.crashUntil) return 0;
  let hold: RoadIncident | undefined;
  if (vehicle.heldBy !== null) for (let i = incidents.length - 1; i >= 0; i--) {
    const incident = incidents[i];
    if (incident?.vehicleId === vehicle.heldBy) { hold = incident; break; }
  }
  if (hold && !queueMayResume(hold.stoodUpAt, now) && !(hold.scooterCrash && now - hold.startedAt >= 15 && hold.stoodUpAt !== null)) return 0;
  if (hold) vehicle.heldBy = null;
  let target = vehicle.speed;
  const [fx, fz] = roadForward(vehicle);
  for (const other of all) {
    if (other.id === vehicle.id) continue;
    const dx = other.x - vehicle.x; const dz = other.z - vehicle.z;
    const ahead = dx * fx + dz * fz;
    const lateral = Math.abs(dx * fz - dz * fx);
    const halfOther = other.axis === vehicle.axis ? VEHICLE_SIZE[other.kind][0] / 2 : VEHICLE_SIZE[other.kind][2] / 2;
    const crossOther = other.axis === vehicle.axis ? VEHICLE_SIZE[other.kind][2] / 2 : VEHICLE_SIZE[other.kind][0] / 2;
    const gap = ahead - VEHICLE_SIZE[vehicle.kind][0] / 2 - halfOther;
    if (ahead > 0 && lateral < VEHICLE_SIZE[vehicle.kind][2] / 2 + crossOther + 0.4 && gap < brakingGap(Math.hypot(vehicle.vx, vehicle.vz))) {
      const leaderSpeed = Math.max(0, other.vx * fx + other.vz * fz);
      target = Math.min(target, gap < TRAFFIC_FOLLOW_GAP ? 0 : leaderSpeed + Math.max(0, gap - TRAFFIC_FOLLOW_GAP) * 0.5);
    }
    // Yield predictively at crossings, using stable ID priority to avoid deadlock.
    if (other.axis !== vehicle.axis && vehicle.id > other.id) {
      const rvx = vehicle.vx - other.vx; const rvz = vehicle.vz - other.vz;
      const relativeSpeed2 = rvx * rvx + rvz * rvz;
      const closestTime = relativeSpeed2 > 0.1 ? (dx * rvx + dz * rvz) / relativeSpeed2 : -1;
      if (closestTime > 0 && closestTime < 2 && Math.hypot(dx - rvx * closestTime, dz - rvz * closestTime) < (VEHICLE_SIZE[vehicle.kind][0] + VEHICLE_SIZE[other.kind][0]) / 2 + 1) target = 0;
    }
  }
  return Math.max(0, target);
}