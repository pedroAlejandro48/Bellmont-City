// Flirting with the moon (pure). At night, outdoors, you can talk to the moon: she (or he, if you play a woman)
// answers, and how you talk to her decides how she reacts. At first she's polite and cool and never blushes; as the
// bond grows over several nights she warms up, smiles, laughs, and — once she's fond of you — blushes. The bond is
// saved with your life.

export type MoonBond = { affection: number; nights: number; lastNight: number; talkedTonight: number };
export const newMoonBond = (): MoonBond => ({ affection: 0, nights: 0, lastNight: -1, talkedTonight: 0 });
export function readMoonBond(v: unknown): MoonBond {
  const b = newMoonBond();
  if (!v || typeof v !== "object") return b;
  const o = v as Record<string, unknown>, num = (k: string, lo: number, hi: number, d: number) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? Math.max(lo, Math.min(hi, o[k] as number)) : d);
  return { affection: num("affection", 0, 100, 0), nights: num("nights", 0, 1e6, 0), lastNight: num("lastNight", -1, 1e9, -1), talkedTonight: num("talkedTonight", 0, 10, 0) };
}

/** Who the moon is for this player: a woman's moon is a man, anyone else's a woman. */
export type MoonPerson = { name: string; she: boolean; they: string; them: string; their: string };
export const moonFor = (gender: "female" | "male" | null): MoonPerson =>
  gender === "female" ? { name: "Lucio", she: false, they: "he", them: "him", their: "his" } : { name: "Luna", she: true, they: "she", them: "her", their: "her" };

/** How far along it is: cool → curious → fond (blushes) → smitten (blushes a lot). */
export type Stage = "cool" | "curious" | "fond" | "smitten";
export const stageOf = (a: number): Stage => (a < 20 ? "cool" : a < 45 ? "curious" : a < 75 ? "fond" : "smitten");
/** She blushes only once she's fond of you; more as she falls for you, more still when something lands. */
export function blushFor(a: number, mood: Mood) {
  if (a < 45) return 0;
  const base = Math.min(1, (a - 45) / 45) * 0.5;
  return Math.min(1, base + (mood === "blush" ? 0.5 : mood === "smile" || mood === "laugh" ? 0.15 : 0));
}
export type Mood = "neutral" | "smile" | "laugh" | "blush" | "annoyed" | "sad" | "surprised";
/** What you can say: its kind (what it does) and the words. */
export type Kind = "sweet" | "poetic" | "funny" | "curious" | "bold" | "rude";
export type Line = { kind: Kind; text: string };

/** Things to say, by kind (`{you}` is how you call them: "beautiful" / "handsome"). */
const SAY: Record<Kind, string[]> = {
  sweet: ["You light up my whole night.", "I came outside just to see you.", "You look wonderful tonight, {you}.", "The city's prettier with you above it."],
  poetic: ["Even the stars look at you when you rise.", "You pull the tides, and I think you pull me too.", "You're the only light I never get tired of.", "Every night you shine a little differently, and I like every one."],
  funny: ["Are you made of cheese? Because you're grate.", "I'd ask you to dinner, but you're always so full.", "You must be tired, you've been circling my mind all night.", "Is it hot up there, or is it just you?"],
  curious: ["What do you see from up there?", "Do you ever get lonely?", "Which city lights do you like best?", "What do you think about all night?"],
  bold: ["Come down here and talk to me properly.", "One day I'll fly up there for you.", "Admit it, you only shine this bright for me.", "I think you're a little bit in love with me."],
  rude: ["You're just a big rock.", "The sun's way brighter than you.", "Honestly, you're kind of pale.", "Why do you keep following me around?"],
};
/** How each kind lands, by stage: the change in affection and her mood. Too bold too soon puts her off. */
const LANDS: Record<Kind, Record<Stage, [number, Mood]>> = {
  sweet: { cool: [5, "smile"], curious: [6, "smile"], fond: [6, "blush"], smitten: [5, "blush"] },
  poetic: { cool: [6, "surprised"], curious: [7, "smile"], fond: [8, "blush"], smitten: [6, "blush"] },
  funny: { cool: [3, "laugh"], curious: [5, "laugh"], fond: [5, "laugh"], smitten: [4, "laugh"] },
  curious: { cool: [4, "smile"], curious: [4, "smile"], fond: [4, "smile"], smitten: [3, "smile"] },
  bold: { cool: [-4, "annoyed"], curious: [1, "surprised"], fond: [7, "blush"], smitten: [9, "blush"] },
  rude: { cool: [-8, "annoyed"], curious: [-10, "sad"], fond: [-12, "sad"], smitten: [-12, "sad"] },
};
/** What she says back, by kind and stage. */
const REPLY: Record<Kind, Record<Stage, string[]>> = {
  sweet: {
    cool: ["That's kind of you. I hear it a lot, you know.", "Thank you. You're polite, for an earthling."],
    curious: ["You came out just for me? That's… nice.", "Hm. You're sweeter than most of them down there."],
    fond: ["Oh — stop it, you'll make me glow.", "You always know what to say to me."],
    smitten: ["I wait all day for you to come out, you know.", "And you light up mine. Every single night."],
  },
  poetic: {
    cool: ["Oh. That was… actually rather lovely.", "A poet? I didn't expect that from you."],
    curious: ["Say that again. Slowly.", "You've been thinking about me, haven't you?"],
    fond: ["Nobody's ever said it like that to me…", "You're going to make me shine brighter than the sun."],
    smitten: ["I'd pull every tide on Earth toward you.", "Keep talking like that and I'll never set."],
  },
  funny: {
    cool: ["Ha. Cheesy. But I'll allow it.", "That was terrible. I'm laughing anyway."],
    curious: ["You're ridiculous. I like it.", "Ha! Okay, that one was good."],
    fond: ["Stop, you're making my craters ache!", "You always make me laugh, even when it's terrible."],
    smitten: ["Only you could make a rock giggle like this.", "I laughed so hard I nearly eclipsed."],
  },
  curious: {
    cool: ["Mostly rooftops. And people who never look up.", "Everything. It gets quiet up here."],
    curious: ["I see you, mostly. Walking about at night.", "Sometimes. The stars don't talk much."],
    fond: ["I watch your window to see if you're still up.", "I think about whoever comes out to talk to me."],
    smitten: ["I think about you. Is that strange?", "Your street. It's my favourite, because you're on it."],
  },
  bold: {
    cool: ["Excuse me? We've only just met.", "Slow down, earthling."],
    curious: ["Bold. Very bold… I'll think about it.", "Is that so? We'll see."],
    fond: ["Maybe… maybe I do shine a bit more for you.", "Don't say things like that, I'll go all red."],
    smitten: ["Then hurry. I'll be waiting right here.", "…Maybe a little. Okay. More than a little."],
  },
  rude: {
    cool: ["Well. Goodnight, then.", "Charming. Truly."],
    curious: ["I thought you were different.", "That hurt more than you'd think."],
    fond: ["Why would you say that to me?", "…I'll just hide behind a cloud for a bit."],
    smitten: ["After everything? Really?", "I didn't think you'd ever say that to me."],
  },
};
/** Her opening line, by stage (and whether it's a new night or you came back again tonight). */
const HELLO: Record<Stage, string[]> = {
  cool: ["Oh. Hello down there.", "Can I help you, earthling?", "You're staring at me again."],
  curious: ["You're back. I noticed.", "Out late again, are we?", "Oh, it's you. Hi."],
  fond: ["There you are! I was hoping you'd come out.", "Hi, you. I've been waiting.", "I saved my best glow for you."],
  smitten: ["Finally! I missed you all day.", "My favourite person on the whole planet.", "I've been shining just for you."],
};
const BYE: Record<Stage, string> = {
  cool: "Well. Goodnight, earthling.",
  curious: "Goodnight. Maybe come back tomorrow?",
  fond: "Goodnight… come back tomorrow night, okay?",
  smitten: "Goodnight, my love. I'll watch over you while you sleep.",
};
/** Talking more than three times a night: she wants you to come back another night. */
export const ROUNDS = 3;

const pick = <T,>(list: T[], r: () => number) => list[Math.floor(r() * list.length) % list.length]!;
/** Her greeting when you start talking tonight (`again`: already talked tonight). */
export function greeting(bond: MoonBond, r: () => number) { return pick(HELLO[stageOf(bond.affection)], r); }
export const goodbye = (bond: MoonBond) => BYE[stageOf(bond.affection)];
/** Four different things you could say now (one rude among them only sometimes). */
export function choices(gender: "female" | "male" | null, r: () => number): Line[] {
  const you = gender === "female" ? "handsome" : "beautiful";
  const kinds: Kind[] = ["sweet", "poetic", "funny", "curious", "bold", "rude"];
  const pool = kinds.filter((k) => k !== "rude" || r() < 0.5).sort(() => r() - 0.5).slice(0, 4);
  return pool.map((kind) => ({ kind, text: pick(SAY[kind], r).replace("{you}", you) }));
}
/** Saying something: her mood and reply, and the bond after it. */
export function say(bond: MoonBond, line: Line, r: () => number): { mood: Mood; reply: string; bond: MoonBond } {
  const stage = stageOf(bond.affection), [d, mood] = LANDS[line.kind][stage];
  // (Repeating the same night is worth less: the first words count most.)
  const gain = d > 0 ? d * (bond.talkedTonight === 0 ? 1.2 : 1) : d;
  return { mood, reply: pick(REPLY[line.kind][stage], r), bond: { ...bond, affection: Math.max(0, Math.min(100, bond.affection + gain)) } };
}
/** Starting a talk on night `night` (game day): a new night counts. */
export function startTalk(bond: MoonBond, night: number): MoonBond {
  if (bond.lastNight !== night) return { ...bond, lastNight: night, talkedTonight: 0, nights: bond.nights + 1 };
  return bond;
}
