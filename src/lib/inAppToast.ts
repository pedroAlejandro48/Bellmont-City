/**
 * Notifications drawn inside the game's own window (the Windows app): Windows keeps its notifications from popping
 * up while a full-screen app is in front, and the app is always full screen, so the game shows them itself — a card
 * in the top-right corner (the picture, the title, a few lines of text) that slides in, stays 6 seconds and goes;
 * several stack. One with the same tag replaces the older one. Clicking a message's card opens that chat when the
 * menu is showing (the "bellmont-open-chat" event); clicking any card closes it.
 */
const SHOW_MS = 6000;
let box: HTMLDivElement | null = null;

/** Takes a card away (its chat was read). */
export function removeInAppToast(tag: string) {
  box?.querySelector(`[data-tag="${CSS.escape(tag)}"]`)?.remove();
}

export function inAppToast(title: string, body: string, tag: string, icon?: string, link?: string) {
  if (typeof document === "undefined") return;
  if (!box || !box.isConnected) {
    box = document.createElement("div");
    box.className = "app-toasts";
    document.body.appendChild(box);
  }
  box.querySelector(`[data-tag="${CSS.escape(tag)}"]`)?.remove();
  const card = document.createElement("button");
  card.type = "button";
  card.className = "app-toast";
  card.dataset["tag"] = tag;
  const img = document.createElement("img");
  img.src = icon || "/icon-192.png";
  img.alt = "";
  if (icon) img.className = "round";
  const text = document.createElement("span");
  const b = document.createElement("b"); b.textContent = title;
  const p = document.createElement("small"); p.textContent = body; p.setAttribute("data-no-translate", "");
  text.append(b, p);
  card.append(img, text);
  const close = () => { card.classList.add("leaving"); setTimeout(() => card.remove(), 250); };
  card.onclick = () => {
    const chat = link ? new URL(link, location.origin).searchParams.get("chat") : null;
    if (chat) window.dispatchEvent(new CustomEvent("bellmont-open-chat", { detail: chat }));
    close();
  };
  box.prepend(card);
  while (box.children.length > 4) box.lastElementChild?.remove();
  setTimeout(close, SHOW_MS);
}
