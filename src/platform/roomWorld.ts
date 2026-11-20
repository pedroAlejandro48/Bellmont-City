// What a room keeps for good, whoever is in it (Firestore, under rooms/<CODE>): the things put down anywhere
// (`ground`), each apartment's kitchen — cupboard, counter, sink, stoves, table, fridge — (`apts`, the same documents the
// players share live), and who lives where with their door locked or not (`homes`). So what one player leaves is
// still there for the others after they've gone, and when they come back.
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { firestore } from "./firebase";

export type GroundDoc = { id: string; kind: string; x: number; z: number; y?: number; yaw: number; contents?: string[]; by: string; at: number };
export type AptStored = { key: string; n: number; j: string };
export type HomeStored = { uid: string; b: string; floor: number; locked: boolean };
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function watchGround(code: string, on: (items: GroundDoc[]) => void) {
  return onSnapshot(collection(firestore, "rooms", code, "ground"), (snap) => on(snap.docs.flatMap((d) => {
    const v = d.data();
    if (typeof v["kind"] !== "string" || !num(v["x"]) || !num(v["z"]) || !num(v["yaw"])) return [];
    return [{ id: d.id, kind: v["kind"], x: v["x"], z: v["z"], ...(num(v["y"]) ? { y: v["y"] } : {}), yaw: v["yaw"], ...(Array.isArray(v["contents"]) ? { contents: (v["contents"] as unknown[]).filter((c): c is string => typeof c === "string") } : {}), by: typeof v["by"] === "string" ? v["by"] : "", at: num(v["at"]) ? v["at"] : 0 }];
  })), () => {});
}
export const putGround = (code: string, g: GroundDoc) => { const { id, ...rest } = g; return setDoc(doc(firestore, "rooms", code, "ground", id), rest); };
export const takeGround = (code: string, id: string) => deleteDoc(doc(firestore, "rooms", code, "ground", id));

/** Firestore document ids can't hold "/" (a floor key is "x:z#floor"). */
const aptId = (key: string) => key.replace(/\//g, "_");
export function watchApts(code: string, on: (docs: AptStored[]) => void) {
  return onSnapshot(collection(firestore, "rooms", code, "apts"), (snap) => on(snap.docs.flatMap((d) => {
    const v = d.data();
    return typeof v["key"] === "string" && num(v["n"]) && typeof v["j"] === "string" ? [{ key: v["key"], n: v["n"], j: v["j"] }] : [];
  })), () => {});
}
export const saveApt = (code: string, a: AptStored) => setDoc(doc(firestore, "rooms", code, "apts", aptId(a.key)), a);

export function watchHomes(code: string, on: (homes: HomeStored[]) => void) {
  return onSnapshot(collection(firestore, "rooms", code, "homes"), (snap) => on(snap.docs.flatMap((d) => {
    const v = d.data();
    return typeof v["b"] === "string" && num(v["floor"]) && typeof v["locked"] === "boolean" ? [{ uid: d.id, b: v["b"], floor: v["floor"], locked: v["locked"] }] : [];
  })), () => {});
}
export const saveHome = (code: string, uid: string, h: { b: string; floor: number; locked: boolean } | null) =>
  h ? setDoc(doc(firestore, "rooms", code, "homes", uid), h) : deleteDoc(doc(firestore, "rooms", code, "homes", uid));
