import { useLayoutEffect } from "react";
import { obeliskRight } from "./cityBackdrop";

/**
 * On horizontal screens, the pages before the game put their titles in the space between the backdrop's obelisk
 * and the form box, centred there, with the main title shrunk to fit on one line if the space is narrow (a phone on
 * its side). Upright screens are left as they are.
 */
/** A phone (or small tablet) on its side. */
export const HALVES = "(orientation: landscape) and (max-height: 560px)";
export function useTitleBetweenObeliskAndForm() {
  useLayoutEffect(() => {
    // A phone on its side: the screen split at exactly half — the titles centred (as one block) in the left half
    // and the middle of the screen's height, the box's left side on the halfway line (CSS); the box only shrinks
    // (from its top-left corner) if it's taller than the room under the top row.
    const halves = () => {
      const split = document.querySelector<HTMLElement>(".auth-split"), page = document.querySelector<HTMLElement>(".auth-page");
      const titles = split?.querySelector<HTMLElement>(".auth-titles"), h1 = titles?.querySelector<HTMLElement>("h1");
      const right = split?.children[1] as HTMLElement | undefined;
      if (!split || !page || !titles || !h1 || !right) return;
      split.style.transform = ""; titles.style.marginLeft = ""; titles.style.width = ""; h1.style.fontSize = ""; h1.style.whiteSpace = "nowrap";
      const room = titles.clientWidth - 32, wide = h1.scrollWidth, natural = parseFloat(getComputedStyle(h1).fontSize);
      if (wide > room) h1.style.fontSize = `${Math.max(16, natural * room / wide)}px`;
      right.style.transform = "";
      const top = right.getBoundingClientRect().top, space = page.getBoundingClientRect().bottom - top - 8;
      const s = Math.min(1, space / Math.max(1, right.offsetHeight));
      if (s < 1) { right.style.transform = `scale(${s})`; right.style.transformOrigin = "left top"; }
    };
    const fit = () => {
      const split = document.querySelector<HTMLElement>(".auth-split");
      if (window.matchMedia(HALVES).matches) { halves(); return; }
      const right = split?.children[1] as HTMLElement | undefined;
      if (right) right.style.transform = "";
      if (split) split.style.transform = "";
      fitTitle();
      // The whole page on the screen, however short (a browser's bars take room): shrunk to fit, never scrolled.
      const page = document.querySelector<HTMLElement>(".auth-page");
      if (split && page) {
        // (Shrunk from its top: the title and the top of the box stay where they are, whatever the box holds.)
        const cs = getComputedStyle(page), top = split.getBoundingClientRect().top - page.getBoundingClientRect().top;
        const room = page.clientHeight - top - parseFloat(cs.paddingBottom) - 8;
        const s = Math.min(1, room / Math.max(1, split.offsetHeight), (page.clientWidth - 16) / Math.max(1, split.offsetWidth));
        if (s < 1) { split.style.transform = `scale(${s})`; split.style.transformOrigin = "center top"; }
      }
    };
    const fitTitle = () => {
      const titles = document.querySelector<HTMLElement>(".auth-split .auth-titles");
      const box = document.querySelector<HTMLElement>(".auth-split .auth-box");
      const h1 = titles?.querySelector<HTMLElement>("h1");
      if (!titles || !box || !h1) return;
      titles.style.marginLeft = ""; titles.style.width = ""; h1.style.fontSize = ""; h1.style.whiteSpace = "";
      if (!window.matchMedia("(orientation: landscape)").matches) return;
      const left = obeliskRight(window.innerWidth, window.innerHeight) + 14;
      const right = box.getBoundingClientRect().left - 14;
      if (right - left < 120) return;
      const cell = titles.getBoundingClientRect();
      titles.style.marginLeft = `${left - cell.left}px`;
      titles.style.width = `${right - left}px`;
      // The title as large as the page sets it, smaller only if it wouldn't fit on one line.
      h1.style.whiteSpace = "nowrap";
      const natural = parseFloat(getComputedStyle(h1).fontSize), wide = h1.scrollWidth;
      if (wide > (right - left) * 0.96) h1.style.fontSize = `${Math.max(16, natural * (right - left) * 0.96 / wide)}px`;
    };
    fit();
    // Again once the fonts have loaded (the title's width changes), and whenever the screen turns or resizes.
    void document.fonts?.ready.then(fit);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    const late = window.setTimeout(fit, 400);
    return () => { window.removeEventListener("resize", fit); window.visualViewport?.removeEventListener("resize", fit); window.clearTimeout(late); };
  });
}
