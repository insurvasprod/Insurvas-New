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
    const timeline = createTimeline({ defaults: { ease: "outExpo", duration: 1100 } })
      .add(words, { opacity: [0, 1], translateY: ["105%", "0%"], rotate: [4, 0], delay: stagger(70) }, 120)
      .add(rest, { opacity: [0, 1], translateY: [18, 0], delay: stagger(110) }, 420);
    return () => { timeline.revert(); };
  }, []);
  return null;
}
