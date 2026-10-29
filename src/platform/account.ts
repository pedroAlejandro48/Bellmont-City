// Player accounts on Firebase. An account is a Firebase Auth user (email + password, or Google) plus a
// unique Bellmont username: `usernames/<name>` claims the name (and holds the password-locked email that
// makes username sign-in work), and `players/<uid>` records the name for that account.
import {
  createUserWithEmailAndPassword, EmailAuthProvider, GoogleAuthProvider, onAuthStateChanged, reauthenticateWithCredential,
  sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, type User,
} from "firebase/auth";
import { doc, getDoc, runTransaction, setDoc, updateDoc } from "firebase/firestore";
import { auth, firestore } from "./firebase";
import { isEmailLock, lockEmail, unlockEmail } from "./emailLock";

export type Account = {
  id: string;
  email: string | null;
  username: string | null;
  /** Signs in with a password (so username sign-in can work), rather than only with Google. */
  usesPassword: boolean;
};

/** A message for the player; anything unexpected is reported generically by the caller. */
export class AccountError extends Error {}

function authMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  switch (code) {
    case "auth/invalid-email": return "That email address doesn't look right.";
    case "auth/email-already-in-use": return "This email already has an account. Sign in instead.";
    case "auth/weak-password": return "Use a password of at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Incorrect email or password.";
    case "auth/too-many-requests": return "Too many attempts. Wait a moment and try again.";
    case "auth/network-request-failed": return "Could not reach the server. Check your connection.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request": return "Google sign-in was cancelled.";
    case "auth/popup-blocked": return "Your browser blocked the Google sign-in window. Allow pop-ups and try again.";
    default: return "Something went wrong. Please try again.";
  }
}

async function attempt<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new AccountError(authMessage(error));
  }
}

async function toAccount(user: User): Promise<Account> {
  const player = await getDoc(doc(firestore, "players", user.uid));
  const username = player.exists() ? player.data()["username"] : null;
  return {
    id: user.uid,
    email: user.email,
    username: typeof username === "string" ? username : null,
    usesPassword: user.providerData.some((p) => p.providerId === "password"),
  };
}

/** Follows the signed-in account (restored automatically on reload, in any browser after signing in). */
export function watchAccount(onChange: (account: Account | null) => void, onError: () => void) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) return onChange(null);
    // A slow lookup must not bring back an account that has since signed out (or changed).
    const current = () => auth.currentUser?.uid === user.uid;
    toAccount(user).then((account) => { if (current()) onChange(account); }, () => { if (current()) onError(); });
  });
}

export function isSignedIn(uid: string) {
  return auth.currentUser?.uid === uid;
}

export function signUpWithEmail(email: string, password: string) {
  return attempt(async () => toAccount((await createUserWithEmailAndPassword(auth, email.trim(), password)).user));
}

export function signInWithEmail(email: string, password: string) {
  return attempt(async () => {
    const account = await toAccount((await signInWithEmailAndPassword(auth, email.trim(), password)).user);
    // Re-lock with the password that just worked, so username sign-in follows password resets.
    if (account.username && account.email) {
      await updateDoc(doc(firestore, "usernames", account.username), { lock: await lockEmail(account.email, password) }).catch(() => {});
    }
    return account;
  });
}

export function signInWithUsername(username: string, password: string) {
  return attempt(async () => {
    const record = await getDoc(doc(firestore, "usernames", username));
    const lock = record.exists() ? record.data()["lock"] : null;
    if (record.exists() && !lock) throw new AccountError("This account signs in with Google.");
    const email = isEmailLock(lock) ? await unlockEmail(lock, password) : null;
    if (!email) throw new AccountError("Incorrect username or password.");
    try {
      return await toAccount((await signInWithEmailAndPassword(auth, email, password)).user);
    } catch {
      throw new AccountError("Incorrect username or password.");
    }
  });
}

export function signInWithGoogle() {
  return attempt(async () => toAccount((await signInWithPopup(auth, new GoogleAuthProvider())).user));
}

export function sendPasswordReset(email: string) {
  return attempt(() => sendPasswordResetEmail(auth, email.trim()));
}

export function signOutAccount() {
  return signOut(auth);
}

/**
 * Reserves a (normalized) username for the signed-in account. Password accounts confirm their password,
 * which also locks their email into the record for username sign-in.
 */
export async function claimUsername(account: Account, username: string, password: string | null): Promise<Account> {
  const user = auth.currentUser;
  if (!user || user.uid !== account.id) throw new AccountError("Your sign-in expired. Please sign in again.");
  let lock = null;
  if (account.usesPassword) {
    if (!password || !account.email) throw new AccountError("Enter your password.");
    await attempt(() => reauthenticateWithCredential(user, EmailAuthProvider.credential(account.email!, password)))
      .catch(() => { throw new AccountError("Incorrect password."); });
    lock = await lockEmail(account.email, password);
  }
  const taken = await runTransaction(firestore, async (tx) => {
    const name = doc(firestore, "usernames", username);
    if ((await tx.get(name)).exists()) return true;
    tx.set(name, { uid: account.id, ...(lock ? { lock } : {}) });
    tx.set(doc(firestore, "players", account.id), { username, createdAt: Date.now() });
    return false;
  }).catch(() => { throw new AccountError("Could not create your account. Please try again."); });
  if (taken) throw new AccountError("That username is already taken.");
  return { ...account, username };
}

/** Bellmont usernames by account id, for showing who is in a room. */
export async function usernameOf(uid: string): Promise<string | null> {
  const player = await getDoc(doc(firestore, "players", uid));
  const name = player.exists() ? player.data()["username"] : null;
  return typeof name === "string" ? name : null;
}

export type CloudSave = { data: Record<string, unknown>; updated_at: string } | null;

const saveDoc = (account: Account, slot: string) => doc(firestore, "saves", account.id, "slots", slot);

/** `slot` names the save: "save" is the player's own city, `room-<CODE>` their progress in a room. */
export async function readCloudSave(account: Account, slot = "save"): Promise<CloudSave> {
  const snap = await getDoc(saveDoc(account, slot));
  const body = snap.exists() ? snap.data() : null;
  const json = body?.["json"], updated_at = body?.["updated_at"];
  if (typeof json !== "string" || typeof updated_at !== "string") return null;
  const data: unknown = JSON.parse(json);
  return typeof data === "object" && data !== null ? { data: data as Record<string, unknown>, updated_at } : null;
}

export function writeCloudSave(account: Account, data: Record<string, unknown>, updated_at: string, slot = "save") {
  // Stored as JSON text: saves hold nested arrays, which Firestore fields cannot.
  return setDoc(saveDoc(account, slot), { json: JSON.stringify(data), updated_at });
}
