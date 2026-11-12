import type { Weather } from "./weather";
import type { ShopKind } from "./shops";
import type { ItemKind } from "./inventory";
import * as THREE from "three";
import type { Room, SitPlan } from "./restaurantRoom";
import { floorY } from "./apartments";
import type { NpcLink } from "./pedestrians";
import type { FoodLink, Mode, PackKind } from "./food";
import type { TrafficLink } from "./trafficShare";
import type { DoorLink } from "./doors";
import type { BodyRig } from "./CharacterBody";
import { readLife, type JobId, type Life } from "./life";
import { timeInfo } from "./config";
import { THROW_DISTANCE, healthAfterImpact, type SaveData, type SolidBox, type VehicleKind, type RoadPath, GET_UP_SECONDS, KNOCKDOWN_SECONDS, floorHeight, BENCH_SEATS, STARTING_CASH } from "./config";

export type Accident = {
  phase: "down" | "rising";
  startedAt: number;
  riseStartedAt: number | null;
  vehicleId: number | null;
  direction: [number, number];
  launchSpeed: number;
  /** A plain fall (not a hit): the body just crumples, no flinging. */
  gentle?: boolean;
  /** Falling from up there (world height): the body starts there and drops. */
  fromY?: number;
  seed: number;
};
export type RoadIncident = { vehicleId: number; path: RoadPath; origin: [number, number]; startedAt: number; passed: boolean; stoodUpAt: number | null; scooterCrash?: boolean };

export type ScooterState = {
  /** Which bike this player controls: "own" in their city, a room bike's id in a room, null for none. */
  id: string | null;
  pos: THREE.Vector3; yaw: number; fallen: boolean; riding: boolean; speed: number;
  action: "mount" | "pickup" | "dismount" | null; actionAt: number; actionOrigin: THREE.Vector3;
  actionSide: 1 | -1; fallenAt: number | null; interactQueued: boolean; promptVisible: boolean;
  braking: boolean; pushVelocity: THREE.Vector3; lean: number; steering: number; throwVelocity: THREE.Vector3; throwRemaining: number;
  /** Which local side the fallen bike lies toward: 1 = +x (default), -1 = -x. */
  fallSide: 1 | -1;
  /** Upright tilt (rad, + toward local +x) and its angular velocity while parked. */
  tip: number; tipVel: number;
};

/** The hardest a crash throws the rider (m/s), matching a full-speed traffic hit. */
const THROW_LAUNCH_MAX = THROW_DISTANCE * 1.75;

/** Scene objects whose transforms describe how this player looks right now (streamed to room peers). */
export type AvatarRig = { body: THREE.Object3D[]; ragdoll: THREE.Object3D[]; scooter: THREE.Object3D[] };
/** Another player's body on the ground plane, for bumping (`id` is their open tab in the room). */
export type OtherBody = { x: number; z: number; r: number; id?: string };
/** Another bike in the room (held by someone else, or parked and free), solid to this player. */
export type OtherBike = { id: string; box: SolidBox; fallen?: boolean };
/** Something this player's bike crashed into that another player must hear about. */
export type Impact =
  | { kind: "bike"; id: string; side: 1 | -1 }
  | { kind: "player"; id: string; direction: [number, number]; speed: number };

/** A hand reaching for a point in the world, its elbow pointing "low", "out" to the side or "back". */
export type WorldReach = { at: THREE.Vector3; blend: number; pole: "low" | "out" | "back" };
/**
 * A scripted movement this frame (going through a door, sitting on a chair): where the character is and how it
 * holds itself. `walk` is the speed along its facing, for the stepping legs.
 */
export type Script = { x: number; z: number; yaw: number; walk: number; sit: number; shuffle: number; lean: number; left: WorldReach | null; right: WorldReach | null; crouch?: number;
  /** Getting into bed: sat on its edge (sit), each leg up straight on it (legL, legR), lying back flat (lie); 0..1. */
  bed?: { sit: number; lie: number; legL: number; legR: number };
  /** Each leg set outright (a high step over a shower's curb): thigh forward (negative) and knee bend, radians. */
  legs?: { hipL: number; kneeL: number; hipR: number; kneeR: number; /** The hips this much lower (negative: higher). */ drop?: number };
  /** Up off the floor (climbing a ladder): the feet's level, world height. */
  y?: number };
/** Someone's use of an apartment building's elevator: the car going `from` → `to` (the same: standing there), `at`
 * seconds into that (t0: when it started, on this player's clock), and whether they're using it now. */
export type LiftUse = { b: string; from: number; to: number; at: number; active: boolean; t0?: number };
export type LiftLink = { publish: (use: LiftUse) => void; others: (now: number) => LiftUse[] };
/** Inside (or going into, or out of) a restaurant. */
export type Interior = {
  key: string; phase: "entering" | "inside" | "leaving"; startedAt: number;
  /** Where the movement began, in the room's frame. */
  from: [number, number]; fromYaw: number;
  /** The spot outside the door facing the street (world), where saving puts the player. */
  outside: [number, number]; outsideYaw: number;
  cameraSet: boolean;
  /** Opening the door, or walking through behind someone who has it open (`walk` is that path). */
  mode?: "open" | "follow";
  walk?: import("./restaurantRoom").WalkThrough;
};

/** An NPC as the rest of the game sees it: where it stands, whether it is down, and a hit waiting to be felt. */
export type NpcBody = { id: number; x: number; z: number; down: boolean; moving: boolean; hit: { direction: [number, number] } | null };

/** Food in one of this player's hands. */
export type Held = { id: number; kind: PackKind; bags: number; cups: number; items?: string[] };
/** Reaching for food on a counter: which pack, which hand, when it started, and where the hand goes. */
export type Grab = { pack: number; hand: "left" | "right"; at: number; target: THREE.Vector3; kind: PackKind; bags: number; cups: number; confirmed: boolean };
/** The order menu on screen (at a counter), and the order the player has just placed from it. */
export type FoodUi = { open: boolean; key: string | null; kind: import("./config").RestaurantKind | null; note: string | null };

/** A traffic vehicle's footprint this frame, for walking and riding into it. */
export type VehicleSolid = { index: number; kind: VehicleKind; box: SolidBox; speed: number };

export type GameState = {
  health: number;
  /** 0..100: how fed and how watered the character is (either at zero hurts). */
  hunger: number;
  /** 0..100: runs down through the day, faster running; sleep fills it. */
  energy: number;
  /** Running this frame (Player), for energy. */
  runningNow: boolean;
  thirst: number;
  deathStartedAt: number | null;
  lastImpactAt: number;
  elapsed: number;
  pos: THREE.Vector3;
  rotY: number;
  camYaw: number;
  camPitch: number;
  camOrbit: number;
  /** How far behind the character the camera wants to be (the wheel sets it), and first person (zoomed right in). */
  camDistance: number;
  firstPerson: boolean;
  lastMouseLookAt: number;
  movingForward: boolean;
  /** The on-screen joystick (touchscreens): x to the right, y forward, each -1..1 (length up to 1); null when untouched. */
  stick: { x: number; y: number } | null;
  /** The joystick was double-tapped (and is still held): pushing it runs. */
  stickRun: boolean;
  /** Fingers on the screen turning the view (not the joystick's), and when the last one let go (performance.now). */
  touchLook: { fingers: number; releasedAt: number };
  worldSeed: number;
  darkness: number;
  /** The weather now (from the clock and the world seed; set by the sky each frame). */
  weather: Weather;
  /** The shop whose counter is open (its panel), or null. */
  shop: ShopKind | null;
  /** The inventory grid is open. */
  inventoryOpen: boolean;
  /** The inventory slot whose thing is out in the right hand (the phone counts as out while it is open). */
  heldSlot: number | null;
  /** Trash in the right hand (an emptied bottle): it can't go in the inventory, only be put down (Q). */
  heldTrash: "bottle" | "can" | null;
  /** Doing something with a thing from the inventory: eating or drinking it, putting it down, picking one up. */
  invAct: { kind: "eat" | "drink" | "drop" | "pickup"; at: number; item: ItemKind | "bottle" | "can" | "groceryBag"; target: THREE.Vector3 | null; done: boolean; ground?: number } | null;
  /** Things from inventories lying on the ground (this player's world only); a grocery bag keeps what's in it. */
  groundItems: { id: number; kind: ItemKind | "bottle" | "can" | "groceryBag"; x: number; z: number; y?: number; yaw: number; at: number; contents?: ItemKind[] }[];
  /** A shopping basket in the right hand (what's in it), or null. */
  groceryBasket: ItemKind[] | null;
  /** A bag of groceries in the left hand (what's in it), or null: it can't go in the inventory, only be put down. */
  groceryBag: ItemKind[] | null;
  /** On an upper floor of an apartment building (its floor's height): the ground is that floor. */
  level: { building: string; floor: number; y: number } | null;
  /** Riding an apartment building's elevator: where, from which floor to which, and how far along. */
  elevator: { building: string; floor: number; target: number | null; phase: "open" | "choose" | "closing" | "moving" | "opening" | "shutting" | "waiting" | "calling"; t0: number; /** Been inside the car (with the doors open: going out again closes them). */ boarded?: boolean; /** Calling: the floor the car comes from. */ from?: number; /** Leaving: when the rider was fully out (the doors close only then). */ outAt?: number } | null;
  /** Seated somewhere that isn't a park bench or a restaurant chair (an apartment's couch, dining chair or desk):
   * where take-out food can be set down (world; the hands' spots are the point ± the sideways step). */
  seatSurface: { x: number; y: number; z: number; yaw: number; lx: number; lz: number } | null;
  /** Door uses by the grocery's shoppers (their doors swing like everyone's). */
  extraDoorUses: import("./doors").DoorUse[];
  /** Some other panel that needs the mouse (a reception desk, an elevator's buttons…), by name. */
  uiLock: string | null;
  /** The camera held on one view (world: where it is, what it looks at), e.g. the shower while showering. */
  /** Climbing an apartment building's roof ladder (up or down), since t0. */
  ladder: { dir: "up" | "down"; t0: number; building: string } | null;
  /** The ladder's E is showing (nothing else here takes E). */
  ladderPrompt: boolean;
  camLock: { pos: [number, number, number]; at: [number, number, number]; /** Put there at once (no easing). */ snap?: boolean; /** A field of view while held. */ fov?: number; /** Whose it is (only they let go of it). */ by?: string } | null;
  /** A kitchen panel's answer: a thing to take from the counter, or the cans to cook. */
  kitchenAsk: { rack?: import("./pantry").WareKind; cans?: import("./pantry").CanKind[]; burner?: number; /** Put away the new plates and cups from the bag. */ stow?: boolean } | null;
  /** Eating a home-cooked meal at the table (the fork to the mouth): when it started, how long. */
  meal: { at: number; T: number; bites?: number; left?: [number, number, number] } | null;
  /** Q pressed (for the kitchen, which looks at it after the food and inventory have). */
  kitchenQ: boolean;
  /** Things on their way into the fridge (one at a time, by hand): the name, and the grocery bag's kind if from the bag. */
  fridgeLoad: { name: string; bag: ItemKind | null }[];
  keys: Set<string>;
  jumpQueued: boolean;
  simulationTime: number;
  accident: Accident | null;
  incidents: RoadIncident[];
  scooter: ScooterState;
  bench: { seat: number; phase: "sit" | "seated" | "stand"; startedAt: number; origin: THREE.Vector3; originYaw: number } | null;
  seatOccupants: Map<number, string>;
  interactQueued: boolean;
  avatar: AvatarRig;
  /** The character's colour (from the account's gender; white for guests). */
  bodyColor: string;
  /** The player's gender (from the account; null for guests). */
  gender: "female" | "male" | null;
  /** Where the moon is in the sky (a unit vector from the viewer), kept by Sky. */
  moonDir: THREE.Vector3;
  /** Talking to the moon: her face in the sky (mood, blush 0..1) and until when it shows. */
  moonFace: { mood: import("./moon").Mood; blush: number; until: number } | null;
  others: OtherBody[];
  /** Other players' parked scooters: solid, but only their owners can move them. */
  otherBikes: OtherBike[];
  /** Parked room bikes nobody controls: solid until someone walks up and takes one. */
  parkedBikes: OtherBike[];
  /** Crashes into other players and their bikes, waiting for the room code to send them. */
  impacts: Impact[];
  vehicles: VehicleSolid[];
  /** Bike shoves on vehicles this frame, by vehicle index: a world-space velocity Traffic applies. */
  vehiclePushes: Map<number, [number, number]>;
  /** Restaurant rooms visited (furniture where it was left), by building. */
  rooms: Map<string, Room>;
  interior: Interior | null;
  seat: { room: string; plan: SitPlan; phase: "sit" | "seated" | "stand"; startedAt: number } | null;
  script: Script | null;
  standQueued: boolean;
  /** 0 clear .. 1 black: the fade between outside and inside. */
  fade: number;
  fadeInAt: number | null;
  /** Shown when the player can use a restaurant door, so the bike's hint stays out of the way. */
  doorPrompt: boolean;
  cash: number;
  /** Bank, levels, skills, goals, home (saved whole). */
  life: Life;
  /** Messages popping in at the top of the screen (pay, level up, goals done). */
  toasts: { id: number; title: string; body?: string; kind: "money" | "level" | "quest" | "info" | "warn" | "ticket"; at: number }[];
  /** Where the GPS is guiding the player (a job's next stop, or a place picked on the map). */
  waypoint: { x: number; z: number; label: string } | null;
  /** The phone: open or not, and which app (opened by P or the phone button, or by an ATM). */
  phone: { open: boolean; app: string | null; atm: boolean };
  /** The job under way (not saved: it ends with the session). */
  job: ActiveJob | null;
  /** Inside the player's home (its own little world below the city), and where to come back out. */
  home: { returnTo: [number, number]; returnYaw: number } | null;
  /** Busking right now: since when, and the tips so far. */
  busking: { since: number; tips: number; nextTip: number } | null;
  /** The NPCs around the player this frame (Pedestrians keeps them; Traffic and Player bump into them). */
  npcs: NpcBody[];
  /** In a multiplayer room: how the NPCs are shared with the others (null playing alone). */
  npcLink: NpcLink | null;
  /** In a multiplayer room: how the traffic is shared (null playing alone). */
  trafficLink: TrafficLink | null;
  /** In a multiplayer room: who is using which restaurant door (null playing alone). */
  doorLink: DoorLink | null;
  /** In a room: everyone's use of the apartment elevators. */
  liftLink: LiftLink | null;
  /** Restaurant chairs other players are sitting on (or sitting down on), as `roomKey#index`. */
  takenChairs: Set<string>;
  /** Slow pushes this player's bike gave to other bikes this frame, by bike id: a world velocity (m/s). */
  bikePushes: Map<string, [number, number]>;
  /** In a multiplayer room: how orders, the restaurant staff and food are shared (null playing alone). */
  foodLink: FoodLink | null;
  /** What this player is holding in each hand, and a grab in progress. */
  hands: { left: Held | null; right: Held | null };
  grab: Grab | null;
  /** Putting held food down (Q): when it started, and whether it has been let go of yet. */
  drop: { at: number; sent: boolean } | null;
  /** Setting something held down on a table or a bench (released when the hand gets there). */
  put: { pack: number; hand: "left" | "right"; at: number; target: THREE.Vector3; where: "table" | "aside"; yaw: number; sent: boolean } | null;
  /** Eating (or drinking) one item: from which pack, which item, since when (simulation time). */
  eating: { pack: number; item: string; at: number; drink: boolean } | null;
  /** A scripted movement from the food side (walking up to a bin and throwing things in). */
  foodScript: Script | null;
  /** Sends a request to the shared food (set by Food every frame), for things outside it (the home fridge). */
  foodSend: ((req: import("./food").FoodRequest) => void) | null;
  /** Everyone's door uses as RestaurantInteraction sees them (its clock), for customers who aren't players. */
  doorUsesNow: ((key: string, leaf: "left" | "right") => import("./doors").DoorUse[]) | null;
  /** Customers' door uses, on RestaurantInteraction's clock (so the doors swing for them too). */
  npcDoorUses: import("./doors").DoorUse[];
  /** Customers leaving with food to go, to be taken over by the street NPCs (who go and eat it on a bench). */
  npcAdopt: { x: number; z: number; yaw: number; female: boolean; holder: string }[];
  /** Running the food: a street NPC's request (`ped:<id>`), handing food over, and which street NPCs hold food. */
  foodHandle: ((by: string, req: import("./food").FoodRequest) => void) | null;
  foodTransfer: ((from: string, to: string) => void) | null;
  pedHolders: Set<string>;
  /** The shared food as last seen (every player), and how old that view is (s). */
  foodView: (() => { packs: import("./food").FoodPack[]; age: number }) | null;
  dropQueued: boolean;
  /** Restaurant staff standing or walking about (world), solid to players. */
  staffBodies: { x: number; z: number; r: number }[];
  foodUi: FoodUi;
  /** An order placed from the menu, waiting to be sent. */
  foodOrder: { names: string[]; mode: Mode } | null;
  /** Other players' bodies in a room, by their id (to put food they hold in their hands). */
  remoteRigs: Map<string, BodyRig>;
};

export function createState(save: SaveData): GameState {
  return {
    health: Math.max(0, Math.min(100, save.health ?? 100)),
    hunger: Math.max(0, Math.min(100, save.hunger ?? 100)),
    energy: Math.max(0, Math.min(100, save.energy ?? 100)), runningNow: false,
    thirst: Math.max(0, Math.min(100, save.thirst ?? 100)),
    deathStartedAt: save.health === 0 ? performance.now() : null,
    lastImpactAt: -Infinity,
    elapsed: save.elapsed,
    // Saved up in an apartment building: back on that floor (in the building, its room made by Apartments).
    pos: save.apt ? new THREE.Vector3(save.apt.x, floorY(Math.max(1, save.apt.floor)), save.apt.z) : new THREE.Vector3(...save.pos),
    rotY: save.apt ? save.apt.yaw : save.rotY,
    camYaw: save.camYaw,
    camOrbit: save.camYaw - save.rotY - Math.PI,
    camPitch: save.camPitch ?? 0.22,
    camDistance: 6, firstPerson: false,
    lastMouseLookAt: performance.now(),
    movingForward: false,
    stick: null, stickRun: false,
    touchLook: { fingers: 0, releasedAt: -Infinity },
    worldSeed: save.worldSeed ?? 1337,
    darkness: 0,
    weather: { kind: "clear", clouds: 0, rain: 0, fog: 0 },
    shop: null,
    inventoryOpen: false,
    heldSlot: null,
    heldTrash: null,
    invAct: null,
    groundItems: [],
    groceryBasket: null,
    groceryBag: null,
    extraDoorUses: [],
    level: save.apt && save.apt.floor >= 2 ? { building: save.apt.building, floor: save.apt.floor, y: floorY(save.apt.floor) } : null,
    seatSurface: null,
    elevator: null,
    uiLock: null, fridgeLoad: [], camLock: null, ladder: null, ladderPrompt: false, kitchenAsk: null, meal: null, kitchenQ: false,
    keys: new Set(),
    jumpQueued: false,
    simulationTime: 0,
    accident: save.accident ? { phase: save.accident.phase, startedAt: -(KNOCKDOWN_SECONDS - save.accident.remaining), riseStartedAt: save.accident.phase === "rising" ? -(GET_UP_SECONDS - save.accident.remaining) : null, vehicleId: null, direction: save.accident.direction, launchSpeed: 0, seed: save.accident.seed } : null,
    incidents: [],
    interactQueued: false,
    avatar: { body: [], ragdoll: [], scooter: [] },
    bodyColor: "#ffffff", gender: null, moonDir: new THREE.Vector3(0, 1, 0), moonFace: null,
    others: [],
    otherBikes: [],
    parkedBikes: [],
    impacts: [],
    vehicles: [],
    vehiclePushes: new Map(),
    rooms: new Map(), interior: save.apt ? { key: save.apt.floor >= 2 ? `${save.apt.building}#${save.apt.floor}` : save.apt.building, phase: "inside", startedAt: 0, from: [0, 0], fromYaw: 0, outside: save.apt.outside, outsideYaw: save.apt.outsideYaw, cameraSet: true } : null, seat: null, script: null, standQueued: false, fade: 0, fadeInAt: null, doorPrompt: false,
    cash: Math.max(0, save.cash ?? STARTING_CASH),
    life: readLife(save.life, timeInfo(save.elapsed).day),
    toasts: [], waypoint: null, phone: { open: false, app: null, atm: false }, job: null, home: null, busking: null,
    npcs: [], npcLink: null,
    trafficLink: null, doorLink: null, liftLink: null, bikePushes: new Map(), takenChairs: new Set(),
    foodLink: null, hands: { left: null, right: null }, grab: null, drop: null, dropQueued: false, staffBodies: [], put: null, eating: null, foodScript: null, foodSend: null, doorUsesNow: null, npcDoorUses: [], npcAdopt: [], foodHandle: null, foodTransfer: null, pedHolders: new Set(), foodView: null, foodUi: { open: false, key: null, kind: null, note: null }, foodOrder: null, remoteRigs: new Map(),
    seatOccupants: new Map(save.benchSeat != null && BENCH_SEATS[save.benchSeat] ? [[save.benchSeat, "player"]] : []),
    bench: save.benchSeat != null && BENCH_SEATS[save.benchSeat] ? { seat: save.benchSeat, phase: "seated", startedAt: 0, origin: new THREE.Vector3(...save.pos), originYaw: save.rotY } : null,
    scooter: {
      id: "own",
      pos: save.scooter ? new THREE.Vector3(...save.scooter.pos) : new THREE.Vector3(save.pos[0] + 0.75, floorHeight(save.pos[0] + 0.75, save.pos[2]), save.pos[2]),
      yaw: save.scooter?.yaw ?? save.rotY, fallen: save.scooter?.fallen ?? false,
      riding: (save.scooter?.riding ?? false) && !save.scooter?.fallen && !save.accident,
      speed: 0, action: null, actionAt: 0, actionOrigin: new THREE.Vector3(...save.pos), actionSide: 1,
      fallenAt: save.scooter?.fallen ? 0 : null, interactQueued: false, promptVisible: false,
      braking: false, pushVelocity: new THREE.Vector3(), lean: 0, steering: 0, throwVelocity: new THREE.Vector3(), throwRemaining: 0, fallSide: 1, tip: 0, tipVel: 0,
    },
  };
}

/** A job in progress: where to collect, where to deliver, and when it began. */
export type ActiveJob = { id: JobId; stage: "pickup" | "deliver"; from: [number, number]; to: [number, number]; label: string; startedAt: number; metres: number };

let toastId = 1;
/** Pops a message in at the top of the screen. */
/** A panel that needs the mouse is open (phone, shop counter, order menu, inventory…): the camera stays still and
 * the pointer is free. */
export function uiCaptured(s: GameState) {
  return s.phone.open || !!s.shop || s.foodUi.open || s.inventoryOpen || !!s.uiLock;
}

/** The height of the ground under (x, z): an apartment building's floor while up there, else the street's. */
export const groundAt = (s: GameState, x: number, z: number) => (s.level ? s.level.y : floorHeight(x, z));

export function toast(state: GameState, title: string, kind: GameState["toasts"][number]["kind"] = "info", body?: string) {
  // The same notice again replaces the one showing (its time starts over); different ones stack.
  const same = state.toasts.findIndex((t) => t.title === title && t.kind === kind);
  const next = { id: same >= 0 ? state.toasts[same]!.id : toastId++, title, kind, at: performance.now(), ...(body ? { body } : {}) };
  if (same >= 0) { state.toasts[same] = next; return; }
  state.toasts.push(next);
  if (state.toasts.length > 4) state.toasts.shift();
}

export function toSave(s: GameState): SaveData {
  return {
    health: s.health,
    elapsed: s.elapsed,
    // Saved inside a restaurant, the game comes back just outside its door.
    pos: s.home ? [s.home.returnTo[0], 0.15, s.home.returnTo[1]] : s.interior ? [s.interior.outside[0], s.pos.y, s.interior.outside[1]] : [s.pos.x, s.pos.y, s.pos.z],
    rotY: s.interior ? s.interior.outsideYaw : s.rotY,
    cash: s.cash,
    life: s.life,
    hunger: Math.round(s.hunger * 100) / 100,
    energy: Math.round(s.energy * 100) / 100,
    thirst: Math.round(s.thirst * 100) / 100,
    camYaw: s.camYaw,
    camPitch: s.camPitch,
    worldSeed: s.worldSeed,
    benchSeat: s.bench?.phase === "stand" ? null : s.bench?.seat ?? null,
    apt: aptSave(s),
    scooter: { pos: [s.scooter.pos.x, s.scooter.pos.y, s.scooter.pos.z], yaw: s.scooter.yaw, fallen: s.scooter.fallen, riding: s.scooter.riding },
    ...(s.accident ? { accident: { phase: s.accident.phase, remaining: Math.max(0, s.accident.phase === "rising" ? GET_UP_SECONDS - (s.simulationTime - (s.accident.riseStartedAt ?? 0)) : KNOCKDOWN_SECONDS - (s.simulationTime - s.accident.startedAt)), direction: s.accident.direction, seed: s.accident.seed } } : { accident: null }),
  };
}

/** Where to come back in an apartment building (floor 2 and up), or null: on the floor (in the elevator, the floor it
 * is at or going to, out in the hallway in front of it). */
function aptSave(s: GameState): import("./config").SavedApt | null {
  if (!s.interior || s.interior.phase !== "inside") return null;
  const e = s.elevator, lvl = s.level;
  const building = e?.building ?? lvl?.building;
  if (!building) return null;
  const outside = s.interior.outside, outsideYaw = s.interior.outsideYaw;
  if (e && (e.phase === "choose" || e.phase === "closing" || e.phase === "moving")) {
    // In the elevator (going up, down, or waiting in it): back on the ground floor, in the lobby in front of its
    // doors — never somewhere up a shaft.
    const lobby = s.rooms.get(building);
    if (!lobby) return null;
    const f = lobby.frame, at: [number, number] = [lobby.bounds.minX + LOBBY_SHAFT / 2, lobby.bounds.minZ + LOBBY_SHAFT + 0.9];
    return { building, floor: 1, x: f.ox + at[0] * f.c + at[1] * f.s, z: f.oz - at[0] * f.s + at[1] * f.c, yaw: f.rot, outside, outsideYaw };
  }
  let floor = lvl?.floor;
  if (!floor || floor < 2) return null;
  // On the roof or its ladder: back on the top floor, in front of the ladder.
  if (floor > 15 || s.ladder) {
    const room = s.rooms.get(`${building}#15`) as (import("./restaurantRoom").Room & { roofSpot?: [number, number] }) | undefined;
    if (!room?.roofSpot) return null;
    const f = room.frame, at = room.roofSpot;
    return { building, floor: 15, x: f.ox + at[0] * f.c + at[1] * f.s, z: f.oz - at[0] * f.s + at[1] * f.c, yaw: f.rot, outside, outsideYaw };
  }
  floor = floor as number;
  let x = s.pos.x, z = s.pos.z, yaw = s.rotY;
  if (s.seat) {
    // Sat on a chair: where one sat down from.
    const room = s.rooms.get(`${building}#${floor}`);
    if (!room) return null;
    const at = s.seat.plan.start, f = room.frame;
    x = f.ox + at[0] * f.c + at[1] * f.s; z = f.oz - at[0] * f.s + at[1] * f.c;
    yaw = f.rot + s.seat.plan.startYaw;
  }
  return { building, floor, x, z, yaw, outside, outsideYaw };
}
/** The elevator shaft's size (venueRoom SHAFT), for the lobby spot in front of it. */
const LOBBY_SHAFT = 2.6;

export function knockDown(state: GameState, vehicleId: number, path: RoadPath, position: [number, number], direction: [number, number], launchSpeed: number, seed: number) {
  if (state.accident || !hitByVehicle(state, performance.now())) return false;
  state.keys.clear(); state.jumpQueued = false;
  if (state.bench) state.seatOccupants.delete(state.bench.seat); state.bench = null;
  state.accident = { phase: "down", startedAt: state.simulationTime, riseStartedAt: null, vehicleId, direction, launchSpeed, seed };
  state.incidents.push({ vehicleId, path: { ...path }, origin: position, startedAt: state.simulationTime, passed: false, stoodUpAt: null });
  if (state.scooter.riding || state.scooter.action === "mount") {
    state.scooter.riding = false; state.scooter.action = null; state.scooter.fallen = true;
    state.scooter.fallenAt = state.simulationTime; state.scooter.speed = 0;
    state.scooter.throwVelocity.set(direction[0] * launchSpeed, 3.2, direction[1] * launchSpeed);
    state.scooter.throwRemaining = 1.6;
    const incident = state.incidents[state.incidents.length - 1];
    if (incident) incident.scooterCrash = true;
  }
  return true;
}

/**
 * The player's own bike crashes into something at speed: the rider is thrown along `direction` (unit, ground
 * plane) like any accident, losing health, and the bike tumbles back from the impact. No vehicle is involved,
 * so traffic does not queue for it.
 */
export function crashBike(state: GameState, direction: [number, number], speed: number, seed: number) {
  if (state.accident || !hitByVehicle(state, performance.now())) return false;
  state.keys.clear(); state.jumpQueued = false;
  const launchSpeed = Math.min(THROW_LAUNCH_MAX, Math.abs(speed) * 0.55);
  state.accident = { phase: "down", startedAt: state.simulationTime, riseStartedAt: null, vehicleId: null, direction, launchSpeed, seed };
  const bike = state.scooter;
  if (bike.riding || bike.action === "mount") {
    bike.riding = false; bike.action = null; bike.fallen = true;
    bike.fallenAt = state.simulationTime; bike.speed = 0;
    bike.throwVelocity.set(-direction[0] * 2.2, 2.4, -direction[1] * 2.2);
    bike.throwRemaining = 1.2;
  }
  return true;
}

/** Knocked down by another player's crash (they hit this player at speed, or this player hit them). */
export function knockedByPlayer(state: GameState, direction: [number, number], speed: number, seed: number) {
  return crashBike(state, direction, speed, seed);
}

export function hitByVehicle(state: GameState, now: number) {
  if (state.health === 0 || now - state.lastImpactAt < 1000) return false;
  state.health = healthAfterImpact(state.health);
  state.lastImpactAt = now;
  if (state.health === 0) {
    state.deathStartedAt = now;
    state.keys.clear();
    state.jumpQueued = false;
  }
  return true;
}

/** Where a bike nobody here controls is parked in this player's simulation: far away, so nothing touches it. */
const NO_BIKE = 100_000;

/** Lets go of the controlled bike (a room bike becomes someone else's to take). */
export function dropScooter(state: GameState) {
  const bike = state.scooter;
  Object.assign(bike, { id: null, riding: false, action: null, speed: 0, fallen: false, fallenAt: null, tip: 0, tipVel: 0, throwRemaining: 0, lean: 0, steering: 0, braking: false, promptVisible: false });
  bike.pos.set(NO_BIKE, 0, NO_BIKE);
  bike.pushVelocity.set(0, 0, 0); bike.throwVelocity.set(0, 0, 0);
}

/** Takes control of a parked bike. */
export function takeScooter(state: GameState, id: string, at: { pos: [number, number, number]; yaw: number; fallen: boolean; fallSide: 1 | -1 }) {
  dropScooter(state);
  const bike = state.scooter;
  bike.id = id;
  bike.pos.set(...at.pos);
  bike.yaw = at.yaw; bike.fallen = at.fallen; bike.fallSide = at.fallSide;
  bike.fallenAt = at.fallen ? state.simulationTime - 60 : null;
}
