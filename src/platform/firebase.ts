// The game's server: Firebase Authentication (accounts), Firestore (usernames, saves, rooms) and the
// Realtime Database (live room presence). The web config identifies the project and is public by design;
// access is enforced by firestore.rules and database.rules.json.
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from "firebase/firestore";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";

const env = import.meta.env;
const emulators = env["VITE_FIREBASE_EMULATORS"] === "1";
// Emulator builds always use the demo project, so a test can never reach the real one.
const projectId = emulators ? "demo-bellmont" : env["VITE_FIREBASE_PROJECT_ID"] || "demo-bellmont";

export const app = initializeApp({
  apiKey: emulators ? "demo-key" : env["VITE_FIREBASE_API_KEY"] || "demo-key",
  authDomain: env["VITE_FIREBASE_AUTH_DOMAIN"] || `${projectId}.firebaseapp.com`,
  projectId,
  databaseURL: (!emulators && env["VITE_FIREBASE_DATABASE_URL"]) || `https://${projectId}-default-rtdb.firebaseio.com`,
  appId: (!emulators && env["VITE_FIREBASE_APP_ID"]) || undefined,
  // (Push notifications need the project's number: it's the second part of the app id, "1:<number>:web:…".)
  ...(!emulators && String(env["VITE_FIREBASE_APP_ID"] ?? "").split(":")[1] ? { messagingSenderId: String(env["VITE_FIREBASE_APP_ID"]).split(":")[1]! } : {}),
});

export const auth = getAuth(app);
// Firestore keeps what it has read on the device (IndexedDB): friends, chats, unread counts and the rest come up at
// once from there when the app opens, and the server's newer copy follows. (No IndexedDB — a private window — or
// another tab already set it up: the plain, in-memory one.)
function makeFirestore(): Firestore {
  try { return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch { return getFirestore(app); }
}
export const firestore = makeFirestore();
export const realtime = getDatabase(app);

if (emulators) {
  const host = env["VITE_FIREBASE_EMULATOR_HOST"] || "127.0.0.1";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, host, 8080);
  connectDatabaseEmulator(realtime, host, 9000);
}
