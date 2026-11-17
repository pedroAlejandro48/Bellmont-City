import { BENCH_SEATS, DEFAULT_SAVE, type SaveData, type SavedApt, type SavedGround, type SavedHeld, type SavedPack } from "./config";

export function saveRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readSave(value: unknown): SaveData {
  const data = saveRecord(value);
  const number = (key: keyof SaveData, fallback: number) => typeof data[key] === "number" && Number.isFinite(data[key]) ? data[key] as number : fallback;
  const pos = Array.isArray(data['pos']) && data['pos'].length === 3 && data['pos'].every((v) => typeof v === "number" && Number.isFinite(v)) ? data['pos'] as [number, number, number] : DEFAULT_SAVE.pos;
  return {
    health: Math.max(0, Math.min(100, number("health", DEFAULT_SAVE.health))),
    elapsed: Math.max(0, number("elapsed", DEFAULT_SAVE.elapsed)),
    worldSeed: Math.trunc(number("worldSeed", DEFAULT_SAVE.worldSeed ?? 1337)),
    camPitch: number("camPitch", DEFAULT_SAVE.camPitch ?? 0.22),
    scooter: readScooter(data['scooter']),
    benchSeat: typeof data['benchSeat'] === 'number' && Number.isInteger(data['benchSeat']) && BENCH_SEATS[data['benchSeat']] ? data['benchSeat'] : null,
    cash: Math.max(0, number("cash", DEFAULT_SAVE.cash ?? 200)),
    hunger: Math.max(0, Math.min(100, number("hunger", 100))),
    thirst: Math.max(0, Math.min(100, number("thirst", 100))),
    energy: Math.max(0, Math.min(100, number("energy", 100))),
    ...(data['life'] && typeof data['life'] === 'object' ? { life: data['life'] } : {}),
    pos: [...pos], rotY: number("rotY", DEFAULT_SAVE.rotY), camYaw: number("camYaw", DEFAULT_SAVE.camYaw),
    ...(data['accident'] ? { accident: readAccident(data['accident']) } : {}),
    ...(data['apt'] ? { apt: readApt(data['apt']) } : {}),
    ...(Array.isArray(data['ground']) ? { ground: readGround(data['ground']) } : {}),
    ...(data['held'] ? { held: readHeld(data['held']) } : {}),
    ...(Array.isArray(data['food']) ? { food: readFood(data['food']) } : {}),
  };
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").slice(0, 60) : []);
/** Things left lying about (at most MAX_GROUND, the newest). */
export const MAX_GROUND = 500;
function readGround(list: unknown[]): SavedGround[] {
  const out: SavedGround[] = [];
  for (const v of list.slice(-MAX_GROUND)) {
    const g = saveRecord(v);
    if (typeof g['kind'] !== "string" || !fin(g['x']) || !fin(g['z'])) continue;
    out.push({ kind: g['kind'], x: g['x'], z: g['z'], ...(fin(g['y']) ? { y: g['y'] } : {}), yaw: fin(g['yaw']) ? g['yaw'] : 0, ...(Array.isArray(g['contents']) ? { contents: strs(g['contents']) } : {}) });
  }
  return out;
}
function readHeld(value: unknown): SavedHeld | null {
  const h = saveRecord(value);
  return { slot: fin(h['slot']) ? Math.trunc(h['slot']) : null, trash: h['trash'] === "bottle" || h['trash'] === "can" ? h['trash'] : null, bag: Array.isArray(h['bag']) ? strs(h['bag']) : null };
}
function readFood(list: unknown[]): SavedPack[] {
  const out: SavedPack[] = [];
  for (const v of list.slice(0, 40)) {
    const p = saveRecord(v);
    const kind = p['kind'];
    if ((kind !== "bag" && kind !== "cup" && kind !== "big") || typeof p['key'] !== "string" || !fin(p['x']) || !fin(p['z'])) continue;
    out.push({ where: p['where'] === "held" ? "held" : "ground", hand: p['hand'] === "left" ? "left" : "right", key: p['key'], kind, bags: fin(p['bags']) ? p['bags'] : 0, cups: fin(p['cups']) ? p['cups'] : 0, items: strs(p['items']), ...(p['bottle'] === true ? { bottle: true } : {}), x: p['x'], y: fin(p['y']) ? p['y'] : 0, z: p['z'], yaw: fin(p['yaw']) ? p['yaw'] : 0 });
  }
  return out;
}

function readApt(value: unknown): SavedApt | null {
  const a = saveRecord(value);
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(num);
  if (typeof a['building'] !== "string" || !num(a['floor']) || (a['floor'] as number) < 1 || !num(a['x']) || !num(a['z']) || !pair(a['outside'])) return null;
  return { building: a['building'], floor: Math.round(a['floor'] as number), x: a['x'] as number, z: a['z'] as number, yaw: num(a['yaw']) ? a['yaw'] as number : 0, outside: a['outside'] as [number, number], outsideYaw: num(a['outsideYaw']) ? a['outsideYaw'] as number : 0 };
}

function readScooter(value: unknown): Exclude<SaveData['scooter'], undefined> {
  const scooter = saveRecord(value);
  const pos = scooter['pos'];
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return { pos: pos as [number, number, number], yaw: typeof scooter['yaw'] === "number" && Number.isFinite(scooter['yaw']) ? scooter['yaw'] : 0, fallen: scooter['fallen'] === true, riding: scooter['riding'] === true && scooter['fallen'] !== true };
}

function readAccident(value: unknown): Exclude<SaveData['accident'], undefined> {
  const a = saveRecord(value);
  if (a['phase'] !== "down" && a['phase'] !== "rising") return null;
  const direction = a['direction'];
  if (!Array.isArray(direction) || direction.length !== 2 || !direction.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return { phase: a['phase'], remaining: typeof a['remaining'] === "number" ? Math.max(0, Math.min(5, a['remaining'])) : 5, direction: direction as [number, number], seed: typeof a['seed'] === "number" ? a['seed'] : 42 };
}

export function mergeSave(previous: unknown, current: SaveData) {
  return { ...saveRecord(previous), ...current };
}

export type SaveBackup = { data: Record<string, unknown>; updated_at: string };
export function newerBackup(value: unknown, cloudUpdatedAt: string | undefined): SaveBackup | null {
  const backup = saveRecord(value);
  if (typeof backup['updated_at'] !== "string" || !Number.isFinite(Date.parse(backup['updated_at']))) return null;
  if (cloudUpdatedAt && Date.parse(backup['updated_at']) <= Date.parse(cloudUpdatedAt)) return null;
  if (!backup['data'] || typeof backup['data'] !== "object" || Array.isArray(backup['data'])) return null;
  return { data: saveRecord(backup['data']), updated_at: backup['updated_at'] };
}