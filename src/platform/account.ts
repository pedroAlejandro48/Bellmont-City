// Player accounts on Firebase. An account is a Firebase Auth user (email + password, or Google) plus a
// unique Bellmont username: `usernames/<name>` claims the name (and holds the password-locked email that
// makes username sign-in work), and `players/<uid>` records the name for that account.
import {
  createUserWithEmailAndPassword, EmailAuthProvider, GoogleAuthProvider, linkWithCredential, onAuthStateChanged, reauthenticateWithCredential, reauthenticateWithPopup,
  sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, type User,
} from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, runTransaction, setDoc, updateDoc } from "firebase/firestore";
import { deleteUser } from "firebase/auth";
import { auth, firestore } from "./firebase";
import { isEmailLock, lockEmail, unlockEmail } from "./emailLock";

export type Gender = "female" | "male";
export const isGender = (value: unknown): value is Gender => value === "female" || value === "male";
/** Character colours: light pink for female players, light blue for male ones (white before choosing). */
export const BODY_COLORS: Record<Gender, string> = { female: "#f5b3cc", male: "#a6cdf2" };
export const bodyColor = (gender: Gender | null | undefined) => (gender ? BODY_COLORS[gender] : "#ffffff");

export type Account = {
  id: string;
  email: string | null;
  username: string | null;
  /** Chosen with the username when the account is created; neither can change afterwards. */
  gender: Gender | null;
  /** Signs in with a password (so username sign-in can work), rather than only with Google. */
  usesPassword: boolean;
  /** The profile picture: one of the game's (AVATARS) if chosen, else the Google account's (null: none). */
  photo: string | null;
  /** The Google account's own picture, if it signs in with Google (offered last in the picture choice). */
  google: string | null;
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
  const profile = await playerOf(user.uid);
  const account: Account = {
    id: user.uid,
    email: user.email,
    username: profile.username,
    gender: profile.gender,
    usesPassword: user.providerData.some((p) => p.providerId === "password"),
    // (One of the game's pictures if chosen; otherwise the Google account's.)
    photo: isGameAvatar(profile.photo) ? profile.photo : googlePhoto(user) ?? profile.photo,
    google: googlePhoto(user),
  };
  if (account.google && !isGameAvatar(profile.photo)) syncPhoto(account, profile.photo);
  return account;
}
/** The Google account's picture (a bigger copy than the default thumbnail). */
function googlePhoto(user: User) {
  const url = user.providerData.find((p) => p.providerId === "google.com")?.photoURL ?? user.photoURL ?? null;
  return url ? url.replace(/=s\d+-c$/, "=s192-c") : null;
}
/** Proves it's really them before a big change: their password, or (Google-only accounts) Google's sign-in. */
async function confirmIdentity(account: Account, password: string | null) {
  const user = auth.currentUser;
  if (!user || user.uid !== account.id) throw new AccountError("Your sign-in expired. Please sign in again.");
  if (account.usesPassword) {
    if (!password || !account.email) throw new AccountError("Enter your password.");
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(account.email, password)).catch(() => { throw new AccountError("Incorrect password."); });
  } else await attempt(() => reauthenticateWithPopup(user, new GoogleAuthProvider()));
  return user;
}
/** A new username (with the password): the new name is claimed, the old one freed. */
export async function changeUsername(account: Account, next: string, password: string): Promise<Account> {
  if (!account.username) throw new AccountError("Choose a username first.");
  if (!account.usesPassword) throw new AccountError("Add a password first (menu → Add a password).");
  if (next === account.username) return account;
  await confirmIdentity(account, password);
  const lock = account.email ? await lockEmail(account.email, password) : null;
  const taken = await runTransaction(firestore, async (tx) => {
    const name = doc(firestore, "usernames", next);
    if ((await tx.get(name)).exists()) return true;
    tx.set(name, { uid: account.id, ...(lock ? { lock } : {}) });
    tx.update(doc(firestore, "players", account.id), { username: next });
    tx.delete(doc(firestore, "usernames", account.username!));
    return false;
  }).catch(() => { throw new AccountError("Could not change your username. Please try again."); });
  if (taken) throw new AccountError("That username is already taken.");
  void shareNewName(account.id, next);
  return { ...account, username: next };
}
/**
 * After a rename, the copies of your name others keep: your entry in each friend's list, requests you've sent that
 * are still waiting, and your membership in the rooms you have. (Everything that shows names also reads them live
 * from players/<uid>, so this is for what's stored, e.g. notifications.)
 */
async function shareNewName(uid: string, name: string) {
  const list = await getDocs(collection(firestore, "friends", uid, "list")).catch(() => null);
  for (const f of list?.docs ?? []) await updateDoc(doc(firestore, "friends", f.id, "list", uid), { name }).catch(() => {});
  const sent = await getDocs(collection(firestore, "friends", uid, "sent")).catch(() => null);
  for (const r of sent?.docs ?? []) await updateDoc(doc(firestore, "friends", r.id, "requests", uid), { name }).catch(() => {});
  const { savedRooms } = await import("./savedRooms");
  for (const r of savedRooms(uid)) await updateDoc(doc(firestore, "rooms", r.code, "members", uid), { name }).catch(() => {});
}
/** Deletes the account for good: friends (on both sides), requests, invitations, saves, the username and profile, then
 * the sign-in itself. */
export async function deleteAccount(account: Account, password: string | null) {
  const user = await confirmIdentity(account, password);
  const mine = (path: string[]) => getDocs(collection(firestore, ...(path as [string, ...string[]]))).catch(() => null);
  const list = await mine(["friends", account.id, "list"]);
  for (const f of list?.docs ?? []) { await deleteDoc(doc(firestore, "friends", f.id, "list", account.id)).catch(() => {}); await deleteDoc(f.ref).catch(() => {}); }
  for (const sub of ["requests", "sent", "invites"]) for (const d of (await mine(["friends", account.id, sub]))?.docs ?? []) {
    if (sub === "sent") await deleteDoc(doc(firestore, "friends", d.id, "requests", account.id)).catch(() => {});
    await deleteDoc(d.ref).catch(() => {});
  }
  for (const d of (await mine(["saves", account.id, "slots"]))?.docs ?? []) await deleteDoc(d.ref).catch(() => {});
  if (account.email) await deleteDoc(doc(firestore, "emails", account.email.trim().toLowerCase())).catch(() => {});
  if (account.username) await deleteDoc(doc(firestore, "usernames", account.username)).catch(() => {});
  await deleteDoc(doc(firestore, "players", account.id)).catch(() => {});
  await deleteUser(user).catch((e: unknown) => { throw new AccountError(authMessage(e)); });
}

/** The ten profile pictures to choose from without a Google account: things from the game. */
export const AVATARS = ["scooter", "burger", "apple", "moon", "key", "pizza", "building", "tree", "coffee", "basket"].map((n) => `/avatars/${n}.png`);
/** Sets the chosen picture (accounts without Google). */
export const isGameAvatar = (url: string | null | undefined): url is string => !!url && url.startsWith("/avatars/");
export async function chooseAvatar(account: Account, photo: string): Promise<Account> {
  await updateDoc(doc(firestore, "players", account.id), { photo }).catch(() => { throw new AccountError("Could not save your picture. Please try again."); });
  return { ...account, photo };
}
/** Keeps the player's public profile picture (players/<uid>.photo) the same as their Google one. */
export function syncPhoto(account: Account, current: string | null) {
  if (!account.username || (account.photo ?? null) === (current ?? null)) return;
  void updateDoc(doc(firestore, "players", account.id), { photo: account.photo ?? null }).catch(() => {});
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

/** The shortest password allowed when one is added to a Google account. */
export const MIN_PASSWORD = 8;
/**
 * A Google account gets a password too, so it can sign in with its username (or email) and that password: the
 * password is added to the account (Google may ask to confirm it's you first), and the username record is locked
 * with it for username sign-in.
 */
export async function addPassword(account: Account, password: string): Promise<Account> {
  const user = auth.currentUser;
  if (!user || user.uid !== account.id || !account.email) throw new AccountError("Your sign-in expired. Please sign in again.");
  if (password.length < MIN_PASSWORD) throw new AccountError(`Use a password of at least ${MIN_PASSWORD} characters.`);
  const cred = EmailAuthProvider.credential(account.email, password);
  await linkWithCredential(user, cred).catch(async (error: unknown) => {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "auth/provider-already-linked") return;
    if (code === "auth/requires-recent-login") {
      await attempt(() => reauthenticateWithPopup(user, new GoogleAuthProvider()));
      await attempt(() => linkWithCredential(user, cred));
      return;
    }
    throw new AccountError(authMessage(error));
  });
  if (account.username) await updateDoc(doc(firestore, "usernames", account.username), { lock: await lockEmail(account.email, password) })
    .catch(() => { throw new AccountError("Your password was added, but username sign-in couldn't be set up. Sign in with your email once to finish."); });
  return { ...account, usesPassword: true };
}

export function signOutAccount() {
  return signOut(auth);
}

/**
 * Reserves a (normalized) username for the signed-in account. Password accounts confirm their password,
 * which also locks their email into the record for username sign-in.
 */
export async function claimUsername(account: Account, username: string, gender: Gender, password: string | null): Promise<Account> {
  const user = auth.currentUser;
  if (!user || user.uid !== account.id) throw new AccountError("Your sign-in expired. Please sign in again.");
  if (account.username) return chooseGender(account, gender);
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
    tx.set(doc(firestore, "players", account.id), { username, gender, createdAt: Date.now(), ...(account.photo ? { photo: account.photo } : {}) });
    return false;
  }).catch(() => { throw new AccountError("Could not create your account. Please try again."); });
  if (taken) throw new AccountError("That username is already taken.");
  return { ...account, username, gender };
}

/** For an account made before genders existed: the one-time choice (the rules refuse any later change). */
async function chooseGender(account: Account, gender: Gender): Promise<Account> {
  await updateDoc(doc(firestore, "players", account.id), { gender })
    .catch(() => { throw new AccountError("Could not save your choice. Please try again."); });
  return { ...account, gender };
}

/** A player's public profile (username and gender), for showing who is in a room. */
export async function playerOf(uid: string): Promise<{ username: string | null; gender: Gender | null; photo: string | null }> {
  const player = await getDoc(doc(firestore, "players", uid));
  const data = player.exists() ? player.data() : {};
  return { username: typeof data["username"] === "string" ? data["username"] : null, gender: isGender(data["gender"]) ? data["gender"] : null, photo: typeof data["photo"] === "string" ? data["photo"] : null };
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
