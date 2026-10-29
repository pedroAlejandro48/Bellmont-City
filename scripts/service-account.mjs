// Rebuilds a service account key file from FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (or the key split
// into FIREBASE_PRIVATE_KEY_1, _2, ...), as copied from the key file's "client_email" and "private_key" lines.
const env = process.env;
// Accept the value with or without its surrounding quotes and trailing comma, as copied from the file.
const clean = (value) => value.trim().replace(/,$/, "").replace(/^"|"$/g, "");
const parts = env.FIREBASE_PRIVATE_KEY
  ? [env.FIREBASE_PRIVATE_KEY]
  : Object.keys(env).filter((k) => /^FIREBASE_PRIVATE_KEY_\d+$/.test(k)).sort((a, b) => Number(a.split("_").pop()) - Number(b.split("_").pop())).map((k) => env[k]);
if (!parts.length) throw new Error("Set FIREBASE_PRIVATE_KEY (the key file's private_key value).");
const privateKey = parts.map(clean).join("").replace(/\\n/g, "\n");
if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
  throw new Error("FIREBASE_PRIVATE_KEY should run from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----.");
}
process.stdout.write(JSON.stringify({
  type: "service_account",
  project_id: env.VITE_FIREBASE_PROJECT_ID,
  client_email: clean(env.FIREBASE_CLIENT_EMAIL),
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
}));
