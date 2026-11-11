import { BENCH_SEATS, DEFAULT_SAVE, type SaveData, type SavedApt } from "./config";

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
  };
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