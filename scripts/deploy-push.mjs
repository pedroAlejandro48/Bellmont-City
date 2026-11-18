// Publishes push-worker/index.js as the Cloudflare Worker "bellmont-push" (https://bellmont-push.bellmont-city.workers.dev),
// with its Workers KV namespace (the players' devices). Needs a Cloudflare API token (Edit Workers) for
// api.cloudflare.com. `--secrets` sets the VAPID key pair once (VAPID_PRIVATE_JWK, VAPID_PUBLIC); later deploys keep it.
import { readFileSync } from "node:fs";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "93a2a37e3231f6afe7fa7b65aef743a4";
const NAME = "bellmont-push", KV_TITLE = "bellmont-push-subs";
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`, API = `${BASE}/workers/scripts/${NAME}`;
const auth = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN || "proxy-injected"}` };
const call = async (url, init, what) => { const b = await (await fetch(url, init)).json(); if (!b.success) throw new Error(`${what}: ${JSON.stringify(b.errors)}`); return b.result; };
const jsonInit = (method, body) => ({ method, headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });

// The KV namespace (made the first time).
const spaces = await call(`${BASE}/storage/kv/namespaces?per_page=100`, { headers: auth }, "kv list");
let kv = spaces.find((n) => n.title === KV_TITLE);
if (!kv) kv = await call(`${BASE}/storage/kv/namespaces`, jsonInit("POST", { title: KV_TITLE }), "kv create");

const form = new FormData();
form.append("metadata", JSON.stringify({ main_module: "index.js", compatibility_date: "2024-11-01", keep_bindings: ["secret_text"], bindings: [{ type: "kv_namespace", name: "SUBS", namespace_id: kv.id }] }));
form.append("index.js", new Blob([readFileSync("push-worker/index.js")], { type: "application/javascript+module" }), "index.js");
await call(API, { method: "PUT", headers: auth, body: form }, "upload");
await call(`${API}/subdomain`, jsonInit("POST", { enabled: true }), "workers.dev");
// Every minute: sends out a pending broadcast, a batch at a time (scripts/broadcast.mjs).
await call(`${API}/schedules`, jsonInit("PUT", [{ cron: "* * * * *" }]), "cron");

if (process.argv.includes("--secrets")) {
  for (const name of ["VAPID_PRIVATE_JWK", "VAPID_PUBLIC"]) {
    if (!process.env[name]) throw new Error(`missing ${name}`);
    await call(`${API}/secrets`, jsonInit("PUT", { name, text: process.env[name], type: "secret_text" }), `secret ${name}`);
  }
}
console.log(`Worker ${NAME} deployed.`);
