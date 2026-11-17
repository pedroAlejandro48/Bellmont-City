import { describe, expect, it } from "vitest";
import { signText } from "@/game/InteractionPrompt";

describe("signs say only the key", () => {
  it("keeps just E or Q, and the few words asked for", () => {
    expect(signText(undefined)).toBe("E");
    expect(signText("E  OPEN")).toBe("E");
    expect(signText("Q  PUT THE PLATE HERE")).toBe("Q");
    expect(signText("E  CALL ELEVATOR")).toBe("E");
    expect(signText("E  PAY $8.30")).toBe("E");
    expect(signText("E  UNLOCKED")).toBe("E  UNLOCKED");
    expect(signText("E  LOCKED")).toBe("E  LOCKED");
    expect(signText("LOCKED")).toBe("LOCKED");
    expect(signText("E  LOCK")).toBe("E  LOCK");
    expect(signText("COMING")).toBe("COMING");
    expect(signText("E  PICK UP")).toBe("E  PICK UP");
    expect(signText("E  DROP OFF")).toBe("E  DROP OFF");
  });
  it("hides signs that are only words", () => {
    for (const t of ["TAKE A BASKET FIRST", "HANDS FULL", "SOMEONE'S THERE", "ELEVATOR FULL", "CLOSED", "BASKET FULL"]) expect(signText(t)).toBeNull();
  });
});
