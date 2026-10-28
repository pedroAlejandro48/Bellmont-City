import { afterEach, describe, expect, it } from "vitest";
import { claimUsername, currentAccount, readCloudSave, writeCloudSave } from "@/platform/account";

// In-memory stand-in for the claude.ai `db` and `user` capabilities.
function fakePlatform(viewer: string | null, docs: Record<string, Record<string, unknown>> = {}, busy = new Set<string>()) {
  const snap = (path: string) => ({ id: path.split("/").at(-1)!, exists: path in docs, data: () => docs[path] });
  const db = {
    doc: (path: string) => ({
      get: async () => snap(path),
      set: async (data: Record<string, unknown>) => {
        if (path.startsWith("data/users/") && !path.startsWith(`data/users/${viewer}/`)) throw { code: "invalid_argument" };
        docs[path] = data;
      },
      acquire: async () => ({ acquired: !busy.has(path) }),
    }),
    collection: (prefix: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        where: (field: string, _op: string, value: unknown) => { filters.push([field, value]); return query; },
        limit: () => query,
        get: async () => {
          const found = Object.keys(docs)
            .filter((p) => p.startsWith(`${prefix}/`) && p.split("/").length === prefix.split("/").length + 1)
            .filter((p) => filters.every(([f, v]) => docs[p]![f] === v))
            .map(snap);
          return { docs: found, empty: found.length === 0 };
        },
      };
      return query;
    },
  };
  const user = { id: async () => viewer, name: async () => "Pat" };
  window.claude = { use: (async (name: string) => (name === "db" ? db : name === "user" ? user : null)) as never };
  return docs;
}

afterEach(() => { delete window.claude; });

describe("player accounts", () => {
  it("has no account outside claude.ai or without a viewer id", async () => {
    expect(await currentAccount()).toBeNull();
    fakePlatform(null);
    expect(await currentAccount()).toBeNull();
  });

  it("reads the viewer's existing username", async () => {
    fakePlatform("u_1", { "players/u_1": { username: "pat" } });
    expect(await currentAccount()).toMatchObject({ id: "u_1", displayName: "Pat", username: "pat" });
  });

  it("claims a free username and refuses one another player owns", async () => {
    const docs = fakePlatform("u_1", { "players/u_2": { username: "taken" } });
    const account = (await currentAccount())!;
    expect(account.username).toBeNull();
    expect(await claimUsername(account, "taken")).toBe("taken");
    expect(await claimUsername(account, "pat")).toBe("claimed");
    expect(docs["players/u_1"]).toMatchObject({ username: "pat" });
  });

  it("reports a name another viewer is mid-claim on as busy", async () => {
    fakePlatform("u_1", {}, new Set(["claims/pat"]));
    expect(await claimUsername((await currentAccount())!, "pat")).toBe("busy");
  });

  it("round-trips the save in the viewer's private subtree", async () => {
    const docs = fakePlatform("u_1");
    const account = (await currentAccount())!;
    expect(await readCloudSave(account)).toBeNull();
    await writeCloudSave(account, { health: 80 }, "2026-10-28T00:00:00.000Z");
    expect(Object.keys(docs)).toContain("data/users/u_1/save");
    expect(await readCloudSave(account)).toEqual({ data: { health: 80 }, updated_at: "2026-10-28T00:00:00.000Z" });
  });
});
