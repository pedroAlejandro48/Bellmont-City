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

export function RoomClockSync({ state, channel, code }: { state: GameState; channel: NamedRoom; code: string }) {
  const clock = useRef<RoomClock | null>(null), kept = useRef(0), sentAsleep = useRef<boolean | null>(null), skipped = useRef(0);
  useEffect(() => watchRoomClock(code, (c) => { clock.current = c; }), [code]);
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
    // Following the kept clock.
    const c = clock.current;
    if (c && !amHost) {
      const want = c.base + (now - c.at) / 1000;
      if (Math.abs(state.elapsed - want) > 2) state.elapsed = want;
    }
    // Everyone asleep (at night): on to 6 AM — the host moves the clock, everyone follows it.
    const viewers = peers.filter((p) => p.kind === "viewer" && p.presence["away"] !== true);
    const others = viewers.filter((p) => !p.sameTab), sleeping = others.filter((p) => p.presence["asleep"] === true).length + (asleep ? 1 : 0);
    state.sleepWait = asleep ? { asleep: sleeping, total: others.length + 1 } : null;
    if (amHost && asleep && sleeping === others.length + 1 && canSleepAt(timeInfo(state.elapsed).hours) && now - skipped.current > 10_000) {
      skipped.current = now;
      state.elapsed = wakeElapsed(state.elapsed);
      kept.current = now;
      void setRoomClock(code, { base: state.elapsed, at: now }).catch(() => {});
    }
    // The host keeps the clock.
    if (amHost && now - kept.current > KEEP_MS) { kept.current = now; void setRoomClock(code, { base: state.elapsed, at: now }).catch(() => {}); }
  });
  return null;
}
