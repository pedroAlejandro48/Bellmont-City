// Sends a notification to every player, in the language each one has the game in:
//   NODE_USE_ENV_PROXY=1 node scripts/broadcast.mjs message.json        (or --status to see how far it got)
// message.json: { "title": { "en": "…", "es": "…", … }, "body": { "en": "…", … }, "link": "/" } — "en" is used for any
// language left out. It is stored in the push worker's KV as "broadcast"; the worker's every-minute cron sends it
// (only to app devices for players who have an app), and the Windows app picks it up from GET /broadcast.
import { readFileSync } from "node:fs";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "93a2a37e3231f6afe7fa7b65aef743a4";
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
const auth = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN || "proxy-injected"}` };
const spaces = await (await fetch(`${BASE}/storage/kv/namespaces?per_page=100`, { headers: auth })).json();
const kv = spaces.result?.find((n) => n.title === "bellmont-push-subs");
if (!kv) throw new Error("KV namespace not found: " + JSON.stringify(spaces.errors));
const KEY = `${BASE}/storage/kv/namespaces/${kv.id}/values/broadcast`;

if (process.argv.includes("--status")) {
  const res = await fetch(KEY, { headers: auth });
  const b = res.ok ? await res.json() : null;
  console.log(b ? `${b.id}: ${b.done ? "done" : "sending"}, ${b.sent ?? 0} notification(s) delivered so far` : "no broadcast yet");
  const keys = await (await fetch(`${BASE}/storage/kv/namespaces/${kv.id}/keys?prefix=subs:&limit=1000`, { headers: auth })).json();
  console.log(`${keys.result?.length ?? 0} player(s) with notification devices`);
} else {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node scripts/broadcast.mjs message.json");
  const msg = JSON.parse(readFileSync(file, "utf8"));
  if (!msg.title?.en || !msg.body?.en) throw new Error("title.en and body.en are required");
  const b = { id: Date.now().toString(36), title: msg.title, body: msg.body, link: msg.link ?? "/", at: Date.now(), cursor: null, done: false, sent: 0 };
  const res = await fetch(KEY, { method: "PUT", headers: { ...auth, "Content-Type": "text/plain" }, body: JSON.stringify(b) });
  const r = await res.json();
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  console.log(`Broadcast ${b.id} queued: it goes out within a minute or two.`);
}
