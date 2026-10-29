import { describe, expect, it } from "vitest";
import { lockEmail, unlockEmail } from "@/platform/emailLock";

describe("password-locked email for username sign-in", () => {
  it("opens with the right password only", async () => {
    const lock = await lockEmail("pat@example.com", "correct horse");
    expect(JSON.stringify(lock)).not.toContain("pat@example.com");
    expect(await unlockEmail(lock, "correct horse")).toBe("pat@example.com");
    expect(await unlockEmail(lock, "wrong")).toBeNull();
  });

  it("uses a fresh salt each time", async () => {
    const [a, b] = await Promise.all([lockEmail("pat@example.com", "pw"), lockEmail("pat@example.com", "pw")]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.cipher).not.toBe(b.cipher);
  });
});
