// Minimal typings for the claude.ai artifact runtime (`window.claude.use`), covering only what the game uses.
// Outside claude.ai (local dev, a saved copy) `window.claude` is absent and every capability is null.

export type DocSnapshot = { id: string; exists: boolean; data(): Record<string, unknown> | undefined };
export type DocRef = {
  get(): Promise<DocSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  acquire(options: { holder: string; ttlMs?: number }): Promise<{ acquired: boolean; expiresAt?: string }>;
};
export type Query = {
  where(field: string, op: string, value: unknown): Query;
  limit(n: number): Query;
  get(): Promise<{ docs: DocSnapshot[]; empty: boolean }>;
};
export type Db = { doc(path: string): DocRef; collection(path: string): Query };
export type User = {
  id(): Promise<string | null>;
  name(): Promise<string>;
};
export type Peer = {
  peer: string;
  by: string | null;
  isMe: boolean;
  sameTab: boolean;
  kind: "viewer" | "agent";
  presence: Readonly<Record<string, unknown>>;
};
export type RoomError = { code: string; message: string };
export type PeersChange = { peers: readonly Peer[]; joined: readonly Peer[]; left: readonly Peer[]; updated: readonly Peer[] };
/** A named room: everyone who joined the same name, sharing presence live. */
export type NamedRoom = {
  readonly name: string;
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly Peer[];
  onPeers(handler: (change: PeersChange) => void, onError?: (e: RoomError) => void): () => void;
  connected(): boolean;
  leave(): Promise<void>;
};
export type Room = { join(name: string): Promise<NamedRoom> };
type Capabilities = { db: Db; user: User; room: Room };

declare global {
  interface Window {
    claude?: { use<K extends keyof Capabilities>(name: K): Promise<Capabilities[K] | null> };
  }
}

export function getCapability<K extends keyof Capabilities>(name: K): Promise<Capabilities[K] | null> {
  if (typeof window === "undefined" || !window.claude) return Promise.resolve(null);
  return window.claude.use(name).catch(() => null);
}

/** Store calls reject with `{ code, message }`; branch on the code. */
export function dbErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
}
