// The rooms you've been in (created or joined), kept on this device per account so you can go back in without the
// code: each with a small 16:9 picture of what was last on the screen there.
export type SavedRoom = { code: string; at: number; thumb: string | null };
const KEY = (uid: string) => `bellmont-rooms-${uid}`;
const listeners = new Set<() => void>();

export function savedRooms(uid: string): SavedRoom[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(uid)) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((r): r is SavedRoom => !!r && typeof r.code === "string" && typeof r.at === "number").sort((a, b) => b.at - a.at) : [];
  } catch { return []; }
}
function write(uid: string, list: SavedRoom[]) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(list.slice(0, 30))); } catch { /* (full: the pictures go first) */
    try { localStorage.setItem(KEY(uid), JSON.stringify(list.slice(0, 30).map((r) => ({ ...r, thumb: null })))); } catch { /* */ }
  }
  listeners.forEach((f) => f());
}
/** You're in this room now (it goes to the top of your list). */
export function rememberRoom(uid: string, code: string) {
  const list = savedRooms(uid), had = list.find((r) => r.code === code);
  write(uid, [{ code, at: Date.now(), thumb: had?.thumb ?? null }, ...list.filter((r) => r.code !== code)]);
}
export function setRoomThumb(uid: string, code: string, thumb: string) {
  const list = savedRooms(uid);
  if (!list.some((r) => r.code === code)) return;
  write(uid, list.map((r) => (r.code === code ? { ...r, thumb } : r)));
}
export function forgetRoom(uid: string, code: string) { write(uid, savedRooms(uid).filter((r) => r.code !== code)); }
export function onSavedRooms(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
