import { describe, expect, it } from "vitest";
import { makeNpcLink } from "@/multiplayer/npcLink";
import { legFromPosition, cornerPoint, legEnd } from "@/game/pedestrians";
import type { NamedRoom, Peer } from "@/platform/realtime";

/** A pretend room: each tab's presence, as every tab sees it. */
function room() {
  const presence = new Map<string, Record<string, unknown>>();
  const tab = (id: string): NamedRoom => ({
    name: "TEST",
    presence: async (patch) => { presence.set(id, { ...(presence.get(id) ?? {}), ...patch }); },
    peers: () => [...presence.entries()].map(([peer, p]): Peer => ({ peer, by: peer, isMe: peer === id, sameTab: peer === id, kind: "viewer", presence: p })),
    onPeers: () => () => {},
    connected: () => true,
    leave: async () => { presence.delete(id); },
  });
  return { tab, presence };
}

describe("NPCs shared in a room", () => {
  it("are run by whoever joined first; the others see that player's NPCs", async () => {
    const r = room();
    const a = r.tab("a"), b = r.tab("b");
    await a.presence({ joinedAt: 100 }); await b.presence({ joinedAt: 200 });
    const la = makeNpcLink(a), lb = makeNpcLink(b);
    expect(la.isHost()).toBe(true); expect(lb.isHost()).toBe(false);
    la.publish({ list: [[0, 10, 20, 0.5, 1.3, 0, -1, 0, 0, 0]] });
    await Promise.resolve();
    expect(lb.latest()?.list[0]?.[1]).toBe(10);
    expect(la.latest()).toBeNull();
  });
  it("passes a guest's hits to the host once each, and hands over when the host leaves", async () => {
    const r = room();
    const a = r.tab("a"), b = r.tab("b");
    await a.presence({ joinedAt: 100 }); await b.presence({ joinedAt: 200 });
    const la = makeNpcLink(a), lb = makeNpcLink(b);
    expect(la.takeHits()).toEqual([]);
    lb.sendHit(3, [1, 0]);
    await Promise.resolve();
    expect(la.takeHits()).toEqual([{ id: 3, direction: [1, 0] }]);
    expect(la.takeHits()).toEqual([]);
    await a.leave();
    expect(lb.isHost()).toBe(true);
  });
  it("picks up someone's walk from where they are when taking over", () => {
    const leg = legFromPosition(cornerPoint(1, 1, 0)[0] - 5, cornerPoint(1, 1, 0)[1], Math.PI / 2);
    expect(leg.kind).toBe("ring");
    expect(legEnd(leg)).toEqual(cornerPoint(1, 1, 0));
  });
});
