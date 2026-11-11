// What each hand is holding, whatever it is (pure): food from a restaurant, a thing out of the inventory or an
// empty bottle, the grocery basket or bag, kitchen things. A hand holding one thing can't take another until it's
// let go of (Q puts it down).
import { toast, type GameState } from "./state";

/** What's in a hand (a word for it), or null when it's free. */
export function holding(s: GameState, side: "left" | "right"): string | null {
  const k = s.life.kitchen.hands[side];
  if (side === "left") {
    if (s.hands.left) return "food";
    if (s.groceryBag) return "the grocery bag";
    if (k) return k.ware;
    return null;
  }
  if (s.hands.right) return "food";
  if (s.heldSlot !== null) return "something";
  if (s.heldTrash) return s.heldTrash === "can" ? "an empty can" : "an empty bottle";
  if (s.groceryBasket) return "the basket";
  if (k) return k.ware;
  return null;
}
export const handFree = (s: GameState, side: "left" | "right") => holding(s, side) === null;
/** Something other than kitchen things in a hand. */
export function holdingOther(s: GameState, side: "left" | "right") {
  const k = s.life.kitchen.hands[side];
  return !k && holding(s, side) !== null || (!!k && (side === "left" ? !!(s.hands.left || s.groceryBag) : !!(s.hands.right || s.heldSlot !== null || s.heldTrash || s.groceryBasket)));
}
/** Anything in either hand. */
export const handsBusy = (s: GameState) => holding(s, "left") !== null || holding(s, "right") !== null;
/** Things you can't do holding something (showering, the toilet, washing hands, sleeping, changing clothes,
 * cooking, eating): told, and false, when a hand is full. */
export function needFreeHands(s: GameState, what: string) {
  if (!handsBusy(s)) return true;
  toast(s, "Your hands are full", "warn", `Put down what you're holding (Q) before ${what}.`);
  return false;
}
/** The hands both full (or the one needed): "put it down first". */
export function handsFullMessage(side?: "left" | "right") {
  return { title: side ? `Your ${side} hand is full` : "Your hands are full", body: "Let go of what you're holding first (Q puts it down)." };
}
