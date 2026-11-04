import { useLayoutEffect } from "react";
import { obeliskRight } from "./cityBackdrop";

/**
 * On horizontal screens, the pages before the game put their titles in the space between the backdrop's obelisk
 * and the form box, centred there, with the main title shrunk to fit on one line if the space is narrow (a phone on
 * its side). Upright screens are left as they are.
 */
export function useTitleBetweenObeliskAndForm() {
  useLayoutEffect(() => {
    const fit = () => {
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
    const late = window.setTimeout(fit, 400);
    return () => { window.removeEventListener("resize", fit); window.clearTimeout(late); };
  });
}
