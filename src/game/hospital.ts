// The hospital's treatment round (pure), in the hospital room's own frame. A player asks to be treated at the desk
// and waits (sitting, or not); in the order they asked, the nurse comes for each: out of the treatment room (she
// opens its door), over to the patient, back in with the patient following, the door shut behind them. Inside the
// patient sits on the bed for TREAT seconds (three in-game minutes) while their health comes back, then walks out,
// opening the door, which shuts behind them; the nurse goes back to her place.
//
// Everything about a round follows from when it started and where the patient was then, so every player in a room
// works out the same nurse, the same door and the same walk from those two (sent in presence).
import { GAME_MINUTE } from "./config";
import type { HospitalWard } from "./venueRoom";

export const TREAT = 3 * GAME_MINUTE;
const V = 1.25, DOOR = 0.9, MEET = 1.0, SIT = 0.9, FOLLOW = 1.1;
type P2 = [number, number];
const dist = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = (a: P2, b: P2, k: number): P2 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** A path (points) walked at V: where along it `t` seconds in, which way it faces, and whether still walking. */
function along(path: P2[], t: number): { at: P2; yaw: number; walking: boolean } {
  let left = Math.max(0, t) * V;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!, d = dist(a, b);
    if (d < 1e-6) continue;
    if (left <= d) return { at: lerp(a, b, left / d), yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), walking: true };
    left -= d;
  }
  const n = path.length, a = path[Math.max(0, n - 2)]!, b = path[n - 1]!;
  return { at: b, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), walking: false };
}
const length = (path: P2[]) => path.slice(1).reduce((s, p, i) => s + dist(path[i]!, p), 0);

/** The places a round uses: either side of the door, the bed's edge and the spot in front of it, the nurse's. */
export function wardPoints(w: HospitalWard) {
  const out: P2 = [w.doorX + 0.3, w.z + 0.75], inn: P2 = [w.doorX + 0.3, w.z - 0.66];
  const seat: P2 = [w.bed.x + 0.42, w.bed.z + 0.25], front: P2 = [w.bed.x + 1.05, w.bed.z + 0.25];
  const rest = w.nurse, beside: P2 = [w.bed.x + 1.35, w.bed.z + 1.0];
  // (Where the nurse stands to see to the patient: right in front of them on the bed, facing them.)
  const care: P2 = [seat[0] + 0.62, seat[1]];
  return { out, inn, seat, front, rest, beside, care, exit: [w.doorX, w.z + 1.9] as P2 };
}

/** One round's timetable (seconds from its start), for the patient waiting at `spot`. */
export function roundPlan(w: HospitalWard, spot: P2) {
  const q = wardPoints(w);
  // Where the nurse stops: beside the patient, on the door's side.
  const dx = q.out[0] - spot[0], dz = q.out[1] - spot[1], d = Math.hypot(dx, dz) || 1;
  const meet: P2 = [spot[0] + dx / d * 0.8, spot[1] + dz / d * 0.8];
  const toDoor = dist(q.rest, q.inn) / V;
  const opened = toDoor + DOOR;
  const outPath: P2[] = [q.inn, q.out, meet];
  const met = opened + length(outPath) / V;
  const lead: P2[] = [meet, q.out, q.inn, q.beside];
  const follow: P2[] = [spot, q.out, q.inn, q.front];
  const go = met + MEET;
  const patientIn = go + FOLLOW + (dist(spot, q.out) + dist(q.out, q.inn) + 0.6) / V;
  const shut = patientIn;
  const seated = go + FOLLOW + length(follow) / V + SIT;
  const treated = seated + TREAT;
  const up = treated + SIT;
  const atDoor = up + dist(q.front, q.inn) / V;
  const opened2 = atDoor + DOOR;
  const outside = opened2 + (dist(q.inn, q.out) + dist(q.out, q.exit)) / V;
  const shut2 = opened2 + dist(q.inn, q.out) / V + 0.4;
  const end = Math.max(outside, shut2 + DOOR);
  return { q, meet, handle: [w.doorX + w.doorW / 2 - 0.12, w.z] as P2, toDoor, opened, outPath, met, go, lead, follow, shut, seated, treated, up, atDoor, opened2, outside, shut2, end };
}
export type RoundPlan = ReturnType<typeof roundPlan>;

/** How far open the door is (radians, swinging into the treatment room) `t` seconds into a round. */
export function doorAt(r: RoundPlan, t: number) {
  const open = 1.45;
  if (t < r.toDoor) return 0;
  if (t < r.opened) return open * smooth((t - r.toDoor) / DOOR);
  if (t < r.shut) return open;
  if (t < r.shut + DOOR) return open * (1 - smooth((t - r.shut) / DOOR));
  if (t < r.atDoor) return 0;
  if (t < r.opened2) return open * smooth((t - r.atDoor) / DOOR);
  if (t < r.shut2) return open;
  if (t < r.shut2 + DOOR) return open * (1 - smooth((t - r.shut2) / DOOR));
  return 0;
}

/** The nurse `t` seconds into a round (null `t`: no round, at her place): where, facing, walking, a hand out. */
export type NurseHands = { left: [number, number, number]; right: [number, number, number]; blend: number } | null;
const STEP_IN = 0.7;
/** The nurse `t` seconds into a round (null `t`: no round, at her place): where, facing, walking, a hand out to the
 * door, and both hands on the patient while she sees to them (local x, height above the floor, local z). */
export function nurseAt(w: HospitalWard, r: RoundPlan | null, t: number): { at: P2; yaw: number; walking: boolean; hand: number; hands: NurseHands } {
  const q = r?.q ?? wardPoints(w), restYaw = Math.atan2(q.seat[0] - q.rest[0], q.seat[1] - q.rest[1]);
  const none = { hand: 0, hands: null as NurseHands };
  if (!r || t < 0 || t >= r.end) return { at: q.rest, yaw: restYaw, walking: false, ...none };
  if (t < r.toDoor) return { ...along([q.rest, q.inn], t), ...none };
  if (t < r.opened) return { at: q.inn, yaw: 0, walking: false, hand: Math.sin(Math.PI * (t - r.toDoor) / DOOR), hands: null };
  if (t < r.met) return { ...along(r.outPath, t - r.opened), ...none };
  if (t < r.go) { const toward = Math.atan2(r.follow[0]![0] - r.meet[0], r.follow[0]![1] - r.meet[1]); return { at: r.meet, yaw: toward, walking: false, ...none }; }
  const lead = along(r.lead, t - r.go);
  if (lead.walking) return { ...lead, ...none };
  const facing = Math.atan2(q.seat[0] - q.care[0], q.seat[1] - q.care[1]);
  const besideYaw = Math.atan2(q.seat[0] - q.beside[0], q.seat[1] - q.beside[1]);
  // Beside the bed while the patient sits down; then in front of them, seeing to them — hands on the chest, then the
  // shoulders, then the face — while their health comes back; a step back before they get up.
  if (t < r.seated) return { at: q.beside, yaw: besideYaw, walking: false, ...none };
  if (t < r.seated + STEP_IN) { const k = (t - r.seated) / STEP_IN; return { at: lerp(q.beside, q.care, smooth(k)), yaw: facing, walking: k < 0.95, ...none }; }
  if (t < r.treated - STEP_IN) {
    const span = r.treated - STEP_IN - (r.seated + STEP_IN), u = (t - r.seated - STEP_IN) / span, part = Math.min(2, Math.floor(u * 3)), k = u * 3 - part;
    const s = q.seat, H = 0.6;
    const spots: [[number, number, number], [number, number, number]][] = [
      [[s[0] + 0.15, H + 0.42, s[1] - 0.1], [s[0] + 0.15, H + 0.42, s[1] + 0.1]],
      [[s[0] + 0.05, H + 0.62, s[1] - 0.19], [s[0] + 0.05, H + 0.62, s[1] + 0.19]],
      [[s[0] + 0.13, H + 0.86, s[1] - 0.08], [s[0] + 0.13, H + 0.86, s[1] + 0.08]],
    ];
    const [l, rr] = spots[part]!;
    return { at: q.care, yaw: facing, walking: false, hand: 0, hands: { left: l, right: rr, blend: Math.sin(Math.PI * Math.max(0, Math.min(1, k))) ** 0.6 } };
  }
  if (t < r.treated) { const k = (t - (r.treated - STEP_IN)) / STEP_IN; return { at: lerp(q.care, q.beside, smooth(k)), yaw: facing, walking: k < 0.95, ...none }; }
  if (t < r.up) return { at: q.beside, yaw: besideYaw, walking: false, ...none };
  const back = along([q.beside, q.rest], t - r.up);
  return { ...back, yaw: back.walking ? back.yaw : restYaw, ...none };
}

/** The patient `t` seconds into their round, from the moment the nurse reaches them: where, facing, walking,
 * sitting (0..1, on the bed's edge), a hand out to the door. Null before the nurse gets there. */
export function patientAt(r: RoundPlan, t: number): { at: P2; yaw: number; walking: boolean; sit: number; hand: number; inside: boolean } | null {
  if (t < r.go) return null;
  const q = r.q, bedYaw = Math.PI / 2;
  if (t < r.seated - SIT) { const f = along(r.follow, t - r.go - FOLLOW); return { ...f, walking: f.walking && t >= r.go + FOLLOW, sit: 0, hand: 0, inside: t > r.shut - 0.4 }; }
  if (t < r.seated) { const k = smooth((t - (r.seated - SIT)) / SIT); return { at: lerp(q.front, q.seat, k), yaw: bedYaw, walking: false, sit: k, hand: 0, inside: true }; }
  if (t < r.treated) return { at: q.seat, yaw: bedYaw, walking: false, sit: 1, hand: 0, inside: true };
  if (t < r.up) { const k = 1 - smooth((t - r.treated) / SIT); return { at: lerp(q.front, q.seat, k), yaw: bedYaw, walking: false, sit: k, hand: 0, inside: true }; }
  if (t < r.atDoor) return { ...along([q.front, q.inn], t - r.up), sit: 0, hand: 0, inside: true };
  if (t < r.opened2) return { at: q.inn, yaw: 0, walking: false, sit: 0, hand: Math.sin(Math.PI * (t - r.atDoor) / DOOR), inside: true };
  const o = along([q.inn, q.out, q.exit], t - r.opened2);
  return { ...o, sit: 0, hand: 0, inside: t < r.opened2 + 0.6 };
}

/** Who's next: the earliest request among those waiting (ties by id). */
export type Request = { id: string; key: string; req: number; start: number | null };
export function nextUp(requests: Request[], key: string): string | null {
  const waiting = requests.filter((r) => r.key === key && r.start === null).sort((a, b) => a.req - b.req || (a.id < b.id ? -1 : 1));
  return waiting[0]?.id ?? null;
}
