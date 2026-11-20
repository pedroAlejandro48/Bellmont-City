import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { ChevronDown, Crown, User } from "lucide-react";
import { LiveName } from "@/platform/liveNames";
import { Avatar } from "@/components/Avatar";
import { FriendActions, useFriends } from "@/components/Friends";
import { CloudGame, type GameExtras, type WorldSlot } from "@/game/CloudGame";
import { DEFAULT_SAVE } from "@/game/config";
import type { GameState } from "@/game/state";
import { playerOf, type Account } from "@/platform/account";
import type { NamedRoom, Peer } from "@/platform/realtime";
import { addMember, createRoom, deleteRoom, findRoom, joinRoomChannel, kickMember, ROOM_CAPACITY, touchRoom, watchAdmin, watchMembers, watchMyMembership, watchRoom, type Member, type RoomInfo } from "@/platform/rooms";
import { forgetRoom, rememberRoom, setRoomThumb } from "@/platform/savedRooms";
import { RoomCreatedNotice, RoomMenu, roomNoticeHidden } from "./RoomMenu";
import { isPoseWire } from "./pose";
import { remotePeers, RoomScene, type RemotePlayers } from "./RoomScene";
import { RoomBikes } from "./RoomBikes";
import { RoomWorldSync } from "./RoomWorldSync";
import { spawnBeside, standingFromPose, type Standing } from "./spawn";

/** How long a new arrival listens for who is already here before deciding the room is not full. */
const SETTLE_MS = 1500;
/** Longest a new arrival waits for everyone's position, so it can spawn beside whoever is on the spawn point. */
const POSE_WAIT_MS = 4000;

export type RoomRequest = { mode: "create" } | { mode: "join"; code: string };
type Session = { room: RoomInfo; channel: NamedRoom; joinedAt: number; created: boolean };
/** While someone is inside, the room's 30-day expiry keeps being pushed back. */
const TOUCH_MS = 6 * 60 * 60 * 1000;

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
        const room = request.mode === "create" ? await createRoom(account) : await findRoom(request.code);
        if (!room) return onExit("No room has that code.");
        if (request.mode === "join") await touchRoom(room.code).catch(() => {});
        channel = await joinRoomChannel(room, account);
        const joinedAt = Date.now();
        await channel.presence({ uid: account.id, joinedAt });
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
        for (let waited = SETTLE_MS; waited < POSE_WAIT_MS && remotePeers(channel.peers()).some((p) => !isPoseWire(p.presence["pose"])); waited += 250) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (request.mode === "join" && channel.peers().filter((p) => p.kind === "viewer" && p.presence["away"] !== true).length > ROOM_CAPACITY) {
          await channel.leave();
          return onExit(`That room is full (${ROOM_CAPACITY} players).`);
        }
        // It's yours to come back to: on its members (the server) and in your rooms (this device).
        if (request.mode === "join") await addMember(room.code, account).catch(() => {});
        rememberRoom(account.id, room.code);
        setSession({ room, channel, joinedAt, created: request.mode === "create" });
      } catch {
        await channel?.leave().catch(() => {});
        onExit(request.mode === "create" ? "Could not create a room. Please try again." : "Could not join that room. Please try again.");
      }
    })();
  }, [account, request, onExit]);

  if (!session) return <div className="auth-bg flex min-h-screen items-center justify-center font-display text-2xl text-foreground">
    {request.mode === "create" ? "Building your room…" : "Joining the room…"}
  </div>;
  return <RoomGame account={account} session={session} onExit={onExit} />;
}

function RoomGame({ account, session, onExit }: { account: Account; session: Session; onExit: (message?: string) => void }) {
  const { room, channel } = session;
  const remotes = useRef<RemotePlayers>(new Map()).current;
  const [notice, setNotice] = useState(() => session.created && !roomNoticeHidden());

  // Leaving (Save & exit, or closing the tab) keeps the room for later. After leaving, nothing more is sent,
  // so a pose still in flight cannot bring this player back on others' lists.
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
      void channel.leave().catch(() => {});
    };
    return { live, leave };
  }, [channel]);
  useEffect(() => {
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [leave]);

  // Who's the admin and who has the room, live (for the crown, the people list, kicking and deleting).
  const meta = useMemo(() => makeMeta(room.admin), [room.admin]);
  useEffect(() => watchAdmin(room.code, (a) => { if (a) meta.set({ admin: a }); }), [room.code, meta]);
  useEffect(() => watchMembers(room.code, (members) => meta.set({ members })), [room.code, meta]);
  // Kicked by the admin: out of the room, and off your rooms.
  useEffect(() => watchMyMembership(room.code, account.id, () => {
    leave(); forgetRoom(account.id, room.code); onExit("You were removed from this room.");
  }), [room.code, account.id, leave, onExit]);
  // When the creator deletes the room, everyone in it goes back to the menu.
  const deletingHere = useRef(false);
  useEffect(() => watchRoom(room.code, () => {
    leave();
    onExit(deletingHere.current ? "Room deleted." : "This room was deleted by its creator.");
  }), [room.code, leave, onExit]);
  useEffect(() => {
    const id = window.setInterval(() => { void touchRoom(room.code).catch(() => {}); }, TOUCH_MS);
    return () => window.clearInterval(id);
  }, [room.code]);

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
    Scene: ({ state }: { state: GameState }) => <>
      <SceneWithAdmin state={state} channel={live} remotes={remotes} joinedAt={session.joinedAt} meta={meta} />
      <RoomBikes state={state} code={room.key} uid={account.id} channel={live} />
      <RoomThumb uid={account.id} code={room.code} />
      <RoomWorldSync state={state} code={room.code} uid={account.id} />
    </>,
    Overlay: () => <OnlinePanel account={account} channel={live} meta={meta} code={room.code} />,
    Actions: () => <MenuWithAdmin account={account} code={room.code} meta={meta} onDelete={async () => { deletingHere.current = true; await deleteRoom(room); }} />,
    exitNote: `ROOM CODE: ${room.code}`,
  }), [account, live, remotes, room, session.joinedAt, meta]);

  return <>
    <CloudGame account={account} world={world} extras={extras} onExit={() => { leave(); onExit(); }} />
    {notice && <RoomCreatedNotice code={room.code} onClose={() => setNotice(false)} />}
  </>;
}

/** The room's admin and members, live; components re-render when they change. */
type Meta = { admin: string; members: Member[] };
function makeMeta(admin: string) {
  let v: Meta = { admin, members: [] };
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set: (patch: Partial<Meta>) => { v = { ...v, ...patch }; subs.forEach((f) => f()); },
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}
type MetaStore = ReturnType<typeof makeMeta>;
const useMeta = (m: MetaStore) => useSyncExternalStore(m.subscribe, m.get);
function SceneWithAdmin(props: Omit<Parameters<typeof RoomScene>[0], "creator"> & { meta: MetaStore }) {
  const { admin } = useMeta(props.meta);
  return <RoomScene state={props.state} channel={props.channel} remotes={props.remotes} joinedAt={props.joinedAt} creator={admin} />;
}
function MenuWithAdmin({ account, code, meta, onDelete }: { account: Account; code: string; meta: MetaStore; onDelete: () => Promise<void> }) {
  const { admin } = useMeta(meta);
  return <RoomMenu account={account} code={code} canDelete={admin === account.id} onDelete={onDelete} />;
}
/** Every 15 s, a small 16:9 picture of the game's view: shown beside this room in your rooms. */
function RoomThumb({ uid, code }: { uid: string; code: string }) {
  const last = useRef(0);
  useFrame(({ gl, scene, camera }) => {
    const now = performance.now();
    if (now - last.current < 15000) return;
    last.current = now;
    try {
      gl.render(scene, camera);
      const src = gl.domElement, c = document.createElement("canvas");
      c.width = 192; c.height = 108;
      const g = c.getContext("2d");
      if (!g || !src.width || !src.height) return;
      const k = Math.max(c.width / src.width, c.height / src.height), w = src.width * k, h = src.height * k;
      g.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
      setRoomThumb(uid, code, c.toDataURL("image/jpeg", 0.6));
    } catch { /* (no picture this time) */ }
  });
  return null;
}

/** Bellmont usernames by account id, read from each player's own `players/<id>` document. */
function useUsernames(ids: readonly string[]) {
  const [names, setNames] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const id of ids) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      void playerOf(id).then(({ username: name }) => {
        if (name) setNames((old) => ({ ...old, [id]: name }));
      }).catch(() => asked.current.delete(id));
    }
  }, [ids]);
  return names;
}

const joinedAt = (p: Peer) => (typeof p.presence["joinedAt"] === "number" ? p.presence["joinedAt"] : Infinity);
const accountOf = (p: Peer) => p.by ?? (typeof p.presence["uid"] === "string" ? p.presence["uid"] : null);

/**
 * Top-left "people here" box: Online (you first, then the others in the order they arrived), then Offline (everyone
 * else who has the room: grey, picture half-faded). The admin wears the crown and can kick anyone (red, far right).
 */
function OnlinePanel({ account, channel, meta, code }: { account: Account; channel: NamedRoom; meta: MetaStore; code: string }) {
  const [open, setOpen] = useState(false);
  const [peers, setPeers] = useState<readonly Peer[]>(() => channel.peers());
  useEffect(() => channel.onPeers(({ peers: next, joined, left }) => {
    // Pose updates arrive many times a second; only arrivals and departures change this list.
    if (joined.length || left.length) setPeers(next);
  }), [channel]);
  const { admin, members } = useMeta(meta);
  const isAdmin = admin === account.id;

  const people = useMemo(() => {
    const viewers = peers.filter((p) => p.kind === "viewer");
    const me = viewers.find((p) => p.sameTab);
    const others = viewers.filter((p) => !p.sameTab).sort((a, b) => joinedAt(a) - joinedAt(b));
    return me ? [me, ...others] : others;
  }, [peers]);
  const ids = useMemo(() => people.flatMap((p) => accountOf(p) ?? []), [people]);
  const names = useUsernames(ids);
  const onlineIds = new Set(ids);
  const offline = members.filter((m) => !onlineIds.has(m.uid) && m.uid !== account.id);
  const count = Math.max(1, people.length);
  const [picked, setPicked] = useState<string | null>(null);
  const [kicking, setKicking] = useState<string | null>(null);
  const friends = useFriends(account);
  const kick = (uid: string) => <button type="button" className="pill red kick" onClick={(e) => { e.stopPropagation(); setKicking(uid); }}>Kick</button>;
  const sure = (uid: string, name: string) => kicking === uid && <div className="friend-actions">
    <span>Kick <span data-no-translate>{name}</span>?</span>
    <button type="button" className="pill grey" onClick={() => setKicking(null)}>No</button>
    <button type="button" className="pill red" onClick={() => { setKicking(null); void kickMember(code, uid).catch(() => {}); }}>Yes</button>
  </div>;

  return <div className="pointer-events-auto absolute left-4 top-4 z-20">
    <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`${count} ${count === 1 ? "person" : "people"} in this room`}
      data-hud-left className="hud-panel flex h-8 items-center gap-1.5 px-2.5 text-sm text-foreground sm:h-auto sm:gap-2 sm:px-3 sm:py-2 sm:text-base">
      <User className="h-4 w-4" aria-hidden />
      <span className="font-bold tabular-nums">{count}</span>
      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
    </button>
    {open && <div className="hud-panel room-people mt-2 max-h-80 w-64 overflow-y-auto py-1.5 text-sm text-foreground">
      <p className="room-people-title">Online</p>
      <ul>{people.map((p) => {
        const id = accountOf(p);
        const name = (id && names[id]) || (p.sameTab ? account.username : null) || "Player";
        const mine = p.sameTab || id === account.id;
        return <li key={p.peer} className="px-1.5">
          {/* The picture, the name, the admin's crown on the right of it; Kick (for the admin); tap for friend options. */}
          <div className="flex items-center gap-1">
            <button type="button" disabled={mine || !id} onClick={() => setPicked((v) => (v === p.peer ? null : p.peer))} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-white/5 disabled:cursor-default disabled:hover:bg-transparent">
              <Avatar uid={id ?? undefined} photo={mine ? account.photo : undefined} name={name} size={26} />
              <span className="min-w-0 truncate"><LiveName uid={id} fallback={name} />{mine && <span className="text-muted-foreground"> (you)</span>}</span>
              {id === admin && <Crown className="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-400" aria-label="Room admin" />}
            </button>
            {isAdmin && id && !mine && kick(id)}
          </div>
          {id && sure(id, name)}
          {picked === p.peer && id && !mine && <FriendActions account={account} uid={id} name={name} data={friends} />}
        </li>;
      })}</ul>
      {offline.length > 0 && <>
        <p className="room-people-title">Offline</p>
        <ul>{offline.map((m) => <li key={m.uid} className="px-1.5">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPicked((v) => (v === m.uid ? null : m.uid))} className="offline flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-white/5">
              <span className="opacity-50"><Avatar uid={m.uid} photo={m.photo} name={m.name || "?"} size={26} /></span>
              <LiveName uid={m.uid} fallback={m.name || "Player"} className="min-w-0 truncate text-muted-foreground" />
              {m.uid === admin && <Crown className="h-3.5 w-3.5 shrink-0 fill-yellow-400 text-yellow-400 opacity-60" aria-label="Room admin" />}
            </button>
            {isAdmin && kick(m.uid)}
          </div>
          {sure(m.uid, m.name || "Player")}
          {picked === m.uid && <FriendActions account={account} uid={m.uid} name={m.name || "Player"} data={friends} />}
        </li>)}</ul>
      </>}
    </div>}
  </div>;
}
