import { describe, it, expect } from "vitest";
import { usernameSchema } from "@/lib/usernames";

describe("unique username normalization", () => {
  it("uses the same canonical username for case variants", () => {
    expect(usernameSchema.parse(" Pedro_123 ")).toBe("pedro_123");
    expect(usernameSchema.parse("PEDRO_123")).toBe(usernameSchema.parse("pedro_123"));
  });
  it("rejects characters that cannot be stored as usernames", () => {
    expect(usernameSchema.safeParse("player@example.com").success).toBe(false);
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("a".repeat(25)).success).toBe(false);
  });
});