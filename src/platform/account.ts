// Player accounts on the claude.ai artifact platform. The viewer's claude.ai sign-in is the identity;
// a player is that identity plus a unique Bellmont username. Saves live in the viewer's private
// `data/users/<id>/` subtree, which nobody else (the artifact owner included) can read.
import { dbErrorCode, useCapability, type Db } from "./claude";

export type Account = { id: string; displayName: string; username: string | null; db: Db };

const playerDoc = (db: Db, id: string) => db.doc(`players/${id}`);
const saveDoc = (db: Db, id: string) => db.doc(`data/users/${id}/save`);

/** The signed-in claude.ai viewer, or null when the page runs without the platform (guest only). */
export async function currentAccount(): Promise<Account | null> {
  const [db, user] = await Promise.all([useCapability("db"), useCapability("user")]);
  if (!db || !user) return null;
  const id = await user.id();
  if (!id) return null;
  const [displayName, player] = await Promise.all([user.name(), playerDoc(db, id).get()]);
  const username = player.exists ? player.data()?.["username"] : null;
  return { id, displayName, username: typeof username === "string" ? username : null, db };
}

export type ClaimResult = "claimed" | "taken" | "busy" | "no-access";

/** Reserve a normalized username for this account. A short lease serializes concurrent claims of one name. */
export async function claimUsername(account: Account, username: string): Promise<ClaimResult> {
  const lease = await account.db.doc(`claims/${username}`).acquire({ holder: account.id, ttlMs: 5000 });
  if (!lease.acquired) return "busy";
  const owners = await account.db.collection("players").where("username", "==", username).limit(2).get();
  if (owners.docs.some((doc) => doc.id !== account.id)) return "taken";
  try {
    await playerDoc(account.db, account.id).set({ username, updatedAt: new Date().toISOString() });
  } catch (error) {
    if (dbErrorCode(error) === "invalid_argument") return "no-access";
    throw error;
  }
  return "claimed";
}

export type CloudSave = { data: Record<string, unknown>; updated_at: string } | null;

export async function readCloudSave(account: Account): Promise<CloudSave> {
  const snap = await saveDoc(account.db, account.id).get();
  const { data, updated_at } = (snap.exists ? snap.data() : undefined) ?? {};
  if (typeof data !== "object" || data === null || typeof updated_at !== "string") return null;
  return { data: data as Record<string, unknown>, updated_at };
}

export function writeCloudSave(account: Account, data: Record<string, unknown>, updated_at: string) {
  return saveDoc(account.db, account.id).set({ data, updated_at });
}
