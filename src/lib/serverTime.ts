/**
 * The time according to the game's server, not this device's clock (which can be off by seconds or minutes). Chat
 * messages, "seen" and "open" marks are all stamped with it, so they compare correctly with each other and with the
 * ones the server writes itself (answers sent from an Android notification) — a phone running ahead used to make
 * those look already read on the computer. Measured once at start (and every 30 minutes) from the notification
 * service's /time; until then, and if it can't be reached, the device's own clock.
 */
const TIME_URL = "https://bellmont-push.bellmont-city.workers.dev/time";
let offset = 0;
let started = false;

async function measure() {
  try {
    const t0 = Date.now();
    const res = await fetch(TIME_URL, { cache: "no-store" });
    const t1 = Date.now();
    const now = Number((await res.json() as { now?: number }).now);
    if (Number.isFinite(now) && t1 - t0 < 5000) offset = now - (t0 + t1) / 2;
  } catch { /* (keep the last one) */ }
}

export function syncServerTime() {
  if (started || typeof window === "undefined") return;
  started = true;
  void measure();
  window.setInterval(() => void measure(), 30 * 60e3);
}

export const serverNow = () => Math.round(Date.now() + offset);
