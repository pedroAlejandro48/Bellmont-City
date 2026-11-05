import { describe, expect, it } from "vitest";
import { DEFAULT_SAVE } from "@/game/config";
import { createState, toast } from "@/game/state";

describe("notifications", () => {
  it("the same one again replaces the one showing; different ones stack", () => {
    const s = createState(DEFAULT_SAVE);
    toast(s, "Saved"); toast(s, "Saved", "info", "again"); toast(s, "Level up", "level");
    expect(s.toasts.map((t) => t.title)).toEqual(["Saved", "Level up"]);
    expect(s.toasts[0]!.body).toBe("again");
  });
});
