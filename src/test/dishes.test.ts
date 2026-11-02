import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { dishModel, hasPlate } from "@/game/dishes";
import { menuOf } from "@/game/food";

const meshes = (g: THREE.Object3D) => { let n = 0; g.traverse((o) => { if (o instanceof THREE.Mesh) n++; }); return n; };

describe("picking food up off its plate", () => {
  it("splits every plated item into what is eaten and the plate that stays on the tray", () => {
    for (const kind of ["burger", "pizza", "cafe", "fine"] as const) {
      for (const item of menuOf(kind).flatMap((s) => s.items)) {
        const all = meshes(dishModel(item.name)), food = meshes(dishModel(item.name, "food")), plate = meshes(dishModel(item.name, "plate"));
        expect(food).toBeGreaterThan(0);
        expect(food + plate).toBe(all);
        expect(hasPlate(item.name)).toBe(plate > 0);
      }
    }
  });
  it("leaves the saucer under a coffee behind", () => {
    const coffee = menuOf("cafe").flatMap((s) => s.items).find((i) => /latte|cappuccino|espresso|coffee/i.test(i.name))!;
    expect(hasPlate(coffee.name)).toBe(true);
  });
});
