// A room's clock (platform/rooms RoomClock): time passes in a room only while someone's in it. The room's host keeps
// its clock (the game time now, and when, every 15 s and on leaving); whoever comes into an empty room starts from
// where it stood. Everyone in it follows the kept clock (any drift, or a jump, is caught up). Sleeping: each player
// says whether they're asleep (presence `asleep`); when everyone in the room is, the host moves the clock on to the
// next 6 AM — and everyone wakes up together.
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { serverNow } from "@/lib/serverTime";
import { timeInfo } from "@/game/config";
import { canSleepAt, wakeElapsed } from "@/game/needs";
import type { GameState } from "@/game/state";
import { setRoomClock, watchRoomClock, type RoomClock } from "@/platform/rooms";
import type { NamedRoom } from "@/platform/realtime";
import { pickHost } from "./host";

const KEEP_MS = 15_000;
/** Everyone asleep: this long on the Zzz screen before the clock jumps to morning. */
const ALL_ASLEEP_MS = 3_000;

export function RoomClockSync({ state, channel, code }: { state: GameState; channel: NamedRoom; code: string }) {
  const clock = useRef<RoomClock | null>(null), heard = useRef<RoomClock | null>(null), kept = useRef(0), sentAsleep = useRef<boolean | null>(null), skipped = useRef(0), allSince = useRef<number | null>(null);
  // (Only a newer clock than the one followed: an empty room's old clock never runs on over the time it was empty.)
  useEffect(() => watchRoomClock(code, (c) => { if (!clock.current) heard.current = c; else if (c.at >= clock.current.at) clock.current = c; }), [code]);
  // Leaving (the page closing, or out to the menu) as the last one in: the clock stops where it is.
  useEffect(() => {
    const keep = () => {
      const others = channel.peers().filter((p) => p.kind === "viewer" && !p.sameTab && p.presence["away"] !== true).length;
      if (others === 0) void setRoomClock(code, { base: state.elapsed, at: serverNow() }).catch(() => {});
    };
    window.addEventListener("pagehide", keep);
    return () => { window.removeEventListener("pagehide", keep); keep(); };
  }, [code, channel, state]);
  useFrame(() => {
    const now = serverNow(), peers = channel.peers(), host = pickHost(peers), amHost = !!host?.sameTab;
    // Asleep or not, for everyone to see.
    const asleep = !!state.asleep;
    if (asleep !== sentAsleep.current) { sentAsleep.current = asleep; void channel.presence({ asleep }).catch(() => {}); }
    // Everyone (the host too) reads the time straight off the room's clock — so every timer (a pot on the stove, the
    // time of day) is exactly the same for all, however fast each device draws. (Till the kept one comes in: from here.)
    if (!clock.current) {
      // Arriving: the time as the game started it (an empty room's where it stood) — kept from now, if no one else
      // is here to keep it.
      const others = peers.some((p) => p.kind === "viewer" && !p.sameTab && p.presence["away"] !== true);
      clock.current = others && heard.current ? heard.current : { base: state.elapsed, at: now };
      if (amHost) { kept.current = now; void setRoomClock(code, clock.current).catch(() => {}); }
    }
    const c = clock.current;
    state.elapsed = c.base + (now - c.at) / 1000;
    // Everyone asleep (at night): on to 6 AM — the host moves the clock, everyone follows it.
    const viewers = peers.filter((p) => p.kind === "viewer" && p.presence["away"] !== true);
    const others = viewers.filter((p) => !p.sameTab), sleeping = others.filter((p) => p.presence["asleep"] === true).length + (asleep ? 1 : 0);
    state.sleepWait = asleep ? { asleep: sleeping, total: others.length + 1 } : null;
    // (Once the last one's asleep, everyone stays on the Zzz screen another ALL_ASLEEP_MS before the morning comes —
    // the last to lie down too, instead of waking the moment they're asleep.)
    const allAsleep = amHost && asleep && sleeping === others.length + 1 && canSleepAt(timeInfo(state.elapsed).hours);
    if (!allAsleep) allSince.current = null; else allSince.current ??= now;
    if (allAsleep && now - allSince.current! >= ALL_ASLEEP_MS && now - skipped.current > 10_000) {
      allSince.current = null;
      skipped.current = now;
      state.elapsed = wakeElapsed(state.elapsed);
      kept.current = now;
      clock.current = { base: state.elapsed, at: now };
      void setRoomClock(code, clock.current).catch(() => {});
    }
    // The host keeps the clock.
    if (amHost && now - kept.current > KEEP_MS) { kept.current = now; clock.current = { base: state.elapsed, at: now }; void setRoomClock(code, clock.current).catch(() => {}); }
  });
  return null;
}
