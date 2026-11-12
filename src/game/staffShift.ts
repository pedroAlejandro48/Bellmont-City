// Staff coming and going (pure). A business with opening hours has nobody inside while it's closed: at closing time
// each worker walks from their post out of the door and off down the sidewalk until out of sight; ten in-game
// minutes before opening they appear a block's walk away and walk in to their post, there by opening time. All by the
// clock (so everyone sees them in the same place), with each worker a moment behind the one before.
import { roomPath } from "./diners";
import type { Room } from "./restaurantRoom";

export const ARRIVE_MINUTES = 10, LEAVE_MINUTES = 14;
/** The arriving / leaving windows in real seconds. */
export const shiftWindow = (arriving: boolean, gameMinute: number) => (arriving ? ARRIVE_MINUTES : LEAVE_MINUTES) * gameMinute;
/** How far along the sidewalk they come from / go to, how fast they walk, the gap between one and the next. */
const AWAY = 22, SPEED = 1.35, GAP = 1.4;
export type Shift = { phase: "off" | "arriving" | "working" | "leaving"; t: number };
/** Where the business's staff are in their day at `hours` (t: real seconds into arriving or leaving). */
export function shiftAt(h: { opens: number; closes: number } | null, hours: number, gameMinute: number): Shift {
  if (!h) return { phase: "working", t: 0 };
  const m = hours * 60, o = h.opens * 60, c = h.closes * 60;
  if (m >= o && m < c) return { phase: "working", t: 0 };
  const untilOpen = ((o - m) % 1440 + 1440) % 1440, sinceClose = ((m - c) % 1440 + 1440) % 1440;
  if (untilOpen <= ARRIVE_MINUTES) return { phase: "arriving", t: (ARRIVE_MINUTES - untilOpen) * gameMinute };
  if (sinceClose < LEAVE_MINUTES) return { phase: "leaving", t: sinceClose * gameMinute };
  return { phase: "off", t: 0 };
}

type P2 = [number, number];
const len = (pts: P2[]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);
/**
 * Worker `i`'s way in (or out) between the sidewalk and `post` (room frame: the door at z 0, outside +z): along the
 * sidewalk to the door, through it (in by the right leaf, out by the left), and round the furniture to the post.
 */
export function commutePath(room: Omit<Room, "items" | "doors"> & { items?: Room["items"] }, post: P2, i: number, arriving: boolean): { pts: P2[]; door: number } {
  const side = i % 2 ? -1 : 1, far: P2 = [side * (AWAY + i * 1.5), 2.9];
  const doorX = arriving ? 0.5 : -0.5, outside: P2 = [doorX, 2.4], inside: P2 = [doorX, -1.1];
  // (A shop's layout has no tables or chairs.)
  const r = { ...room, items: (room as { items?: Room["items"] }).items ?? [] } as Room;
  const pts: P2[] = arriving ? [far, outside, inside, ...roomPath(r, inside, post, -1), post] : [post, ...roomPath(r, post, inside, -1), inside, outside, far];
  // (Drop repeated points.)
  const clean = pts.filter((p, k) => k === 0 || Math.hypot(p[0] - pts[k - 1]![0], p[1] - pts[k - 1]![1]) > 0.05);
  const doorAt = clean.findIndex((p) => p === (arriving ? outside : inside));
  return { pts: clean, door: len(clean.slice(0, doorAt + 1)) };
}
/**
 * Where worker `i` is `t` seconds into arriving or leaving: position, facing, walking or not, shown or not (gone
 * once out of sight leaving; at the post, facing `postYaw`, once arrived), and the moment they reach the door.
 */
export function commutePose(path: { pts: P2[]; door: number }, i: number, t: number, arriving: boolean, postYaw: number, window = Infinity) {
  // A brisk walk when the way is long: there by opening time (or out of sight before the street's empty again).
  const total = len(path.pts), pts = path.pts, speed = Math.max(SPEED, Math.min(2.4, total / Math.max(1, window - i * GAP - 1.5)));
  const d = Math.max(0, t - i * GAP) * speed;
  const doorTime = i * GAP + path.door / speed;
  if (d >= total) {
    const end = pts[pts.length - 1]!;
    return arriving ? { x: end[0], z: end[1], yaw: postYaw, walking: false, visible: true, doorTime } : { x: end[0], z: end[1], yaw: 0, walking: false, visible: false, doorTime };
  }
  let at = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]!, b = pts[k + 1]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (at + l >= d) {
      const u = l > 1e-6 ? (d - at) / l : 0;
      return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), walking: d > 0, visible: true, doorTime };
    }
    at += l;
  }
  const end = pts[pts.length - 1]!;
  return { x: end[0], z: end[1], yaw: postYaw, walking: false, visible: true, doorTime };
}
