// Life while playing: daily bills and goals, distances walked and ridden, pay for work, and what each earns in
// experience and skill, with a message on screen for each.
import { timeInfo } from "./config";
import { GUIDE, QUEST_TEXT, dailyBills, gainSkill, gainXp, payslip, progressQuest, record, rollQuests, SKILL_NAMES, type JobId, type QuestId, type Skill } from "./life";
import { toast, type GameState } from "./state";

const money = (n: number) => `$${n.toFixed(2)}`;

function levelUp(state: GameState, level: number | null) {
  if (level) toast(state, `Level ${level}!`, "level", "New jobs and homes may be open to you.");
}
function skillUp(state: GameState, skill: Skill, level: number | null) {
  if (level) toast(state, `${SKILL_NAMES[skill]} ${level}`, "level", "Skill improved.");
}

/** Something happened that a daily goal counts (eating, riding, a job done, an ATM used...). */
export function lifeEvent(state: GameState, id: QuestId, amount = 1) {
  const day = timeInfo(state.elapsed).day;
  for (const q of progressQuest(state.life, id, amount)) {
    state.life.bank = Math.round((state.life.bank + q.reward) * 100) / 100;
    record(state.life, day, "Daily goal reward", q.reward);
    toast(state, "Goal done", "quest", `${QUEST_TEXT[q.id](q)} — +$${q.reward}, +25 XP`);
    levelUp(state, gainXp(state.life, 25));
  }
}

/** The first-day guide moves on when the player does its step. */
export function guideDone(state: GameState, step: number) {
  if (state.life.guide !== step) return;
  state.life.guide = step + 1;
  levelUp(state, gainXp(state.life, 20));
  const next = GUIDE[step + 1];
  toast(state, next ? "Next step" : "Guide finished", "info", next ? next.text : "You know your way around. Enjoy Bellmont!");
}

/** Pay for a finished job: taxed, paid into the bank (the tip in cash), with experience and work skill. */
export function payJob(state: GameState, job: JobId, label: string, base: number, tip: number) {
  const day = timeInfo(state.elapsed).day, life = state.life;
  const slip = payslip(base, life.skills.work);
  life.bank = Math.round((life.bank + slip.net) * 100) / 100;
  record(life, day, `${label} (after ${money(slip.tax)} tax)`, slip.net);
  if (tip > 0) { state.cash = Math.round((state.cash + tip) * 100) / 100; record(life, day, `${label}: tip (cash)`, tip); }
  life.earned += slip.net + tip; life.jobsDone += 1;
  toast(state, `Paid ${money(slip.net + tip)}`, "money", `${money(slip.net)} into your bank (${money(slip.gross)} − ${money(slip.tax)} tax)${tip > 0 ? ` · ${money(tip)} tip in cash` : ""}`);
  levelUp(state, gainXp(state.life, 30 + Math.round(base / 2)));
  skillUp(state, "work", gainSkill(life, "work", 20));
  lifeEvent(state, "work", 1);
  lifeEvent(state, "earn", slip.net + tip);
  if (job) guideDone(state, 3);
}

/** Called every frame: the daily roll-over, distances, skills. */
export function stepLife(state: GameState, dt: number, moved: { walked: number; ridden: number; ran: boolean }) {
  const { day } = timeInfo(state.elapsed), life = state.life;
  if (day > life.billedDay) {
    const lines = dailyBills(life, day);
    const evicted = lines.find((l) => l.label.startsWith("Evicted"));
    if (evicted) toast(state, "You've been evicted", "warn", "Your rent couldn't be paid from the bank. The key was taken and everything in the apartment is gone.");
    const paid = lines.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0), unpaid = lines.some((l) => l.label.includes("unpaid"));
    if (paid > 0 || unpaid) toast(state, unpaid ? "Some bills went unpaid" : `Bills paid: ${money(paid)}`, unpaid ? "warn" : "money", unpaid ? "They were added to your loan and your credit score dropped." : "Rent, utilities and phone, from your bank.");
  }
  if (day !== life.questDay) { life.quests = rollQuests(day); life.questDay = day; toast(state, "New day, new goals", "quest", "See them in the phone's Goals app."); }
  if (moved.walked > 0) {
    lifeEvent(state, "walk", moved.walked);
    skillUp(state, "fitness", gainSkill(life, "fitness", moved.walked * (moved.ran ? 0.05 : 0.02)));
  }
  if (moved.ridden > 0) {
    lifeEvent(state, "ride", moved.ridden);
    skillUp(state, "riding", gainSkill(life, "riding", moved.ridden * 0.02));
  }
  void dt;
}
