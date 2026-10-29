// Username sign-in without a server and without publishing anyone's email: each username record stores the
// account's email encrypted with a key derived from that account's password. Typing the right password
// recovers the email (which then signs in normally); anyone else reading the record learns nothing useful.

/** Stored on the public `usernames/<name>` record. All fields are base64. */
export type EmailLock = { salt: string; iv: string; cipher: string };

const ITERATIONS = 210_000;
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function keyFor(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

export async function lockEmail(email: string, password: string): Promise<EmailLock> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(password, salt), new TextEncoder().encode(email));
  return { salt: toBase64(salt), iv: toBase64(iv), cipher: toBase64(new Uint8Array(cipher)) };
}

/** The email, or null when the password is wrong (or the lock is malformed). */
export async function unlockEmail(lock: EmailLock, password: string): Promise<string | null> {
  try {
    const key = await keyFor(password, fromBase64(lock.salt));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(lock.iv) as BufferSource }, key, fromBase64(lock.cipher) as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export function isEmailLock(value: unknown): value is EmailLock {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["salt"] === "string" && typeof v["iv"] === "string" && typeof v["cipher"] === "string";
}
