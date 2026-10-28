import { describe, expect, it } from "vitest";
import { stripGamePreviewTags } from "@/lib/game-preview-tags";

describe("3D preview source labels", () => {
  it("removes injected DOM attributes from all game scene elements", () => {
    const source = '<group data-tsd-source="src/game/Player.tsx:1:1"><mesh data-tsd-source="src/game/Player.tsx:2:1" castShadow /></group>';
    expect(stripGamePreviewTags(source, "/dev-server/src/game/Player.tsx")).toBe('<group><mesh castShadow /></group>');
  });
  it("preserves DOM source inspection outside the game directory", () => {
    const source = '<div data-tsd-source="src/routes/index.tsx:1:1" />';
    expect(stripGamePreviewTags(source, "/dev-server/src/routes/index.tsx")).toBe(source);
  });
  it("handles query strings and preserves actual game properties", () => {
    expect(stripGamePreviewTags("<mesh data-tsd-source='scene:1:1' position={[1, 2, 3]} />", "/dev-server/src/game/Scooter.tsx?v=1")).toBe("<mesh position={[1, 2, 3]} />");
  });
});