"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { motionEase, motionMs, reducedMotion } from "@/components/ui/motion-tokens";

/**
 * FLIP (Wave C, plan item 12): items that change place glide from where they were to where they are now, instead of
 * jumping. Mark each item with `data-flip-key`; after every render the hook measures them, and an item whose place moved
 * since the last render is drawn back where it was and slides home: transform only, --t-panel on --e-out.
 *
 * - Places are kept inside the root (the root's own scroll included), so scrolling never reads as a move. An item in a
 *   lane that scrolls on its own sits in a `data-flip-scroll` box; that box's scroll is taken off too.
 * - The root is the caller's ref (the list or board the items sit in).
 * - `place(key, rect)` says where an item truly was before the next render (a dropped card: where the pointer let go),
 *   so it glides from there instead of from its old slot.
 * - Only what someone can see glides: an item off screen at both ends takes its place at once (a board of 500 cards
 *   moves a handful, not all of them).
 * - Reduced motion: places just update.
 * - The glide adds to whatever else the item plays (`composite: "add"`), so a card can glide and settle (m-drop-in) at once.
 */
type Spot = { x: number; y: number; scroller: HTMLElement | null; sx: number; sy: number };

export function useFlip<T extends HTMLElement>(ref: RefObject<T | null>): { place: (key: string, rect: DOMRect) => void } {
  const spots = useRef(new Map<string, Spot>());
  const placed = useRef(new Map<string, DOMRect>());
  const gliding = useRef(new WeakMap<HTMLElement, Animation>());

  const place = useCallback((key: string, rect: DOMRect) => { placed.current.set(key, rect); }, []);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) { spots.current.clear(); placed.current.clear(); return; }
    const items = [...box.querySelectorAll<HTMLElement>("[data-flip-key]")];
    // An item still gliding from the last change: how far its glide has it from its slot right now, so a second change
    // starts from where it shows, not from where it was going.
    const drift = new Map<HTMLElement, { x: number; y: number }>();
    for (const item of items) {
      const glide = gliding.current.get(item);
      if (!glide || glide.playState !== "running") continue;
      const seen = item.getBoundingClientRect();
      glide.cancel();
      const slot = item.getBoundingClientRect();
      drift.set(item, { x: seen.left - slot.left, y: seen.top - slot.top });
    }
    const frame = box.getBoundingClientRect();
    const ox = frame.left - box.scrollLeft;
    const oy = frame.top - box.scrollTop;
    const still = reducedMotion();
    const wide = window.innerWidth;
    const tall = window.innerHeight;
    const next = new Map<string, Spot>();
    const moves: Array<[HTMLElement, number, number]> = [];
    for (const item of items) {
      const key = item.dataset.flipKey as string;
      const rect = item.getBoundingClientRect();
      if (!rect.width && !rect.height) continue; // a folded lane: nothing to see, nothing to move
      const lane = item.parentElement?.closest<HTMLElement>("[data-flip-scroll]") ?? null;
      const scroller = lane && lane !== box && box.contains(lane) ? lane : null;
      const spot: Spot = { x: rect.left - ox, y: rect.top - oy, scroller, sx: scroller?.scrollLeft ?? 0, sy: scroller?.scrollTop ?? 0 };
      next.set(key, spot);
      if (still) continue;
      let from: { x: number; y: number } | null = null;
      const dropped = placed.current.get(key);
      const was = spots.current.get(key);
      if (dropped) from = { x: dropped.left - ox, y: dropped.top - oy };
      else if (was) {
        const shift = was.scroller?.isConnected ? { x: was.scroller.scrollLeft - was.sx, y: was.scroller.scrollTop - was.sy } : { x: 0, y: 0 };
        const off = drift.get(item) ?? { x: 0, y: 0 };
        from = { x: was.x - shift.x + off.x, y: was.y - shift.y + off.y };
      }
      if (!from) continue;
      const dx = from.x - spot.x;
      const dy = from.y - spot.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      const onScreen = (left: number, top: number) => top < tall && top + rect.height > 0 && left < wide && left + rect.width > 0;
      if (!onScreen(rect.left, rect.top) && !onScreen(rect.left + dx, rect.top + dy)) continue;
      moves.push([item, dx, dy]);
    }
    spots.current = next;
    placed.current.clear();
    if (!moves.length) return;
    const duration = motionMs("--t-panel", 200);
    const easing = motionEase("--e-out", "cubic-bezier(.16, 1, .3, 1)");
    for (const [item, dx, dy] of moves) {
      gliding.current.set(item, item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration, easing, composite: "add" }));
    }
  });

  return { place };
}
