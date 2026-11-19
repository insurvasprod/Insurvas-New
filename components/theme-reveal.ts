"use client";

import { motionEase, motionMs, reducedMotion } from "@/components/ui/motion-tokens";

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

/**
 * The theme switch's circle reveal (components/public/theme-switch.tsx, and the three-way ThemeToggle since Wave D,
 * 2026-11-18): the new theme spreads out from `origin` as a growing circle. `apply` changes the theme class; it runs
 * inside the view transition so the browser captures the new frame. ThemeProvider sets `theme-switching` while the
 * class changes, so no control's colour transition runs inside the circle (globals.css).
 *
 * Without view transitions, under reduced motion, or when `changes` is false (a choice that leaves the page in the
 * theme it already shows, such as System on a machine already in that theme), it switches at once.
 *
 * Torn down on `transition.finished`, never when the circle's animation ends: the transition lives a frame longer, and
 * in that frame the default 380ms cross-fade of the old and new pictures blinked dark-then-white (owner 2026-11-03,
 * "it flashes").
 */
export function revealTheme(origin: HTMLElement, apply: () => void, changes = true) {
  const root = document.documentElement;
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || reducedMotion() || !changes) {
    apply();
    void root.offsetHeight; // commit the new colours before transitions come back
    requestAnimationFrame(() => root.classList.remove("theme-switching"));
    return;
  }

  const box = origin.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  root.classList.add("theme-reveal");
  const transition = doc.startViewTransition(apply);
  let circle: Animation | null = null;
  transition.ready
    .then(() => {
      // `fill: both` holds the circle shut before it starts and open after it ends, for as long as the transition's
      // pictures live.
      circle = root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: motionMs("--t-reveal", 650), easing: motionEase("--e-out", "cubic-bezier(.16, 1, .3, 1)"), fill: "both", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => undefined);
  transition.finished
    .catch(() => undefined)
    .finally(() => {
      circle?.cancel(); // its picture is gone; `fill: both` would otherwise keep it listed
      root.classList.remove("theme-reveal", "theme-switching");
    });
}
