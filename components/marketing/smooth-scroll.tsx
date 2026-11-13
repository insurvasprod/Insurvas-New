"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

/**
 * Smooth scrolling on the marketing pages (owner, 7 Nov: Lenis, lenis.dev). A mouse wheel or a
 * trackpad glides instead of stepping; the page still scrolls natively underneath, so every scroll
 * listener, `position: sticky` and the scroll-driven scenes keep working as they are.
 *
 *   phones       their own native scrolling (Lenis leaves touch alone by default): iPhone Safari
 *                keeps its momentum, and the phone scenes stay as tested
 *   anchors      "#features" links glide there, honouring each section's scroll-margin-top
 *   nested       a box that scrolls on its own (a country list, the laptop's page tabs) keeps its wheel
 *   reduced motion: not started at all
 *
 * Rendered once per marketing page, beside the header; the app's pages never load it.
 */
/** Fired on window in the same frame Lenis moves the page (see below). */
export const SMOOTH_SCROLL_EVENT = "insurvas:smooth-scroll";

export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // A longer, softer glide than Lenis's default (lerp .1): each wheel step eases out over more
    // frames, and a slightly shorter step keeps the stacked cards from rushing past (owner, 10 Nov).
    const lenis = new Lenis({ autoRaf: true, anchors: true, allowNestedScroll: true, stopInertiaOnNavigate: true, lerp: 0.07, wheelMultiplier: 0.9 });
    // Lenis moves the page inside its own animation frame, but the browser's `scroll` event for that
    // move arrives a frame later, so a scene that follows the scroll drew one frame behind the page
    // (owner, 13 Nov: the stacked cards "should be smoother"). Scenes listen for this instead and
    // update in the same frame as the move.
    lenis.on("scroll", () => window.dispatchEvent(new Event(SMOOTH_SCROLL_EVENT)));
    return () => lenis.destroy();
  }, []);
  return null;
}
