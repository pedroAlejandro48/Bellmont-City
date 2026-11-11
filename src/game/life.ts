import { newMoonBond, readMoonBond, type MoonBond } from "./moon";
import { newKitchen, readKitchen, type Kitchen } from "./kitchen";
import { newInventory, readInventory, addItem, type Inventory } from "./inventory";
import { FREE_DAYS, type ApartmentHome } from "./apartments";

// Life in the city (pure, testable): money in the bank, loans and credit, taxes and bills, experience and
// levels, skills, daily goals and the first-day guide, jobs' pay, and a home. The game state keeps one `Life`;
// the save keeps it whole.

/** Skills that grow by doing things. */
export const SKILLS = ["fitness", "riding", "work", "charm"] as const;
export type Skill = (typeof SKILLS)[number];
export const SKILL_NAMES: Record<Skill, string> = { fitness: "Fitness", riding: "Riding", work: "Work ethic", charm: "Charm" };

export type Txn = { day: number; label: string; amount: number };
export type Quest = { id: QuestId; goal: number; progress: number; done: boolean; reward: number };
export type QuestId = "eat" | "ride" | "earn" | "work" | "walk" | "atm" | "park";

/** Where the player lives: a small apartment on one floor of an apartment building, or nowhere. */
export type Home = ApartmentHome | null;

export type Life = {
  /** Money in the bank (cash is kept on the character, separately). */
  bank: number;
  /** What is owed to the bank, and when the next repayment falls due (game day). */
  loan: number;
  /** 300..850, as real credit scores: paying on time raises it, missing payments drops it. */
  credit: number;
  xp: number;
  skills: Record<Skill, number>;
  /** Today's goals (rolled each game day) and the day they belong to. */
  quests: Quest[];
  questDay: number;
  /** First-day guide: which step the new player is on (GUIDE.length = finished). */
  guide: number;
  home: Home;
  /** The last game day bills were charged on. */
  billedDay: number;
  /** Food kept in the fridge at home (menu item names). */
  fridge: string[];
  /** Recent money movements, newest first. */
  ledger: Txn[];
  /** Totals for the profile and the leaderboard. */
  earned: number;
  jobsDone: number;
  /** Unpaid tickets (paid at the police station or in the Bank app; overdue ones go on the loan and the record). */
  fines: Fine[];
  /** Convictions: overdue fines; each one lowers what the bank will lend. */
  record: number;
  /** The health plan (a daily premium; hospital care is free while it's on). */
  insured: boolean;
  /** The character's outfit colour and the bike's paint, once bought (null: as they came). */
  outfit: string | null;
  bikePaint: string | null;
  /** The last game day of a gym workout (one a day). */
  workoutDay: number;
  /** Nine slots, the phone always first. */
  inventory: Inventory;
  /** Clothes hung in the apartment's closet (up to CLOSET_MAX): tops and bottoms. */
  closet: Clothing[];
  /** The apartment's kitchen: the pots, plates and the rest, what's cooking, what's on the table and in hand. */
  kitchen: Kitchen;
  /** How things stand with the moon (talked to at night). */
  moon: MoonBond;
};
export type Clothing = { name: string; part: "upper" | "lower"; color: string };
export const CLOSET_MAX = 10;
export type Fine = { day: number; reason: string; amount: number };

export function newLife(day = 1): Life {
  return {
    bank: 300, loan: 0, credit: 650, xp: 0,
    skills: { fitness: 0, riding: 0, work: 0, charm: 0 },
    quests: rollQuests(day), questDay: day, guide: 0, home: null, billedDay: day, fridge: [], ledger: [],
    earned: 0, jobsDone: 0, fines: [], record: 0, insured: false, outfit: null, bikePaint: null, workoutDay: 0, inventory: newInventory(), closet: [], kitchen: newKitchen(), moon: newMoonBond(),
  };
}

/** Reads a saved life defensively (unknown or broken fields fall back to a fresh one's). */
export function readLife(value: unknown, day = 1): Life {
  const base = newLife(day);
  if (!value || typeof value !== "object") return base;
  const v = value as Record<string, unknown>;
  const num = (k: string, lo: number, hi: number, d: number) => (typeof v[k] === "number" && Number.isFinite(v[k]) ? Math.max(lo, Math.min(hi, v[k] as number)) : d);
  const skills = { ...base.skills };
  if (v["skills"] && typeof v["skills"] === "object") for (const s of SKILLS) { const x = (v["skills"] as Record<string, unknown>)[s]; if (typeof x === "number" && Number.isFinite(x)) skills[s] = Math.max(0, x); }
  const home = v["home"] && typeof v["home"] === "object" ? (v["home"] as Home) : null;
  const quests = Array.isArray(v["quests"]) ? (v["quests"] as Quest[]).filter((q) => q && typeof q.id === "string" && typeof q.goal === "number") : base.quests;
  return {
    bank: num("bank", 0, 1e9, base.bank), loan: num("loan", 0, 1e9, 0), credit: num("credit", 300, 850, base.credit), xp: num("xp", 0, 1e9, 0),
    skills, quests, questDay: num("questDay", 0, 1e9, day), guide: num("guide", 0, GUIDE.length, 0),
    // (Older saves' studios and lofts are gone: those players are between homes.)
    home: home && home.kind === "apartment" && typeof home.building === "string" && typeof home.floor === "number" && typeof home.nextRent === "number" && typeof home.weekly === "number" ? home : null,
    billedDay: num("billedDay", 0, 1e9, day),
    fridge: Array.isArray(v["fridge"]) ? (v["fridge"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 24) : [],
    ledger: Array.isArray(v["ledger"]) ? (v["ledger"] as Txn[]).filter((t) => t && typeof t.amount === "number").slice(0, 30) : [],
    earned: num("earned", 0, 1e12, 0), jobsDone: num("jobsDone", 0, 1e9, 0),
    fines: Array.isArray(v["fines"]) ? (v["fines"] as Fine[]).filter((f) => f && typeof f.amount === "number" && typeof f.day === "number").slice(0, 20) : [],
    record: num("record", 0, 100, 0), insured: v["insured"] === true,
    outfit: typeof v["outfit"] === "string" && /^#[0-9a-f]{6}$/i.test(v["outfit"]) ? v["outfit"] : null,
    bikePaint: typeof v["bikePaint"] === "string" && /^#[0-9a-f]{6}$/i.test(v["bikePaint"]) ? v["bikePaint"] : null,
    workoutDay: num("workoutDay", 0, 1e9, 0),
    inventory: readInventory(v["inventory"]),
    closet: Array.isArray(v["closet"]) ? (v["closet"] as Clothing[]).filter((c) => c && typeof c.name === "string" && (c.part === "upper" || c.part === "lower") && typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color)).slice(0, CLOSET_MAX) : [],
    kitchen: readKitchen(v["kitchen"]),
    moon: readMoonBond(v["moon"]),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
export function record(life: Life, day: number, label: string, amount: number) {
  life.ledger.unshift({ day, label, amount: round(amount) });
  if (life.ledger.length > 30) life.ledger.length = 30;
}

// ---------- levels ----------
/** Experience needed to go from level n to n + 1 (gentle at first, steeper later). */
export const xpForLevel = (level: number) => 100 + (level - 1) * 60;
/** The level for a total of experience, and progress (0..1) toward the next. */
export function levelOf(xp: number) {
  let level = 1, left = xp;
  while (left >= xpForLevel(level)) { left -= xpForLevel(level); level++; }
  return { level, into: left, need: xpForLevel(level), progress: left / xpForLevel(level) };
}
/** Adds experience; returns the new level if it went up. */
export function gainXp(life: Life, amount: number): number | null {
  const before = levelOf(life.xp).level;
  life.xp += Math.max(0, Math.round(amount));
  const after = levelOf(life.xp).level;
  return after > before ? after : null;
}
export const skillLevel = (points: number) => Math.min(10, Math.floor(Math.sqrt(points / 25)));
export function gainSkill(life: Life, skill: Skill, points: number): number | null {
  const before = skillLevel(life.skills[skill]);
  life.skills[skill] += points;
  const after = skillLevel(life.skills[skill]);
  return after > before ? after : null;
}

// ---------- pay, taxes ----------
export const INCOME_TAX = 0.1;
/** Gross pay for a job, with the work-skill bonus (up to +50%), and what is kept after tax. */
export function payslip(base: number, workSkill: number) {
  const gross = round(base * (1 + skillLevel(workSkill) * 0.05));
  const tax = round(gross * INCOME_TAX);
  return { gross, tax, net: round(gross - tax) };
}

// ---------- the bank ----------
/** How much the bank will lend: grows with credit score and level. */
export function loanLimit(life: Life) {
  const { level } = levelOf(life.xp);
  // A criminal record costs $200 of borrowing each.
  return Math.max(0, Math.round(((life.credit - 500) * 8 + level * 150 - life.record * 200) / 50) * 50);
}
export const LOAN_RATE = 0.02; // per game day
export const SAVINGS_RATE = 0.002; // per game day

export function deposit(life: Life, cash: number, amount: number, day: number) {
  const a = round(Math.min(amount, cash));
  if (a <= 0) return { ok: false as const, cash };
  life.bank = round(life.bank + a); record(life, day, "Cash deposit", a);
  return { ok: true as const, cash: round(cash - a) };
}
export function withdraw(life: Life, cash: number, amount: number, day: number) {
  const a = round(Math.min(amount, life.bank));
  if (a <= 0) return { ok: false as const, cash };
  life.bank = round(life.bank - a); record(life, day, "Cash withdrawal", -a);
  return { ok: true as const, cash: round(cash + a) };
}
export function borrow(life: Life, amount: number, day: number) {
  const a = Math.min(amount, loanLimit(life) - life.loan);
  if (a <= 0) return false;
  life.loan = round(life.loan + a); life.bank = round(life.bank + a); record(life, day, "Loan", a);
  return true;
}
export function repay(life: Life, amount: number, day: number) {
  const a = round(Math.min(amount, life.loan, life.bank));
  if (a <= 0) return false;
  life.loan = round(life.loan - a); life.bank = round(life.bank - a); record(life, day, "Loan repayment", -a);
  life.credit = Math.min(850, life.credit + Math.ceil(a / 100));
  return true;
}

// ---------- homes and bills ----------
/** What renting is called (one kind of home for now). */
export const HOME_NAME = "Small apartment";
/** Phone bill and the like, for everyone. */
export const BASE_BILL = 3;

/** Each new game day (at 6 am): rent, utilities and loan interest come out of the bank, savings earn interest. */
export function dailyBills(life: Life, day: number) {
  const lines: Txn[] = [];
  for (let d = life.billedDay + 1; d <= day; d++) {
    const interest = round(life.bank * SAVINGS_RATE);
    if (interest > 0) { life.bank = round(life.bank + interest); lines.push({ day: d, label: "Savings interest", amount: interest }); }
    const charges: [string, number][] = [["Phone plan", BASE_BILL]];
    if (life.insured) charges.push(["Health plan", HEALTH_PLAN]);
    // The week's rent, every seventh day (the first week was free).
    if (life.home && d >= life.home.nextRent) { charges.push([`Rent (week, floor ${life.home.floor})`, life.home.weekly]); life.home.nextRent += 7; }
    if (life.loan > 0) charges.push(["Loan interest", round(life.loan * LOAN_RATE)]);
    for (const [label, amount] of charges) {
      if (life.bank >= amount) { life.bank = round(life.bank - amount); lines.push({ day: d, label, amount: -amount }); life.credit = Math.min(850, life.credit + 1); }
      else {
        // Not enough in the bank: it goes on the loan, and the credit score suffers.
        life.loan = round(life.loan + amount); lines.push({ day: d, label: `${label} (unpaid, added to loan)`, amount: 0 }); life.credit = Math.max(300, life.credit - 15);
      }
    }
  }
  // Tickets left unpaid FINE_DAYS days go on the loan with a 25% surcharge, and on the record.
  const overdue = life.fines.filter((f) => day - f.day >= FINE_DAYS);
  if (overdue.length) {
    const owed = round(overdue.reduce((a, f) => a + f.amount, 0) * 1.25);
    life.fines = life.fines.filter((f) => day - f.day < FINE_DAYS);
    life.loan = round(life.loan + owed); life.record += overdue.length; life.credit = Math.max(300, life.credit - 40 * overdue.length);
    lines.push({ day, label: `Overdue fines (+25%, added to loan)`, amount: 0 });
  }
  life.billedDay = Math.max(life.billedDay, day);
  for (const l of lines.reverse()) { life.ledger.unshift(l); }
  if (life.ledger.length > 30) life.ledger.length = 30;
  return lines;
}
/** The health plan's daily premium, and how many days a ticket can wait before it goes on the record. */
export const HEALTH_PLAN = 4;
export const FINE_DAYS = 3;

// ---------- law ----------
export function addFine(life: Life, day: number, reason: string, amount: number) {
  life.fines.unshift({ day, reason, amount: round(amount) });
  if (life.fines.length > 20) life.fines.length = 20;
}
export const finesOwed = (life: Life) => round(life.fines.reduce((a, f) => a + f.amount, 0));
/** Pays every ticket from the bank, if there's enough; true if paid. */
export function payFines(life: Life, day: number) {
  const owed = finesOwed(life);
  if (owed <= 0 || life.bank < owed) return false;
  life.bank = round(life.bank - owed); record(life, day, `Fines paid (${life.fines.length})`, -owed); life.fines = [];
  return true;
}

// ---------- spending ----------
/** Pays `amount` with cash first, then the bank card; false (nothing taken) if both together aren't enough. */
export function spend(life: Life, cash: number, amount: number, day: number, label: string): { ok: boolean; cash: number } {
  if (cash + life.bank < amount - 1e-9) return { ok: false, cash };
  const fromCash = Math.min(cash, amount), fromBank = round(amount - fromCash);
  if (fromBank > 0) { life.bank = round(life.bank - fromBank); record(life, day, `${label} (card)`, -fromBank); }
  return { ok: true, cash: round(cash - fromCash) };
}

/**
 * Renting a small apartment on `floor` of a building: nothing to pay now (the first week is free), the key goes in
 * the inventory, and the week's rent comes out of the bank every seventh day from then. Moving here moves out of
 * any other place. "full" when there's no room for the key.
 */
export function rentApartment(life: Life, building: string, floor: number, weekly: number, day: number): "ok" | "full" {
  const hadKey = life.inventory.includes("key");
  if (!hadKey && addItem(life.inventory, "key") < 0) return "full";
  life.home = { kind: "apartment", building, floor, since: day, nextRent: day + FREE_DAYS, weekly };
  record(life, day, `${HOME_NAME}, floor ${floor}: first week free`, 0);
  return "ok";
}
/** Moving out: the key is handed back and the fridge is cleared. */
export function moveOut(life: Life, day: number) {
  if (!life.home) return;
  record(life, day, `Moved out of floor ${life.home.floor}`, 0);
  life.home = null; life.fridge = [];
  const k = life.inventory.indexOf("key");
  if (k > 0) life.inventory[k] = null;
}

// ---------- daily goals ----------
const QUEST_POOL: Omit<Quest, "progress" | "done">[] = [
  { id: "eat", goal: 2, reward: 15 }, { id: "ride", goal: 1000, reward: 20 }, { id: "earn", goal: 60, reward: 25 },
  { id: "work", goal: 2, reward: 30 }, { id: "walk", goal: 600, reward: 15 }, { id: "atm", goal: 1, reward: 10 }, { id: "park", goal: 1, reward: 10 },
];
export const QUEST_TEXT: Record<QuestId, (q: Quest) => string> = {
  eat: (q) => `Eat or drink ${q.goal} things`,
  ride: (q) => `Ride a bike ${q.goal / 1000} km`,
  earn: (q) => `Earn $${q.goal} from work`,
  work: (q) => `Finish ${q.goal} jobs`,
  walk: (q) => `Walk ${q.goal} m`,
  atm: () => "Use an ATM",
  park: () => "Sit on a bench in the park",
};
/** Three goals for a game day, the same for everyone on that day. */
export function rollQuests(day: number): Quest[] {
  let s = (day * 2654435761) >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const pool = [...QUEST_POOL], out: Quest[] = [];
  while (out.length < 3 && pool.length) { const q = pool.splice(Math.floor(rand() * pool.length), 1)[0]!; out.push({ ...q, progress: 0, done: false }); }
  return out;
}
/** Moves a goal along; returns the goals finished by this step (their reward is paid by the caller). */
export function progressQuest(life: Life, id: QuestId, amount: number): Quest[] {
  const finished: Quest[] = [];
  for (const q of life.quests) {
    if (q.id !== id || q.done) continue;
    q.progress = Math.min(q.goal, q.progress + amount);
    if (q.progress >= q.goal) { q.done = true; finished.push(q); }
  }
  return finished;
}

// ---------- the first-day guide ----------
export const GUIDE = [
  { text: "Take out your phone (P or 1, or from the inventory)", hint: "Everything you own and can do is in it." },
  { text: "Take cash out at an ATM (marked on the map)", hint: "Walk up to one and press E." },
  { text: "Buy something to eat at a restaurant", hint: "Restaurants face the park." },
  { text: "Do a job from the Jobs app", hint: "Courier gigs are the easiest start." },
  { text: "Rent an apartment at an apartment building's reception", hint: "Choose a floor; the first week is free. Find them on the Map." },
] as const;

// ---------- jobs ----------
export type JobId = "courier" | "delivery" | "busker" | "clerk";
export const JOBS: Record<JobId, { name: string; code: string; blurb: string; base: number; minLevel: number; needsBike?: boolean }> = {
  courier: { name: "Courier gig", code: "J14", blurb: "Pick up a parcel and walk it to the address. Paid by distance.", base: 14, minLevel: 1 },
  delivery: { name: "Bike delivery", code: "J2", blurb: "Collect a take-out order at a restaurant and ride it to the customer. Tips for speed.", base: 24, minLevel: 2, needsBike: true },
  busker: { name: "Street performer", code: "J13", blurb: "Play music at the park's spot; people walking past drop tips.", base: 0, minLevel: 1 },
  clerk: { name: "Shop clerk", code: "J10", blurb: "Restock the shelves at Fresh Market in a 40-second shift. Paid per shelf.", base: 6, minLevel: 1 },
};
/** Pay for carrying something `metres` in `seconds` (a tip for beating the expected time). */
export function deliveryPay(job: JobId, metres: number, seconds: number) {
  const base = JOBS[job].base + metres * (job === "delivery" ? 0.06 : 0.05);
  const expected = metres / (job === "delivery" ? 6 : 1.6) + 20;
  const tip = seconds < expected ? Math.min(base * 0.5, (expected - seconds) * 0.2) : 0;
  return { base: round(base), tip: round(tip) };
}
