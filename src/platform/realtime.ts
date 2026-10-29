// Live room presence on the Firebase Realtime Database: each open tab in a room keeps one record at
// `rooms/<CODE>/peers/<peer>` (its uid, arrival time and latest pose), removed by the server as soon as the
// tab leaves or loses its connection.
import { onChildAdded, onChildChanged, onChildRemoved, onDisconnect, onValue, push, ref, remove, update } from "firebase/database";
import { realtime } from "./firebase";

export type Peer = {
  /** One open tab. */
  peer: string;
  /** The account id that tab is signed in as. */
  by: string | null;
  isMe: boolean;
  sameTab: boolean;
  kind: "viewer";
  presence: Readonly<Record<string, unknown>>;
};
export type PeersChange = { peers: readonly Peer[]; joined: readonly Peer[]; left: readonly Peer[]; updated: readonly Peer[] };
export type RoomError = { code: string; message: string };

/** Everyone currently in one room, sharing presence live. */
export type NamedRoom = {
  readonly name: string;
  presence(patch: Record<string, unknown>): Promise<void>;
  /** The same frozen array until something changes. */
  peers(): readonly Peer[];
  onPeers(handler: (change: PeersChange) => void, onError?: (e: RoomError) => void): () => void;
  connected(): boolean;
  leave(): Promise<void>;
};

export async function joinRealtimeRoom(code: string, uid: string): Promise<NamedRoom> {
  const peersRef = ref(realtime, `rooms/${code}/peers`);
  const meRef = push(peersRef);
  const me = meRef.key!;
  let mine: Readonly<Record<string, unknown>> = Object.freeze({ uid });
  const others = new Map<string, Peer>();
  const handlers = new Set<(change: PeersChange) => void>();
  let snapshot: readonly Peer[] = [];
  let isConnected = false;
  let left = false;

  const rebuild = () => {
    snapshot = Object.freeze([
      Object.freeze({ peer: me, by: uid, isMe: true, sameTab: true, kind: "viewer" as const, presence: mine }),
      ...others.values(),
    ]);
  };
  const notify = (change: Omit<PeersChange, "peers">) => {
    rebuild();
    for (const handler of handlers) handler({ peers: snapshot, ...change });
  };
  const toPeer = (key: string, value: unknown): Peer => {
    const presence = Object.freeze({ ...(typeof value === "object" && value !== null ? value : {}) }) as Record<string, unknown>;
    const by = typeof presence["uid"] === "string" ? presence["uid"] : null;
    return Object.freeze({ peer: key, by, isMe: by === uid, sameTab: false, kind: "viewer" as const, presence });
  };

  await onDisconnect(meRef).remove();
  await update(meRef, mine);
  rebuild();

  const stops = [
    onChildAdded(peersRef, (snap) => {
      if (snap.key === me || !snap.key) return;
      const peer = toPeer(snap.key, snap.val());
      others.set(snap.key, peer);
      notify({ joined: [peer], left: [], updated: [] });
    }),
    onChildChanged(peersRef, (snap) => {
      if (snap.key === me || !snap.key) return;
      const peer = toPeer(snap.key, snap.val());
      others.set(snap.key, peer);
      notify({ joined: [], left: [], updated: [peer] });
    }),
    onChildRemoved(peersRef, (snap) => {
      if (snap.key === me || !snap.key) return;
      const peer = others.get(snap.key);
      others.delete(snap.key);
      if (peer) notify({ joined: [], left: [peer], updated: [] });
    }),
    onValue(ref(realtime, ".info/connected"), (snap) => { isConnected = snap.val() === true; }),
  ];

  return {
    name: code,
    async presence(patch) {
      if (left) return;
      const next: Record<string, unknown> = { ...mine };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      mine = Object.freeze(next);
      rebuild();
      await update(meRef, patch);
    },
    peers: () => snapshot,
    onPeers(handler) {
      handlers.add(handler);
      queueMicrotask(() => { if (handlers.has(handler)) handler({ peers: snapshot, joined: snapshot, left: [], updated: [] }); });
      return () => { handlers.delete(handler); };
    },
    connected: () => isConnected && !left,
    async leave() {
      if (left) return;
      left = true;
      for (const stop of stops) stop();
      await remove(meRef);
      await onDisconnect(meRef).cancel();
    },
  };
}
