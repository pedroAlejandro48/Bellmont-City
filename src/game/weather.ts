// Weather (pure): a function of the game clock and the world seed, so everyone in a room sees the same sky with
// nothing sent. Time is cut into 10-minute spells (a quarter of a day); each spell is clear, cloudy, rainy or foggy,
// and one spell fades into the next over the last 90 seconds.
export type WeatherKind = "clear" | "cloudy" | "rain" | "fog";
export type Weather = { kind: WeatherKind; clouds: number; rain: number; fog: number };

export const SPELL = 600;
const BLEND = 90;
const LOOK: Record<WeatherKind, Omit<Weather, "kind">> = {
  clear: { clouds: 0, rain: 0, fog: 0 },
  cloudy: { clouds: 0.6, rain: 0, fog: 0.1 },
  rain: { clouds: 1, rain: 1, fog: 0.35 },
  fog: { clouds: 0.5, rain: 0, fog: 1 },
};

function hash(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function spellKind(seed: number, spell: number): WeatherKind {
  // The first spell of a new world is always clear: no rain on the first minutes of play.
  if (spell <= 0) return "clear";
  const r = hash(spell * 7919 + seed * 31);
  return r < 0.58 ? "clear" : r < 0.76 ? "cloudy" : r < 0.92 ? "rain" : "fog";
}

export function weatherAt(elapsed: number, seed: number): Weather {
  const spell = Math.floor(elapsed / SPELL), into = elapsed - spell * SPELL;
  const now = spellKind(seed, spell), next = spellKind(seed, spell + 1);
  const t = Math.max(0, (into - (SPELL - BLEND)) / BLEND), k = t * t * (3 - 2 * t);
  const a = LOOK[now], b = LOOK[next];
  const mix = (x: number, y: number) => x + (y - x) * k;
  return { kind: k > 0.5 ? next : now, clouds: mix(a.clouds, b.clouds), rain: mix(a.rain, b.rain), fog: mix(a.fog, b.fog) };
}

export const WEATHER_NAME: Record<WeatherKind, string> = { clear: "Clear", cloudy: "Cloudy", rain: "Rain", fog: "Fog" };
