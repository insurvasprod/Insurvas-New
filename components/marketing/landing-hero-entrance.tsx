"use client";

import { useEffect } from "react";
import { createTimeline, stagger } from "animejs";

/**
 * The hero's entrance, choreographed with anime.js: the headline rises word by word out of its
 * line, then the supporting copy, the actions, the proof and the river settle in behind it.
 * Renders nothing. Before hydration (and without JS, or with reduced motion) the hero is simply
 * visible: the hidden start state lives in CSS under `@media (scripting: enabled)` with a late
 * fallback, and this timeline only animates from it.
 */
export function LandingHeroEntrance() {
  useEffect(() => {
    const hero = document.querySelector("[data-landing-hero]");
    if (!hero) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const words = hero.querySelectorAll("[data-word]");
    const rest = hero.querySelectorAll("[data-enter]");
    // While the logo intro plays (landing-intro.tsx), the headline waits and rises as its cover
    // dissolves. The cover's clock starts with the page, not with this script, so the wait is what is
    // left of its 1.65s (performance.now() counts from the start of the page load).
    const hold = document.documentElement.dataset.intro === "play" ? Math.max(0, 1600 - performance.now()) : 0;
    const timeline = createTimeline({ defaults: { ease: "outExpo", duration: 1100 } })
      .add(words, { opacity: [0, 1], translateY: ["105%", "0%"], rotate: [4, 0], delay: stagger(70) }, 120 + hold)
      .add(rest, { opacity: [0, 1], translateY: [18, 0], delay: stagger(110) }, 420 + hold);
    return () => { timeline.revert(); };
  }, []);
  return null;
}
