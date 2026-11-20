import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { GameState } from "@/game/state";
import { putGround, saveApt, saveHome, takeGround, watchApts, watchGround, watchHomes, type GroundDoc } from "@/platform/roomWorld";

type Item = GameState["groundItems"][number];
const SHARED_ID0 = 1_000_000;

/**
 * Keeps a room's world for good (platform/roomWorld): the things put down anywhere are one shared list — everyone sees
 * them, anyone picks them up, they stay after whoever put them down has gone —; apartment kitchens and homes are kept
 * (and used for floors whose players aren't here).
 */
export function RoomWorldSync({ state, code, uid }: { state: GameState; code: string; uid: string }) {
  // Ground: shared documents ↔ the local list (ids: shared ones numbered from SHARED_ID0).
  const m = useRef({ docOf: new Map<number, string>(), idOf: new Map<string, number>(), shared: new Map<string, Item>(), next: SHARED_ID0, pending: new Set<number>(), gone: new Set<string>(), seq: 0, ready: false });
  useEffect(() => {
    const s = m.current;
    // (In a room, what's on the ground is the room's: anything from this player's own save of it is left out.)
    state.groundItems = [];
    s.ready = false;
    const stop = watchGround(code, (docs) => {
      // (Picked up here since the last look: taken out of the room now, before this list could bring it back.)
      if (s.ready) {
        const local = new Set(state.groundItems.map((g) => g.id));
        for (const [docId, it] of s.shared) if (!local.has(it.id) && !s.gone.has(docId)) { s.gone.add(docId); void takeGround(code, docId).catch(() => {}); }
      }
      const seen = new Set<string>();
      for (const d of docs) {
        seen.add(d.id);
        if (s.gone.has(d.id)) continue;
        let id = s.idOf.get(d.id);
        if (id === undefined) { id = s.next++; s.idOf.set(d.id, id); s.docOf.set(id, d.id); }
        s.pending.delete(id);
        const it: Item = { id, kind: d.kind as Item["kind"], x: d.x, z: d.z, ...(d.y !== undefined ? { y: d.y } : {}), yaw: d.yaw, at: 0, ...(d.contents ? { contents: d.contents as NonNullable<Item["contents"]> } : {}) };
        s.shared.set(d.id, it);
      }
      for (const docId of [...s.shared.keys()]) if (!seen.has(docId) || s.gone.has(docId)) s.shared.delete(docId);
      for (const docId of [...s.gone]) if (!seen.has(docId)) s.gone.delete(docId);
      // The list: the room's things, and what this player has just put down that's on its way.
      const mine = state.groundItems.filter((g) => s.pending.has(g.id));
      state.groundItems = [...s.shared.values(), ...mine];
      s.ready = true;
    });
    return () => { stop(); state.groundItems = []; };
  }, [state, code]);

  // Kitchens and homes the room keeps.
  useEffect(() => {
    state.roomKept = { apts: [], homes: [] };
    const saved = new Map<string, { n: number; at: number; doc: { key: string; n: number; j: string } | null }>();
    state.aptPersist = (docs) => {
      const now = Date.now();
      for (const d of docs) {
        const was = saved.get(d.key);
        if (was && was.n >= d.n) continue;
        // (A kitchen being used changes often: kept at most every 1.5 s, the latest always.)
        if (was && now - was.at < 1500) { was.doc = d; continue; }
        saved.set(d.key, { n: d.n, at: now, doc: null });
        void saveApt(code, d).catch(() => {});
      }
    };
    const flush = window.setInterval(() => {
      for (const [, v] of saved) if (v.doc) { const d = v.doc; v.doc = null; v.n = d.n; v.at = Date.now(); void saveApt(code, d).catch(() => {}); }
    }, 1600);
    const stopA = watchApts(code, (docs) => { if (state.roomKept) state.roomKept.apts = docs; for (const d of docs) { const w = saved.get(d.key); if (!w || w.n < d.n) saved.set(d.key, { n: d.n, at: 0, doc: w?.doc ?? null }); } });
    const stopH = watchHomes(code, (homes) => { if (state.roomKept) state.roomKept.homes = homes.filter((h) => h.uid !== uid).map(({ b, floor, locked }) => ({ b, floor, locked })); });
    return () => { stopA(); stopH(); window.clearInterval(flush); state.aptPersist = null; state.roomKept = null; };
  }, [state, code, uid]);

  const lastHome = useRef<string | null>(null), tick = useRef(0);
  useFrame((_, dt) => {
    tick.current += dt;
    if (tick.current < 0.25) return;
    tick.current = 0;
    const s = m.current;
    // Your home (and whether its door is locked), kept by the room.
    const home = state.life.home, h = home ? { b: home.building, floor: home.floor, locked: !home.unlocked } : null, hk = JSON.stringify(h);
    if (hk !== lastHome.current) { lastHome.current = hk; void saveHome(code, uid, h).catch(() => {}); }
    if (!s.ready) return;
    // Put down here: to the room. Picked up here: out of the room.
    for (const g of state.groundItems) {
      if (s.docOf.has(g.id) || s.pending.has(g.id)) continue;
      const docId = `${uid}-${Date.now().toString(36)}-${(s.seq++).toString(36)}`;
      const r3 = (n: number) => Math.round(n * 1000) / 1000;
      const d: GroundDoc = { id: docId, kind: g.kind, x: r3(g.x), z: r3(g.z), ...(g.y !== undefined ? { y: r3(g.y) } : {}), yaw: r3(g.yaw), ...(g.contents ? { contents: g.contents } : {}), by: uid, at: Date.now() };
      // (Its local number becomes the shared one's, so nothing flickers.)
      s.idOf.set(docId, g.id); s.docOf.set(g.id, docId); s.pending.add(g.id);
      void putGround(code, d).catch(() => { s.pending.delete(g.id); });
    }
    const here = new Set(state.groundItems.map((g) => g.id));
    for (const [docId, it] of s.shared) if (!here.has(it.id)) { s.shared.delete(docId); s.gone.add(docId); void takeGround(code, docId).catch(() => {}); }
  });
  return null;
}
