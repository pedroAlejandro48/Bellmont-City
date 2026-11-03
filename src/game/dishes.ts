// Every menu item as a small 3D model (base on the origin, front toward +z), built from simple shapes so each
// reads as what it is: a burger, fries in their carton, a pizza, nigiri on rice, a latte, a bottle of water.
import * as THREE from "three";

type Part = { dish?: boolean; geo: THREE.BufferGeometry; color: string; pos?: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number]; rough?: number; metal?: number; opacity?: number };

const geoCache = new Map<string, THREE.BufferGeometry>();
const g = (key: string, make: () => THREE.BufferGeometry) => { let x = geoCache.get(key); if (!x) { x = make(); geoCache.set(key, x); } return x; };
const cyl = (rt: number, rb: number, h: number, seg = 20) => g(`c${rt}:${rb}:${h}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const box = (w: number, h: number, d: number) => g(`b${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
const sph = (r: number, top = false) => g(`s${r}:${top}`, () => new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, top ? Math.PI / 2 : Math.PI));
const tor = (r: number, t: number, arc = Math.PI * 2) => g(`t${r}:${t}:${arc}`, () => new THREE.TorusGeometry(r, t, 8, 18, arc));
const cap = (r: number, l: number) => g(`p${r}:${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 8));

const matCache = new Map<string, THREE.Material>();
function mat(color: string, rough = 0.7, metal = 0, opacity = 1) {
  const key = `${color}:${rough}:${metal}:${opacity}`;
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }); matCache.set(key, m); }
  return m;
}
/** Which parts to build: everything, only the food (what is picked up to eat), or only the plate it sat on. */
export type DishPart = "all" | "food" | "plate";
let building: DishPart = "all";
function build(parts: Part[]) {
  const group = new THREE.Group();
  for (const p of parts) {
    if ((building === "food" && p.dish) || (building === "plate" && !p.dish)) continue;
    const mesh = new THREE.Mesh(p.geo, mat(p.color, p.rough ?? 0.7, p.metal ?? 0, p.opacity ?? 1));
    if (p.pos) mesh.position.set(...p.pos);
    if (p.rot) mesh.rotation.set(...p.rot);
    if (p.scale) mesh.scale.set(...p.scale);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

const PLATE = "#f5f3ee", BUN = "#d99a4e", BUN_TOP = "#c98638", PATTY = "#5a3320", CHEESE = "#f6c445", LETTUCE = "#5fae3c", TOMATO = "#d8422f";
const plate = (r = 0.11): Part => ({ dish: true, geo: cyl(r, r * 0.85, 0.012, 28), color: PLATE, pos: [0, 0.006, 0], rough: 0.3 });
const bowl = (r = 0.075, h = 0.055, color = "#f7f4ee"): Part => ({ geo: cyl(r, r * 0.6, h, 24), color, pos: [0, h / 2, 0], rough: 0.35 });

function burger(kind: "classic" | "double" | "bacon" | "chicken" | "veggie") {
  const parts: Part[] = [{ geo: cyl(0.052, 0.05, 0.022), color: BUN, pos: [0, 0.011, 0] }];
  let y = 0.022;
  const layer = (geo: THREE.BufferGeometry, color: string, h: number, rot?: [number, number, number]) => { parts.push({ geo, color, pos: [0, y + h / 2, 0], ...(rot ? { rot } : {}) }); y += h; };
  layer(cyl(0.056, 0.056, 0.006, 12), LETTUCE, 0.006);
  if (kind === "chicken") layer(cyl(0.055, 0.055, 0.018), "#d39a42", 0.018);
  else if (kind === "veggie") layer(cyl(0.052, 0.052, 0.018), "#7c8b3a", 0.018);
  else layer(cyl(0.054, 0.054, 0.016), PATTY, 0.016);
  layer(box(0.09, 0.004, 0.09), CHEESE, 0.004, [0, Math.PI / 4, 0]);
  if (kind === "double") { layer(cyl(0.054, 0.054, 0.016), PATTY, 0.016); layer(box(0.09, 0.004, 0.09), CHEESE, 0.004, [0, 0.2, 0]); }
  if (kind === "bacon") { for (const dx of [-0.02, 0.02]) parts.push({ geo: box(0.1, 0.005, 0.016), color: "#9b3a24", pos: [dx * 0, y + 0.003, dx], rot: [0, dx * 10, 0] }); y += 0.006; parts.push({ geo: cyl(0.045, 0.045, 0.004), color: "#5b2410", pos: [0, y + 0.002, 0] }); y += 0.004; }
  layer(cyl(0.05, 0.05, 0.005), TOMATO, 0.005);
  parts.push({ geo: sph(0.054, true), color: BUN_TOP, pos: [0, y, 0], scale: [1, 0.62, 1] });
  // Sesame seeds on top.
  for (let i = 0; i < 7; i++) { const a = i * 2.4; parts.push({ geo: sph(0.004), color: "#fff3cf", pos: [Math.cos(a) * 0.028, y + 0.031, Math.sin(a) * 0.028], scale: [1.4, 0.6, 0.8] }); }
  return build(parts);
}
function friesCarton(color = "#d32f2f", cheese = false) {
  const parts: Part[] = [{ geo: cyl(0.045, 0.034, 0.09, 4), color, pos: [0, 0.045, 0], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.62] }];
  for (let i = 0; i < 16; i++) {
    const x = ((i % 4) - 1.5) * 0.014, z = (Math.floor(i / 4) - 1.5) * 0.008;
    parts.push({ geo: box(0.007, 0.07 + (i % 3) * 0.01, 0.007), color: "#f2c14e", pos: [x, 0.1 + (i % 3) * 0.005, z], rot: [(i % 2 - 0.5) * 0.25, 0, (i % 3 - 1) * 0.18] });
  }
  if (cheese) parts.push({ geo: sph(0.034, true), color: "#f39c12", pos: [0, 0.128, 0], scale: [1, 0.35, 0.65], rough: 0.4 });
  return build(parts);
}
function onionRings() {
  const parts: Part[] = [{ geo: box(0.13, 0.03, 0.09), color: "#c62828", pos: [0, 0.015, 0] }];
  for (let i = 0; i < 5; i++) parts.push({ geo: tor(0.024, 0.008), color: "#d9a44a", pos: [(i - 2) * 0.022, 0.038 + (i % 2) * 0.01, (i % 2) * 0.012], rot: [Math.PI / 2 - 0.4, 0, 0.3 * i] });
  return build(parts);
}
function nuggets() {
  const parts: Part[] = [{ geo: box(0.12, 0.04, 0.08), color: "#c62828", pos: [0, 0.02, 0] }];
  for (let i = 0; i < 6; i++) parts.push({ geo: sph(0.016), color: "#cf9141", pos: [((i % 3) - 1) * 0.034, 0.048, (Math.floor(i / 3) - 0.5) * 0.03], scale: [1.3, 0.7, 1] });
  return build(parts);
}
function cupWithLid(color: string, h = 0.15, straw = true, dome = false) {
  const parts: Part[] = [
    { geo: cyl(0.044, 0.034, h), color: "#ffffff", pos: [0, h / 2, 0], rough: 0.5 },
    { geo: cyl(0.0435, 0.039, h * 0.4), color, pos: [0, h * 0.55, 0], rough: 0.5 },
    { geo: dome ? sph(0.046, true) : cyl(0.047, 0.047, 0.01), color: "#f2f2f2", pos: [0, h + (dome ? 0 : 0.005), 0], scale: dome ? [1, 0.5, 1] : [1, 1, 1], rough: 0.2, opacity: dome ? 0.6 : 1 },
  ];
  if (straw) parts.push({ geo: cyl(0.0035, 0.0035, 0.09, 8), color: "#e53935", pos: [0.01, h + 0.04, 0], rot: [0, 0, -0.12] });
  return build(parts);
}
function coffee(kind: "espresso" | "americano" | "cappuccino" | "latte" | "mocha" | "coldbrew") {
  if (kind === "coldbrew") return build([
    { geo: cyl(0.038, 0.032, 0.13), color: "#e8f2f6", pos: [0, 0.065, 0], rough: 0.05, opacity: 0.4 },
    { geo: cyl(0.034, 0.03, 0.105), color: "#3a2112", pos: [0, 0.056, 0], rough: 0.2 },
    { geo: box(0.02, 0.02, 0.02), color: "#eaf6fb", pos: [0.01, 0.1, 0.005], rough: 0.05, opacity: 0.7 },
  ]);
  if (kind === "latte") return build([
    { geo: cyl(0.036, 0.03, 0.12), color: "#eef5f7", pos: [0, 0.06, 0], rough: 0.05, opacity: 0.45 },
    { geo: cyl(0.032, 0.028, 0.06), color: "#a0673f", pos: [0, 0.035, 0] },
    { geo: cyl(0.033, 0.032, 0.045), color: "#eadbc5", pos: [0, 0.088, 0] },
  ]);
  const small = kind === "espresso";
  const r = small ? 0.026 : 0.045, h = small ? 0.04 : 0.07;
  const top = kind === "cappuccino" ? "#efe3cf" : kind === "mocha" ? "#5a3320" : kind === "espresso" ? "#4a2a14" : "#2c180c";
  return build([
    { dish: true, geo: cyl(r + 0.03, r + 0.02, 0.008, 24), color: "#f4f1ea", pos: [0, 0.004, 0], rough: 0.3 },
    { geo: cyl(r, r * 0.72, h, 24), color: "#f6f3ec", pos: [0, 0.008 + h / 2, 0], rough: 0.3 },
    { geo: cyl(r * 0.94, r * 0.94, 0.004, 24), color: top, pos: [0, 0.006 + h, 0] },
    { geo: tor(h * 0.25, 0.005, Math.PI), color: "#f6f3ec", pos: [r + 0.008, 0.008 + h * 0.55, 0], rot: [0, 0, -Math.PI / 2] },
    ...(kind === "mocha" ? [{ geo: sph(r * 0.8, true), color: "#fbf6ee", pos: [0, 0.006 + h, 0] as [number, number, number], scale: [1, 0.5, 1] as [number, number, number] }] : []),
  ]);
}
function pizza(top: string[], cheese = "#f6d26b") {
  const parts: Part[] = [
    { dish: true, geo: cyl(0.17, 0.17, 0.012, 32), color: "#8a5a2b", pos: [0, 0.006, 0] },
    { geo: cyl(0.15, 0.15, 0.014, 32), color: "#d79a4c", pos: [0, 0.018, 0] },
    { geo: cyl(0.135, 0.135, 0.006, 32), color: "#c0392b", pos: [0, 0.026, 0] },
    { geo: cyl(0.13, 0.13, 0.005, 32), color: cheese, pos: [0, 0.03, 0], rough: 0.5 },
  ];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39996, r = 0.03 + (i % 5) * 0.022, color = top[i % top.length]!;
    parts.push({ geo: cyl(0.012, 0.012, 0.004, 12), color, pos: [Math.cos(a) * r, 0.034, Math.sin(a) * r] });
  }
  return build(parts);
}
function nigiri(fish: string, pairs = 2) {
  const parts: Part[] = [{ dish: true, geo: box(0.16, 0.012, 0.09), color: "#2b2b2b", pos: [0, 0.006, 0], rough: 0.4 }];
  for (let i = 0; i < pairs; i++) {
    const x = (i - (pairs - 1) / 2) * 0.05;
    parts.push({ geo: cap(0.012, 0.03), color: "#fbfaf4", pos: [x, 0.025, 0], rot: [Math.PI / 2, 0, 0] });
    parts.push({ geo: box(0.028, 0.006, 0.058), color: fish, pos: [x, 0.04, 0], rough: 0.35 });
  }
  return build(parts);
}
function roll() {
  const parts: Part[] = [{ dish: true, geo: box(0.2, 0.012, 0.07), color: "#f1ece0", pos: [0, 0.006, 0], rough: 0.3 }];
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.03;
    parts.push({ geo: cyl(0.016, 0.016, 0.026, 16), color: "#1e2a1e", pos: [x, 0.026, 0], rot: [0, 0, Math.PI / 2] });
    parts.push({ geo: cyl(0.0125, 0.0125, 0.027, 16), color: "#fbfaf4", pos: [x, 0.026, 0], rot: [0, 0, Math.PI / 2] });
    parts.push({ geo: box(0.026, 0.006, 0.03), color: "#7cb342", pos: [x, 0.044, 0] });
  }
  return build(parts);
}
function sashimi() {
  const parts: Part[] = [{ dish: true, geo: cyl(0.12, 0.11, 0.014, 6), color: "#1a1a1a", pos: [0, 0.007, 0], rough: 0.3 }];
  const colors = ["#f07c5a", "#c62828", "#f5b7a0", "#f07c5a", "#c62828", "#f5b7a0", "#f07c5a", "#c62828"];
  colors.forEach((c, i) => parts.push({ geo: box(0.05, 0.01, 0.024), color: c, pos: [((i % 4) - 1.5) * 0.045, 0.02, (Math.floor(i / 4) - 0.5) * 0.04], rot: [0.25, 0, 0], rough: 0.3 }));
  parts.push({ geo: sph(0.012), color: "#9ccc65", pos: [0.08, 0.02, 0.06] });
  return build(parts);
}
function ramen() {
  return build([
    { geo: cyl(0.085, 0.05, 0.07, 28), color: "#1f1f1f", pos: [0, 0.035, 0], rough: 0.35 },
    { geo: cyl(0.08, 0.08, 0.004, 28), color: "#e9c99a", pos: [0, 0.066, 0], rough: 0.3 },
    { geo: cyl(0.03, 0.03, 0.006, 16), color: "#f2e1b8", pos: [0.025, 0.07, -0.02] },
    { geo: sph(0.02), color: "#fdfaf0", pos: [-0.03, 0.072, 0.02], scale: [1, 0.6, 1.3] },
    { geo: sph(0.011), color: "#f4a742", pos: [-0.03, 0.08, 0.02], scale: [1, 0.4, 1] },
    { geo: box(0.05, 0.004, 0.04), color: "#7a4a2b", pos: [0.02, 0.071, 0.035] },
    { geo: box(0.004, 0.003, 0.24), color: "#c9a26b", pos: [0.05, 0.08, 0], rot: [0.1, 0.3, 0] },
  ]);
}
function bowlOf(fill: string, extra: Part[] = []) {
  return build([bowl(0.065, 0.05, "#2c2c2c"), { geo: cyl(0.06, 0.06, 0.004, 24), color: fill, pos: [0, 0.048, 0] }, ...extra]);
}
function plateOf(parts: Part[], r = 0.11) { return build([plate(r), ...parts]); }

/** A model for any menu item (falls back to a covered plate): all of it, just the food, or just its plate. */
/** Food is drawn this much bigger than life, so it reads clearly from the game's camera. */
export const FOOD_SCALE = 2;
export function dishModel(name: string, part: DishPart = "all"): THREE.Group {
  building = part;
  try {
    // The item, scaled up inside an outer group (callers set the outer group's own scale and position).
    const inner = dishOf(name), outer = new THREE.Group();
    inner.scale.setScalar(FOOD_SCALE);
    outer.add(inner);
    return outer;
  } finally { building = "all"; }
}
/** Whether an item comes on a plate (or saucer, board) that stays behind when it is picked up. */
export function hasPlate(name: string) { return (dishModel(name, "plate").children[0]?.children.length ?? 0) > 0; }
function dishOf(name: string): THREE.Group {
  switch (name) {
    // Big Bell Burgers
    case "Classic Bell": return burger("classic");
    case "Double Bell": return burger("double");
    case "Bacon BBQ": return burger("bacon");
    case "Crispy Chicken": return burger("chicken");
    case "Veggie Bell": return burger("veggie");
    case "Fries": return friesCarton();
    case "Cheese Fries": return friesCarton("#d32f2f", true);
    case "Onion Rings": return onionRings();
    case "Nuggets (6)": return nuggets();
    case "Vanilla Shake": return cupWithLid("#f3e6c4", 0.16, true, true);
    case "Chocolate Shake": return cupWithLid("#6d4c41", 0.16, true, true);
    case "Strawberry Shake": return cupWithLid("#f48fb1", 0.16, true, true);
    case "Fountain Soda": return cupWithLid("#e53935", 0.15, true);
    // Morning Bell Café
    case "Espresso": return coffee("espresso");
    case "Americano": return coffee("americano");
    case "Cappuccino": return coffee("cappuccino");
    case "Latte": return coffee("latte");
    case "Mocha": return coffee("mocha");
    case "Cold Brew": return coffee("coldbrew");
    case "Butter Croissant": return plateOf([{ geo: tor(0.04, 0.02, Math.PI * 1.2), color: "#d9963e", pos: [0, 0.03, 0], rot: [Math.PI / 2, 0, 0.9], scale: [1, 1, 1.2] }], 0.09);
    case "Blueberry Muffin": return plateOf([{ geo: cyl(0.032, 0.026, 0.045, 18), color: "#e8d3b0", pos: [0, 0.035, 0] }, { geo: sph(0.042, true), color: "#c88b4a", pos: [0, 0.057, 0], scale: [1, 0.75, 1] }, ...[0, 1, 2, 3].map((i): Part => ({ geo: sph(0.006), color: "#3f3a7a", pos: [Math.cos(i * 1.6) * 0.025, 0.083, Math.sin(i * 1.6) * 0.025] as [number, number, number] }))], 0.08);
    case "Cinnamon Roll": return plateOf([{ geo: cyl(0.045, 0.045, 0.035, 24), color: "#c88b4a", pos: [0, 0.03, 0] }, { geo: tor(0.025, 0.006), color: "#f6efe2", pos: [0, 0.049, 0], rot: [Math.PI / 2, 0, 0] }, { geo: tor(0.012, 0.005), color: "#f6efe2", pos: [0, 0.049, 0], rot: [Math.PI / 2, 0, 0] }], 0.09);
    case "Almond Biscotti": return plateOf([0, 1].map((i): Part => ({ geo: box(0.09, 0.016, 0.026), color: "#d8b07a", pos: [0, 0.02 + i * 0.016, (i - 0.5) * 0.03] as [number, number, number], rot: [0, 0.2 * i, 0] as [number, number, number] })), 0.08);
    case "Avocado Toast": return plateOf([{ geo: box(0.1, 0.018, 0.09), color: "#d29a52", pos: [0, 0.02, 0] }, { geo: box(0.09, 0.008, 0.08), color: "#8bc34a", pos: [0, 0.033, 0] }, ...[0, 1, 2].map((i): Part => ({ geo: sph(0.006), color: "#c62828", pos: [(i - 1) * 0.025, 0.04, 0.01] as [number, number, number] }))]);
    case "Egg & Cheese Bagel": return plateOf([{ geo: tor(0.035, 0.016), color: "#c98a3e", pos: [0, 0.02, 0], rot: [Math.PI / 2, 0, 0] }, { geo: cyl(0.04, 0.04, 0.008), color: "#fbe17a", pos: [0, 0.04, 0] }, { geo: tor(0.035, 0.016), color: "#d29a4c", pos: [0, 0.058, 0], rot: [Math.PI / 2, 0, 0] }]);
    case "Yogurt Parfait": return build([{ geo: cyl(0.035, 0.028, 0.12), color: "#eef6f8", pos: [0, 0.06, 0], rough: 0.05, opacity: 0.4 }, { geo: cyl(0.032, 0.027, 0.035), color: "#f6f1e6", pos: [0, 0.02, 0] }, { geo: cyl(0.033, 0.03, 0.02), color: "#7e2a6b", pos: [0, 0.048, 0] }, { geo: cyl(0.034, 0.032, 0.03), color: "#f6f1e6", pos: [0, 0.073, 0] }, { geo: cyl(0.034, 0.034, 0.012), color: "#c79b5a", pos: [0, 0.094, 0] }]);
    case "Pancake Stack": return plateOf(([0, 1, 2, 3].map((i): Part => ({ geo: cyl(0.06, 0.06, 0.012, 24), color: "#d7a15a", pos: [0, 0.018 + i * 0.013, 0] as [number, number, number] })) as Part[]).concat([{ geo: box(0.02, 0.012, 0.02), color: "#fff2a8", pos: [0, 0.074, 0] }, { geo: cyl(0.05, 0.055, 0.003, 24), color: "#9c5a1e", pos: [0, 0.07, 0], opacity: 0.85 }]));
    // Nonna Lucia's
    case "Margherita": return pizza(["#f7f3e8", "#4caf50", "#f7f3e8"]);
    case "Pepperoni": return pizza(["#a62c1c"]);
    case "Quattro Formaggi": return pizza(["#fff6d9", "#f2e3a0", "#e9d78a"], "#f8e7a3");
    case "Diavola": return pizza(["#8e1b10", "#e53935"]);
    case "Capricciosa": return pizza(["#6d4c41", "#f8bbd0", "#2e2e2e", "#9ccc65"]);
    case "Ortolana": return pizza(["#43a047", "#fdd835", "#6a1b9a", "#e53935"]);
    case "Garlic Knots": return plateOf([0, 1, 2, 3].map((i): Part => ({ geo: tor(0.016, 0.008), color: "#e0b26a", pos: [((i % 2) - 0.5) * 0.04, 0.022, (Math.floor(i / 2) - 0.5) * 0.04] as [number, number, number], rot: [Math.PI / 2, 0.3, i] as [number, number, number] })));
    case "Arancini (3)": return plateOf([0, 1, 2].map((i): Part => ({ geo: sph(0.022), color: "#d3922f", pos: [Math.cos(i * 2.1) * 0.03, 0.03, Math.sin(i * 2.1) * 0.03] as [number, number, number] })));
    case "Caesar Salad": return bowlOf("#8bc34a", [0, 1, 2, 3, 4].map((i): Part => ({ geo: box(0.03, 0.01, 0.02), color: i % 2 ? "#cddc39" : "#689f38", pos: [Math.cos(i) * 0.03, 0.056, Math.sin(i) * 0.03] as [number, number, number], rot: [0.4, i, 0.3] as [number, number, number] })).concat([{ geo: box(0.012, 0.012, 0.012), color: "#e1b874", pos: [0.01, 0.06, -0.01] }]));
    case "Bruschetta": return plateOf([0, 1, 2].map((i): Part => ({ geo: box(0.05, 0.012, 0.035), color: "#d29a52", pos: [(i - 1) * 0.055, 0.02, 0] as [number, number, number] })).concat([0, 1, 2].map((i): Part => ({ geo: box(0.04, 0.008, 0.026), color: "#d84315", pos: [(i - 1) * 0.055, 0.03, 0] as [number, number, number] }))));
    case "Tiramisù": return plateOf([{ geo: box(0.07, 0.016, 0.07), color: "#8d5a33", pos: [0, 0.02, 0] }, { geo: box(0.07, 0.02, 0.07), color: "#f5ead2", pos: [0, 0.038, 0] }, { geo: box(0.07, 0.008, 0.07), color: "#5d3a1f", pos: [0, 0.052, 0] }], 0.08);
    case "Cannoli (2)": return plateOf([0, 1].map((i): Part => ({ geo: cyl(0.014, 0.014, 0.09, 12), color: "#d6a35e", pos: [0, 0.026, (i - 0.5) * 0.035] as [number, number, number], rot: [0, 0, Math.PI / 2] as [number, number, number] })).concat([0, 1].map((i): Part => ({ geo: cyl(0.012, 0.012, 0.095, 12), color: "#f8f1e0", pos: [0, 0.027, (i - 0.5) * 0.035] as [number, number, number], rot: [0, 0, Math.PI / 2] as [number, number, number] }))), 0.08);
    case "Panna Cotta": return plateOf([{ geo: cyl(0.03, 0.04, 0.045, 24), color: "#fbf5e6", pos: [0, 0.035, 0], rough: 0.3 }, { geo: cyl(0.031, 0.031, 0.006, 24), color: "#b71c1c", pos: [0, 0.06, 0], rough: 0.2 }], 0.08);
    case "San Pellegrino": return build([{ geo: cyl(0.03, 0.032, 0.17, 18), color: "#2e7d32", pos: [0, 0.085, 0], rough: 0.1, opacity: 0.75 }, { geo: cyl(0.012, 0.03, 0.05, 18), color: "#2e7d32", pos: [0, 0.195, 0], rough: 0.1, opacity: 0.75 }, { geo: cyl(0.0315, 0.0315, 0.05, 18), color: "#f2f0e6", pos: [0, 0.08, 0] }, { geo: cyl(0.013, 0.013, 0.012, 12), color: "#c0392b", pos: [0, 0.226, 0], metal: 0.6 }]);
    // Hanami
    case "Salmon Nigiri (2)": return nigiri("#f07c5a");
    case "Bluefin Tuna Nigiri (2)": return nigiri("#b71c1c");
    case "Dragon Roll": return roll();
    case "Sashimi Moriawase": return sashimi();
    case "Miso Soup": return bowlOf("#b07a3c", [{ geo: box(0.012, 0.01, 0.012), color: "#f5f5f0", pos: [0.015, 0.055, 0] }, { geo: box(0.012, 0.01, 0.012), color: "#f5f5f0", pos: [-0.012, 0.055, 0.015] }, { geo: box(0.03, 0.003, 0.01), color: "#2e7d32", pos: [0, 0.052, -0.02] }]);
    case "Chicken Teriyaki": return plateOf([{ geo: sph(0.035, true), color: "#fbfaf4", pos: [-0.04, 0.012, 0], scale: [1, 0.8, 1] }, ...[0, 1, 2].map((i): Part => ({ geo: box(0.05, 0.016, 0.025), color: "#7a3d16", pos: [0.035, 0.022, (i - 1) * 0.028] as [number, number, number], rough: 0.25 })), { geo: box(0.02, 0.01, 0.02), color: "#8bc34a", pos: [0.0, 0.02, 0.06] }], 0.12);
    case "Tonkotsu Ramen": return ramen();
    case "A5 Wagyu Tataki": return plateOf([0, 1, 2, 3, 4].map((i): Part => ({ geo: box(0.05, 0.008, 0.02), color: "#b54a4a", pos: [(i - 2) * 0.022, 0.018, 0] as [number, number, number], rot: [0, 0.3, 0.15] as [number, number, number], rough: 0.4 })).concat([{ geo: box(0.05, 0.002, 0.02), color: "#5d2e1f", pos: [0, 0.025, 0] }]), 0.1);
    case "Matcha Mochi": return plateOf([0, 1, 2].map((i): Part => ({ geo: sph(0.022), color: "#9ccc65", pos: [(i - 1) * 0.045, 0.026, 0] as [number, number, number], scale: [1, 0.8, 1] as [number, number, number], rough: 0.8 })), 0.09);
    case "Yuzu Sorbet": return build([{ geo: cyl(0.045, 0.02, 0.04, 20), color: "#e8f2f6", pos: [0, 0.03, 0], rough: 0.05, opacity: 0.5 }, { geo: cyl(0.004, 0.004, 0.02, 8), color: "#e8f2f6", pos: [0, 0.01, 0], opacity: 0.5 }, { geo: sph(0.025), color: "#fff176", pos: [-0.012, 0.06, 0] }, { geo: sph(0.022), color: "#ffee58", pos: [0.016, 0.062, 0.006] }]);
    case "Sencha Green Tea": return build([{ geo: cyl(0.032, 0.028, 0.06, 20), color: "#e0ddd1", pos: [0, 0.03, 0], rough: 0.6 }, { geo: cyl(0.029, 0.029, 0.004, 20), color: "#9ccc65", pos: [0, 0.058, 0] }]);
    case "Sake (glass)": return build([{ geo: cyl(0.024, 0.022, 0.07, 18), color: "#e8f2f6", pos: [0, 0.035, 0], rough: 0.05, opacity: 0.4 }, { geo: cyl(0.021, 0.02, 0.055, 18), color: "#f8f6ea", pos: [0, 0.03, 0], opacity: 0.6 }, { dish: true, geo: box(0.06, 0.06, 0.06), color: "#b07a3c", pos: [0, -0.0, 0], scale: [1, 0.05, 1] }]);
    case "Bottled Water": return build([
      { geo: cyl(0.034, 0.034, 0.15, 20), color: "#dff1ff", pos: [0, 0.075, 0], rough: 0.08, opacity: 0.35 },
      { geo: cyl(0.031, 0.031, 0.118, 20), color: "#9fd3f5", pos: [0, 0.06, 0], rough: 0.05, opacity: 0.45 },
      { geo: cyl(0.0352, 0.0352, 0.05, 20), color: "#1e78c8", pos: [0, 0.08, 0] },
      { geo: cyl(0.014, 0.034, 0.045, 20), color: "#dff1ff", pos: [0, 0.172, 0], rough: 0.08, opacity: 0.35 },
      { geo: cyl(0.0155, 0.0155, 0.016, 12), color: "#1565c0", pos: [0, 0.222, 0] },
    ]);
    default: return plateOf([{ geo: sph(0.05, true), color: "#cfd8dc", pos: [0, 0.012, 0], metal: 0.5, rough: 0.3 }]);
  }
}
