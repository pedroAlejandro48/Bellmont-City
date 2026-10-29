import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, User } from "lucide-react";
import { CloudGame, type GameExtras, type WorldSlot } from "@/game/CloudGame";
import { DEFAULT_SAVE } from "@/game/config";
import type { GameState } from "@/game/state";
import type { Account } from "@/platform/account";
import type { NamedRoom, Peer } from "@/platform/claude";
import { createRoom, deleteRoom, findRoom, joinRoomChannel, ROOM_CAPACITY, type RoomInfo } from "@/platform/rooms";
import { isPoseWire } from "./pose";
import { remotePeers, RoomScene, type RemotePlayers } from "./RoomScene";
import { spawnBeside, standingFromPose, type Standing } from "./spawn";

/** How long a new arrival listens for who is already here before deciding the room is not full. */
const SETTLE_MS = 1500;
/** Longest a new arrival waits for everyone's position, so it can spawn beside whoever is on the spawn point. */
const POSE_WAIT_MS = 4000;

export type RoomRequest = { mode: "create" } | { mode: "join"; code: string };
type Session = { room: RoomInfo; channel: NamedRoom; joinedAt: number };

/** Creates or joins a room, then runs the game in it. Problems send the player back with a message. */
export function RoomEntry({ account, request, onExit }: { account: Account; request: RoomRequest; onExit: (message?: string) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      let channel: NamedRoom | null = null;
      try {
        const room = request.mode === "create" ? await createRoom(account) : await findRoom(account, request.code);
        if (!room) return onExit("No room has that code.");
        channel = await joinRoomChannel(room.code);
        const joinedAt = Date.now();
        await channel.presence({ uid: account.id, joinedAt });
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        for (let waited = SETTLE_MS; waited < POSE_WAIT_MS && remotePeers(channel.peers()).some((p) => !isPoseWire(p.presence["pose"])); waited += 250) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (request.mode === "join" && channel.peers().filter((p) => p.kind === "viewer").length > ROOM_CAPACITY) {
          await channel.leave();
          return onExit(`That room is full (${ROOM_CAPACITY} players).`);
        }
        setSession({ room, channel, joinedAt });
      } catch {
        await channel?.leave().catch(() => {});
        onExit(request.mode === "create" ? "Could not create a room. Please try again." : "Could not join that room. Please try again.");
      }
    })();
  }, [account, request, onExit]);

  if (!session) return <div className="flex min-h-screen items-center justify-center bg-background font-display text-2xl text-foreground">
    {request.mode === "create" ? "Building your room…" : "Joining the room…"}
  </div>;
  return <RoomGame account={account} session={session} onExit={onExit} />;
}

function RoomGame({ account, session, onExit }: { account: Account; session: Session; onExit: () => void }) {
  const { room, channel } = session;
  const remotes = useRef<RemotePlayers>(new Map()).current;

  // Leaving (Save & exit, or closing the tab) frees the code once nobody else is in the room. After
  // leaving, nothing more is sent, so a pose still in flight cannot bring this player back on others' lists.
  const { live, leave } = useMemo(() => {
    let left = false;
    const live: NamedRoom = {
      name: channel.name,
      presence: (patch) => (left ? Promise.resolve() : channel.presence(patch)),
      peers: () => channel.peers(),
      onPeers: (handler, onError) => channel.onPeers(handler, onError),
      connected: () => !left && channel.connected(),
      leave: () => channel.leave(),
    };
    const leave = () => {
      if (left) return;
      left = true;
      if (remotePeers(channel.peers()).length === 0) void deleteRoom(account, room.code).catch(() => {});
      void channel.leave().catch(() => {});
    };
    return { live, leave };
  }, [account, room.code, channel]);
  useEffect(() => {
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [leave]);

  const world = useMemo<WorldSlot>(() => ({
    slot: `room-${room.code}`,
    seed: room.seed,
    elapsed: () => DEFAULT_SAVE.elapsed + (Date.now() - room.createdAt) / 1000,
    place: (save) => {
      const standing = remotePeers(channel.peers()).flatMap((p): Standing[] => {
        const pose = p.presence["pose"];
        const at = isPoseWire(pose) ? standingFromPose(pose) : null;
        return at ? [at] : [];
      });
      const at = spawnBeside({ x: save.pos[0], z: save.pos[2] }, standing);
      return { ...save, pos: [at.x, save.pos[1], at.z], scooter: null };
    },
  }), [room, channel]);

  const extras = useMemo<GameExtras>(() => ({
    Scene: ({ state }: { state: GameState }) => <RoomScene state={state} channel={live} remotes={remotes} joinedAt={session.joinedAt} />,
    Overlay: () => <OnlinePanel account={account} channel={live} />,
    exitNote: `ROOM CODE: ${room.code}`,
  }), [account, live, remotes, room.code, session.joinedAt]);

  return <CloudGame account={account} world={world} extras={extras} onExit={() => { leave(); onExit(); }} />;
}

/** Bellmont usernames by account id, read from each player's own `players/<id>` document. */
function useUsernames(account: Account, ids: readonly string[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const id of ids) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      void account.db.doc(`players/${id}`).get().then((snap) => {
        const name = snap.data()?.["username"];
        if (typeof name === "string") setNames((old) => ({ ...old, [id]: name }));
      }).catch(() => asked.current.delete(id));
    }
  }, [account, ids]);
  return names;
}

const joinedAt = (p: Peer) => (typeof p.presence["joinedAt"] === "number" ? p.presence["joinedAt"] : Infinity);
const accountOf = (p: Peer) => p.by ?? (typeof p.presence["uid"] === "string" ? p.presence["uid"] : null);

/** Top-left "people here" box: you first, then everyone else in the order they arrived. */
function OnlinePanel({ account, channel }: { account: Account; channel: NamedRoom }) {
  const [open, setOpen] = useState(false);
  const [peers, setPeers] = useState<readonly Peer[]>(() => channel.peers());
  useEffect(() => channel.onPeers(({ peers: next, joined, left }) => {
    // Pose updates arrive many times a second; only arrivals and departures change this list.
    if (joined.length || left.length) setPeers(next);
  }), [channel]);

  const people = useMemo(() => {
    const viewers = peers.filter((p) => p.kind === "viewer");
    const me = viewers.find((p) => p.sameTab);
    const others = viewers.filter((p) => !p.sameTab).sort((a, b) => joinedAt(a) - joinedAt(b));
    return me ? [me, ...others] : others;
  }, [peers]);
  const ids = useMemo(() => people.flatMap((p) => accountOf(p) ?? []), [people]);
  const names = useUsernames(account, ids);
  const count = Math.max(1, people.length);

  return <div className="pointer-events-auto absolute left-4 top-4 z-20">
    <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`${count} ${count === 1 ? "person" : "people"} in this room`}
      className="hud-panel flex items-center gap-2 px-3 py-2 text-foreground">
      <User className="h-4 w-4" aria-hidden />
      <span className="font-bold tabular-nums">{count}</span>
      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
    </button>
    {open && <ul className="hud-panel mt-2 max-h-72 w-52 overflow-y-auto py-1.5 text-sm text-foreground">
      {people.map((p) => {
        const id = accountOf(p);
        const name = (id && names[id]) || (p.sameTab ? account.username : null) || "Player";
        return <li key={p.peer} className="truncate px-3 py-1.5">
          {name}{p.sameTab && <span className="text-muted-foreground"> (you)</span>}
        </li>;
      })}
    </ul>}
  </div>;
}
