// Push notifications for Bellmont City, sent through Firebase Cloud Messaging to every device a player has
// registered (`pushTokens/<uid>/tokens/<token>`, written by the game):
//   • someone sends you a friend request      (friends/<you>/requests/<them> created)
//   • someone accepts your friend request     (friends/<you>/list/<them> created by them: `by` is their id)
//   • a friend invites you to a room           (friends/<you>/invites/<code> created)
// Addresses that no longer work (app uninstalled, notifications turned off) are removed.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ maxInstances: 5 });
const db = getFirestore();

async function notify(uid, title, body, tag, link = "/") {
  const snap = await db.collection("pushTokens").doc(uid).collection("tokens").get();
  const tokens = snap.docs.map((d) => d.id);
  if (!tokens.length) return;
  // Data only: the game's service worker shows it (its own icon, and a tap opens the game).
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: { title, body, tag, link },
    webpush: { headers: { Urgency: "high", TTL: "86400" } },
  });
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code ?? "";
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token" || code === "messaging/invalid-argument") dead.push(tokens[i]);
  });
  await Promise.all(dead.map((t) => db.collection("pushTokens").doc(uid).collection("tokens").doc(t).delete().catch(() => {})));
}

export const onFriendRequest = onDocumentCreated("friends/{owner}/requests/{from}", async (event) => {
  const name = event.data?.get("name") || "Someone";
  await notify(event.params.owner, "New friend request", `${name} wants to be your friend.`, `req-${event.params.from}`);
});

export const onFriendAccepted = onDocumentCreated("friends/{owner}/list/{other}", async (event) => {
  // (Both lists are written when a request is accepted; only the one who asked hears about it.)
  const by = event.data?.get("by");
  if (!by || by === event.params.owner) return;
  const name = event.data?.get("name") || "Your friend";
  await notify(event.params.owner, "Friend request accepted", `${name} accepted your friend request.`, `acc-${event.params.other}`);
});

export const onRoomInvite = onDocumentCreated("friends/{owner}/invites/{code}", async (event) => {
  const name = event.data?.get("name") || "A friend";
  const code = event.params.code;
  await notify(event.params.owner, "Room invitation", `${name} invited you to room ${code}.`, `inv-${code}`, `/?room=${code}`);
});
