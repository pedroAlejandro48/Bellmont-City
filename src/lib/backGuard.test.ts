// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { guardBackButton, onBack } from "./backGuard";

describe("back button", () => {
  it("closes the newest open thing first, then asks before leaving", () => {
    guardBackButton();
    window.dispatchEvent(new Event("pointerdown"));
    const game = vi.fn(), chat = vi.fn();
    const offGame = onBack(game), offChat = onBack(chat);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(chat).toHaveBeenCalledTimes(1); expect(game).not.toHaveBeenCalled();
    offChat();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(game).toHaveBeenCalledTimes(1);
    offGame();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(document.querySelector(".back-note")?.textContent).toBe("Press back again to exit");
  });
});
