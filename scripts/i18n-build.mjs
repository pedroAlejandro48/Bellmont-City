// Builds src/i18n/dict/<lang>.json from src/i18n/keys.json (the English texts, numbered from 0) and
// src/i18n/src/<lang>.txt (lines "N|translation"; "N|-" or a missing N leaves that text in English).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const keys = JSON.parse(readFileSync("src/i18n/keys.json", "utf8"));
for (const f of readdirSync("src/i18n/src").filter((f) => f.endsWith(".txt"))) {
  const lang = f.replace(/\.txt$/, ""), dict = {};
  let n = 0, bad = 0;
  for (const line of readFileSync(`src/i18n/src/${f}`, "utf8").split("\n")) {
    const m = /^(\d+)\|(.*)$/.exec(line.trim());
    if (!m) continue;
    const i = Number(m[1]), t = m[2].trim();
    if (!keys[i] || !t || t === "-") continue;
    // (A template's holes must all still be there.)
    const holes = (keys[i].match(/\{\d+\}/g) ?? []).sort().join(), got = (t.match(/\{\d+\}/g) ?? []).filter((h) => keys[i].includes(h));
    if (holes && new Set(got).size < new Set(holes.split(",")).size - 1) { bad++; }
    dict[keys[i]] = t; n++;
  }
  writeFileSync(`src/i18n/dict/${lang}.json`, JSON.stringify(dict));
  console.log(`${lang}: ${n} of ${keys.length}${bad ? ` (${bad} templates missing holes)` : ""}`);
}
