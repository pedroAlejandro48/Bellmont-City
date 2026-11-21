// Languages. The game is written in English; a chosen language translates every piece of text it shows — on the
// page (text, placeholders, labels, tooltips) and drawn into the 3D world (signs, billboards, menu boards, all drawn
// on canvases) — from a dictionary per language (src/i18n/dict/<code>.json: English text → translation, with
// "{0}"-style holes for the parts that change, like numbers and names). Nothing in the code changes; the text is
// swapped as it appears. Changing the language reloads the page so everything is drawn again.

export type LangCode = "en" | "zh" | "hi" | "es" | "ar" | "fr" | "bn" | "pt" | "ru" | "ur" | "de" | "it";
/** The ten most spoken languages, plus German and Italian, with the flag of the main country that speaks each. */
export const LANGS: { code: LangCode; name: string; flag: string }[] = [
  { code: "en", name: "English", flag: "us" },
  { code: "zh", name: "中文", flag: "cn" },
  { code: "hi", name: "हिन्दी", flag: "in" },
  { code: "es", name: "Español", flag: "es" },
  { code: "ar", name: "العربية", flag: "sa" },
  { code: "fr", name: "Français", flag: "fr" },
  { code: "bn", name: "বাংলা", flag: "bd" },
  { code: "pt", name: "Português", flag: "br" },
  { code: "ru", name: "Русский", flag: "ru" },
  { code: "ur", name: "اردو", flag: "pk" },
  { code: "de", name: "Deutsch", flag: "de" },
  { code: "it", name: "Italiano", flag: "it" },
];
/** The languages as the menu lists them: in alphabetical order of their names. */
export const LANGS_SORTED = [...LANGS].sort((a, b) => a.name.localeCompare(b.name, "en"));
const KEY = "bellmont-lang";
export function currentLang(): LangCode {
  try { const v = localStorage.getItem(KEY); if (v && LANGS.some((l) => l.code === v)) return v as LangCode; } catch { /* */ }
  return deviceLang();
}
/** Until one is chosen: the device's language (the first of its languages the game has), else English. */
export function deviceLang(): LangCode {
  try {
    const list = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of list) {
      const code = String(tag || "").toLowerCase().split(/[-_]/)[0];
      const hit = LANGS.find((l) => l.code === code);
      if (hit) return hit.code;
    }
  } catch { /* */ }
  return "en";
}
export function setLang(code: LangCode) {
  try { localStorage.setItem(KEY, code); } catch { /* */ }
  window.location.reload();
}

let exact = new Map<string, string>();
let patterns: { re: RegExp; to: string }[] = [];
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Loads the chosen language's dictionary (before the page is drawn). */
export async function loadLang() {
  const code = currentLang();
  document.documentElement.lang = code;
  if (code === "en") return;
  const dicts = import.meta.glob("./dict/*.json");
  const load = dicts[`./dict/${code}.json`];
  if (!load) return;
  const dict = ((await load()) as { default: Record<string, string> }).default;
  for (const [en, to] of Object.entries(dict)) {
    if (!to) continue;
    if (/\{\d+\}/.test(en)) {
      const parts = en.split(/\{(\d+)\}/);
      let src = "^";
      for (let i = 0; i < parts.length; i++) src += i % 2 ? "(.+?)" : escape(parts[i]!);
      patterns.push({ re: new RegExp(src + "$", "s"), to });
    } else exact.set(norm(en), to);
  }
  // Longer patterns first (more specific).
  patterns = patterns.sort((a, b) => b.re.source.length - a.re.source.length);
  startTranslating();
}

/** Text that must never be translated (a player's name drawn on a canvas): marked with an invisible character. */
export const KEEP = "\u2060";
const memo = new Map<string, string | null>();
let upper: Map<string, string> | null = null;
/** A piece of English text in the chosen language (unchanged if there's nothing for it). */
export function tr(text: string): string {
  if (!exact.size && !patterns.length) return text;
  if (text.startsWith(KEEP)) return text;
  const key = norm(text);
  if (!key || !/[A-Za-z]/.test(key)) return text;
  let hit = memo.get(key);
  if (hit === undefined) { hit = exact.get(key) ?? fromPattern(key) ?? null; if (memo.size > 5000) memo.clear(); memo.set(key, hit); }
  if (hit === null) return text;
  // (Keeping the spaces around it, which separate it from what's next to it.)
  const lead = /^\s*/.exec(text)![0], trail = /\s*$/.exec(text)![0];
  return lead + hit + trail;
}
function fromPattern(key: string): string | undefined {
  for (const p of patterns) {
    const m = p.re.exec(key);
    if (m) return p.to.replace(/\{(\d+)\}/g, (_, i) => { const v = m[Number(i) + 1] ?? ""; return exact.get(norm(v)) ?? v; });
  }
  // Upper-case versions (signs, labels) of known text.
  if (key.toUpperCase() === key) {
    upper ??= new Map([...exact].map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]));
    return upper.get(key);
  }
  return undefined;
}

const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const done = new WeakMap<Node, string>();
function translateNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const p = node.parentElement;
    if (!p || p.closest("script,style,[data-no-translate]")) return;
    const v = node.nodeValue ?? "";
    if (done.get(node) === v) return;
    const t = tr(v);
    done.set(node, t);
    if (t !== v) node.nodeValue = t;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (el.closest("[data-no-translate]")) return;
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
  if (el instanceof HTMLInputElement && (el.type === "button" || el.type === "submit") && el.value) el.value = tr(el.value);
  for (const c of Array.from(el.childNodes)) translateNode(c);
}

function startTranslating() {
  // The page: everything there now, and everything that appears or changes later.
  const run = () => {
    translateNode(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") translateNode(m.target);
        else if (m.type === "attributes") translateNode(m.target);
        else m.addedNodes.forEach(translateNode);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) run(); else document.addEventListener("DOMContentLoaded", run);
  // The 3D world's text is drawn on canvases: translated as it's drawn.
  const C = CanvasRenderingContext2D.prototype;
  for (const fn of ["fillText", "strokeText"] as const) {
    const orig = C[fn];
    C[fn] = function (this: CanvasRenderingContext2D, text: string, ...rest: [number, number, number?]) { return orig.call(this, tr(String(text)), ...rest); } as typeof orig;
  }
  const measure = C.measureText;
  C.measureText = function (this: CanvasRenderingContext2D, text: string) { return measure.call(this, tr(String(text))); };
  // (The browser's own pop-ups.)
  const conf = window.confirm, alrt = window.alert, prom = window.prompt;
  window.confirm = (m?: string) => conf(tr(m ?? ""));
  window.alert = (m?: string) => alrt(tr(m ?? ""));
  window.prompt = (m?: string, d?: string) => prom(tr(m ?? ""), d);
}
