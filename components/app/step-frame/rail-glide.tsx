"use client";

import { useEffect, useState, type RefObject } from "react";

import { motionMs, reducedMotion } from "@/components/ui/motion-tokens";
import { useGlidePill, type GlidePill } from "@/components/ui/tab-track";

/**
 * The open step's highlight on a rail (Tier 1 motion, Wave A 2026-11-17): one soft pill behind the steps that slides
 * to the step you pick, as the tabs' pill does (useGlidePill). It moves to a clicked step at once, while its page is on
 * its way, and the next page's rail starts it where this one left it (`remember`), so a step change reads as one
 * glide rather than a cut. StepRail, ReportsRail and LeadsInRail all draw it; the list is the track, its links the items.
 */
export function useRailGlide(list: RefObject<HTMLUListElement | null>, name: string): GlidePill {
  return useGlidePill(list, { items: ":scope > li > a", chosen: '[aria-current="page"]', watch: "aria-current", remember: `rail:${name}` });
}

/** The pill itself, the list's first item (a list holds only items), out of the reading order. */
export function RailHighlight({ pill }: { pill: GlidePill }) {
  if (!pill) return null;
  return (
    <li
      aria-hidden="true"
      role="presentation"
      data-tab-pill={pill.glide ? "glide" : ""}
      data-tab-indicator="rail"
      style={{ transform: `translate(${pill.left}px, ${pill.top}px)`, width: pill.width, height: pill.height }}
    />
  );
}

/**
 * The amber dot on a collapsed rail's icon corner (Wave D, 2026-11-18): the collapsed twin of the step's CountBadge. It
 * pops in when work appears after the page is up (one there on the first paint comes in with the page) and shrinks away
 * when the step has nothing waiting, the exit shorter than the entrance (m-badge-in / m-badge-out). The count itself is
 * in the step's tooltip.
 */
export function RailCornerDot({ on }: { on: boolean }) {
  const [gone, setGone] = useState(!on);
  if (on && gone) setGone(false);
  const [settled, setSettled] = useState(on);
  if (!on && settled) setSettled(false);
  useEffect(() => {
    if (on) return;
    const timer = window.setTimeout(() => setGone(true), reducedMotion() ? 0 : motionMs("--t-float-out", 120));
    return () => window.clearTimeout(timer);
  }, [on]);
  if (gone) return null;
  return (
    <span
      aria-hidden="true"
      data-count-badge=""
      data-state={!on ? "leaving" : settled ? undefined : "entering"}
      className="absolute top-1.5 right-2 hidden size-2.5 rounded-full bg-[var(--warning)] ring-2 ring-[var(--canvas)] lg:block"
    />
  );
}
