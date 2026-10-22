"use client";

import { useEffect } from "react";

import { INTRO_WAIT } from "@/components/marketing/intro-timing";

// The two shots: the CSS intro (3.2 s) and the 3D Data Highway (5 s, html.intro-3d). A skip lands
// on each one's hand-off, so the hand-off always plays.
// The CSS shot skips to the start of the mark's flight to the nav, so the landing always plays.
const SHOTS = {
  css: { length: 2500, skipTo: 1600 },
  highway: { length: 2500, skipTo: 1950 },
} as const;

/**
 * The intro's client half.
 *  - Client-side navigation: the inline script in LandingIntro runs only when the page is loaded
 *    from the server; when `/` is reached by a client link React never executes it, so this marks
 *    the session and retires the overlay once the intro has played (the same `intro-done` class).
 *  - Skip: while the intro is playing, a click, key, wheel or touch (or the Skip button) jumps the
 *    intro's clock to its hand-off — and moves the hero's entrance forward by the same amount, so
 *    the two stay one shot. The 3D shot reads the same clock, so it jumps with it.
 *  - It renders the Skip button itself, so the button and the skip share one handler.
 *  - Scrolling is held while the intro plays (wheel, touch and scroll keys), so the page — and the
 *    nav logo the 3D shot's mark flies onto — cannot move underneath it. It is released the moment
 *    the intro is done.
 */
const SKIP_EVENT = "insurvas-intro-skip";

// Where the isotype sits inside the full logo file (public/brand/insurvas-logo.svg), in its units.
const WORDMARK = { x: 69.58, y: 433.47, width: 931.86, height: 217.52 };
const ISOTYPE = { y: 412.35, size: 259.77 };

/** The mark's flight onto the nav logo's isotype, as CSS variables (the page script does the same). */
function measureFlight(root: HTMLElement) {
  const logo = document.querySelector<HTMLElement>('header a[href="/"] .insurvas-logo');
  const mark = document.querySelector<HTMLElement>("[data-intro-stage]");
  if (!logo || !mark) return;
  const box = logo.getBoundingClientRect();
  const from = mark.getBoundingClientRect();
  const scale = Math.min(box.width / WORDMARK.width, box.height / WORDMARK.height);
  const size = ISOTYPE.size * scale;
  const left = box.left + (box.width - WORDMARK.width * scale) / 2;
  const top = box.top + (box.height - WORDMARK.height * scale) / 2 + (ISOTYPE.y - WORDMARK.y) * scale;
  root.style.setProperty("--fly-x", `${left + size / 2 - (from.left + from.width / 2)}px`);
  root.style.setProperty("--fly-y", `${top + size / 2 - (from.top + from.height / 2)}px`);
  root.style.setProperty("--fly-s", String(size / from.width));
}

export function LandingIntroGate({ skipClassName }: { skipClassName: string }) {
  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains("intro-seen") || root.classList.contains("intro-done")) return;
    const shot = () => (root.classList.contains("intro-3d") ? SHOTS.highway : SHOTS.css);
    const fromScript = Boolean((window as Window & { __insurvasIntro?: boolean }).__insurvasIntro);
    const timers: number[] = [];
    const finish = (after: number) => timers.push(window.setTimeout(() => root.classList.add("intro-done"), after));
    if (!fromScript) {
      try { window.sessionStorage.setItem("insurvas-intro", "1"); } catch { /* private mode: it simply plays */ }
      root.classList.add("intro-play", "intro-wait");
      measureFlight(root);
      // As the page script does: the 3D shot takes over while the intro waits, or the CSS shot plays.
      timers.push(window.setTimeout(() => {
        if (root.classList.contains("intro-3d") || root.classList.contains("intro-done")) return;
        root.classList.remove("intro-wait");
        finish(SHOTS.css.length + 100);
      }, INTRO_WAIT));
      finish(INTRO_WAIT + 4200);
    }

    const scope = document.querySelector<HTMLElement>("[data-landing-intro-root]");
    const clockElement = document.querySelector<HTMLElement>("[data-intro-clock]");
    const hero = document.querySelector<HTMLElement>("[data-landing-hero]");
    const header = document.querySelector<HTMLElement>("header");
    const events = ["pointerdown", "keydown", "wheel", "touchstart", SKIP_EVENT] as const;
    const skip = () => {
      events.forEach((name) => window.removeEventListener(name, skip));
      // Nothing has played yet: skipping simply shows the page.
      if (root.classList.contains("intro-wait")) { root.classList.remove("intro-wait"); root.classList.add("intro-done"); return; }
      if (!scope || !clockElement) return;
      const clock = clockElement.getAnimations().find((animation) => animation.timeline === document.timeline);
      const elapsed = typeof clock?.currentTime === "number" ? clock.currentTime : 0;
      const { length, skipTo } = shot();
      const shift = skipTo - elapsed;
      if (shift <= 0) return;
      for (const animation of [...scope.getAnimations({ subtree: true }), ...(hero?.getAnimations({ subtree: true }) ?? []), ...(header?.getAnimations({ subtree: true }) ?? [])]) {
        if (animation.timeline !== document.timeline || typeof animation.currentTime !== "number") continue;
        animation.currentTime += shift;
      }
      // The 3D shot retires itself once its mark has landed; only the CSS shot needs a timer.
      if (!root.classList.contains("intro-3d")) finish(length - skipTo + 200);
    };
    events.forEach((name) => window.addEventListener(name, skip, { passive: true }));

    const SCROLL_KEYS = new Set([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"]);
    const hold = (event: Event) => {
      if (root.classList.contains("intro-done")) return;
      if (event instanceof KeyboardEvent && !SCROLL_KEYS.has(event.key)) return;
      event.preventDefault();
    };
    const held = ["wheel", "touchmove", "keydown"] as const;
    held.forEach((name) => window.addEventListener(name, hold, { passive: false }));
    const releaseScroll = () => held.forEach((name) => window.removeEventListener(name, hold));
    const watcher = new MutationObserver(() => { if (root.classList.contains("intro-done")) { releaseScroll(); watcher.disconnect(); } });
    watcher.observe(root, { attributes: true, attributeFilter: ["class"] });
    // Skipping is offered for the length of a shot once it has started (the wait adds up to INTRO_WAIT).
    timers.push(window.setTimeout(() => events.forEach((name) => window.removeEventListener(name, skip)), SHOTS.highway.length + INTRO_WAIT));

    return () => {
      releaseScroll();
      watcher.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
      events.forEach((name) => window.removeEventListener(name, skip));
    };
  }, []);
  return (
    <button type="button" className={skipClassName} onClick={() => window.dispatchEvent(new Event(SKIP_EVENT))}>
      Skip intro
    </button>
  );
}
