/**
 * The theme setting (Settings → Theme): light, dark or system (the default). It picks the pages' backdrop —
 * light the park by day, dark the park at night, system whichever matches the device's light/dark mode, following
 * it live. The choice is kept on this device; `data-backdrop="day|night"` on the page root lets the pre-rendered
 * pictures (styles.css) match before the drawn one is ready.
 */
export type ThemePref = "light" | "dark" | "system";

const KEY = "bellmont-theme";
const listeners = new Set<() => void>();

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* no storage */ }
  return "system";
}

function deviceDark() {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return true; }
}

export function backdropTime(): "day" | "night" {
  const p = themePref();
  if (p === "light") return "day";
  if (p === "dark") return "night";
  return deviceDark() ? "night" : "day";
}

function apply() {
  if (typeof document !== "undefined") document.documentElement.dataset["backdrop"] = backdropTime();
}

export function setThemePref(p: ThemePref) {
  if (p === themePref()) return; // (choosing what's already chosen does nothing)
  const before = backdropTime();
  try { localStorage.setItem(KEY, p); } catch { /* no storage */ }
  apply();
  if (backdropTime() !== before) for (const f of listeners) f(); // (dark ↔ system on a dark device: same picture)
}

/** Called when the backdrop's time may have changed (the setting, or the device's mode under "system"). */
export function onThemeChange(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

if (typeof window !== "undefined") {
  apply();
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (themePref() !== "system") return;
      apply();
      for (const f of listeners) f();
    });
  } catch { /* old browsers */ }
}
