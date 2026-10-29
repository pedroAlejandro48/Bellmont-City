// The game's server: Firebase Authentication (accounts), Firestore (usernames, saves, rooms) and the
// Realtime Database (live room presence). The web config identifies the project and is public by design;
// access is enforced by firestore.rules and database.rules.json.
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectDatabaseEmulator, getDatabase } from "firebase/database";

const env = import.meta.env;
const projectId = env["VITE_FIREBASE_PROJECT_ID"] || "demo-bellmont";
const emulators = env["VITE_FIREBASE_EMULATORS"] === "1";

export const app = initializeApp({
  apiKey: env["VITE_FIREBASE_API_KEY"] || "demo-key",
  authDomain: env["VITE_FIREBASE_AUTH_DOMAIN"] || `${projectId}.firebaseapp.com`,
  projectId,
  databaseURL: env["VITE_FIREBASE_DATABASE_URL"] || `https://${projectId}-default-rtdb.firebaseio.com`,
  appId: env["VITE_FIREBASE_APP_ID"] || undefined,
});

export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const realtime = getDatabase(app);

if (emulators) {
  const host = env["VITE_FIREBASE_EMULATOR_HOST"] || "127.0.0.1";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, host, 8080);
  connectDatabaseEmulator(realtime, host, 9000);
}
