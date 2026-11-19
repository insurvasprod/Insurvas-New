"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/utils";

/**
 * The scrolling track under a row of segmented tabs.
 *
 * A row with more tabs than width used to scroll with the browser's own scrollbar — on Windows a
 * full-height bar with arrow buttons drawn INSIDE the 36px track, squashing the tabs (Compliance
 * settings, 2026-10-22). The track still scrolls sideways, but with no scrollbar: the edge that hides
 * more tabs fades out instead, a mouse wheel scrolls it sideways, and the selected tab is kept in view.
 *
 * A client island inside ViewTabs, so ViewTabs itself stays usable from server pages.
 */
export function TabTrack({ className, children, indicator = "underline", ...rest }: {
  className: string;
  children: ReactNode;
  /** What slides to the chosen tab: the sub-page bar's 2px green line (the one look, owner 2026-11-09), or a pill. */
  indicator?: "underline" | "pill";
} & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const track = ref.current;
    if (!track) return;
    const measure = () => {
      const max = track.scrollWidth - track.clientWidth;
      setEdges({ start: track.scrollLeft > 1, end: max - track.scrollLeft > 1 });
    };
    // The selected tab in view on first paint (a deep link to the last tab, say).
    const selected = track.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"]');
    if (selected && track.scrollWidth > track.clientWidth) {
      track.scrollLeft = Math.max(0, selected.offsetLeft - (track.clientWidth - selected.offsetWidth) / 2);
    }
    measure();
    // A vertical wheel over an overflowing track scrolls it sideways, not the page.
    const onWheel = (event: WheelEvent) => {
      if (track.scrollWidth <= track.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      track.scrollLeft += event.deltaY;
    };
    track.addEventListener("scroll", measure, { passive: true });
    track.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => {
      track.removeEventListener("scroll", measure);
      track.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, []);

  const pill = useGlidePill(ref);

  const fade = edges.start && edges.end
    ? "linear-gradient(to right, transparent, black 28px, black calc(100% - 28px), transparent)"
    : edges.start
      ? "linear-gradient(to right, transparent, black 28px)"
      : edges.end
        ? "linear-gradient(to right, black calc(100% - 28px), transparent)"
        : undefined;

  return (
    <div
      ref={ref}
      {...rest}
      data-tab-track={pill ? indicator : ""}
      className={cn(className, "relative isolate [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
      style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
    >
      {pill && (
        <span
          aria-hidden="true"
          data-tab-pill={pill.glide ? "glide" : ""}
          data-tab-indicator={indicator}
          style={indicator === "underline"
            ? { transform: `translate(${pill.left}px, ${pill.top + pill.height - 2}px)`, width: pill.width, height: 2 }
            : { transform: `translate(${pill.left}px, ${pill.top}px)`, width: pill.width, height: pill.height }}
        />
      )}
      {children}
    </div>
  );
}

export type GlidePill = { left: number; top: number; width: number; height: number; glide: boolean } | null;

/**
 * Where each remembered pill last sat (`remember`), so a rail that is drawn afresh by the next page (or by the loading
 * state while it comes) starts its pill on the step it came from and glides it to the step that is open now. Written
 * only in the browser, after a placement; the server never reads a value from it.
 */
const lastPlace = new Map<string, NonNullable<GlidePill>>();

/**
 * Where the gliding pill sits (§ Motion, "indicator", 2026-11-09): the chosen tab's pill slides from tab to tab
 * instead of jumping — one pill under the row, sized to the chosen tab, or to the tab just clicked while its view
 * is on its way (a pending marker inside it, nav-pending.tsx). It jumps into place the first time and only glides
 * after that. TabTrack uses it for tabs; the boxed switch (ViewSwitch `glide`) and a rail's active step reuse it
 * with their own `items` and `chosen` (Tier 1, 2026-11-17). The track must be the items' offset parent.
 */
export function useGlidePill(ref: RefObject<HTMLElement | null>, {
  items = ':scope > [role="tab"]',
  chosen = '[aria-selected="true"]',
  watch = "aria-selected",
  remember,
}: {
  items?: string;
  chosen?: string;
  watch?: string;
  /** A name for this track (a rail's label): its pill carries over from the last track of that name, and glides on. */
  remember?: string;
} = {}): GlidePill {
  const [pill, setPill] = useState<GlidePill>(() => {
    const kept = remember && typeof window !== "undefined" ? lastPlace.get(remember) : undefined;
    return kept ? { ...kept, glide: false } : null;
  });
  useEffect(() => {
    const track = ref.current;
    if (!track) return;
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tabs = [...track.querySelectorAll<HTMLElement>(items)];
        const on = tabs.find((tab) => tab.querySelector(":scope > [data-nav-pending]")) ?? tabs.find((tab) => tab.matches(chosen));
        const spot = on ? { left: on.offsetLeft, top: on.offsetTop, width: on.offsetWidth, height: on.offsetHeight } : null;
        if (spot && remember) lastPlace.set(remember, { ...spot, glide: true });
        setPill((now) => (spot ? { ...spot, glide: now !== null } : null));
      });
    };
    place();
    const changes = new MutationObserver(place);
    changes.observe(track, { subtree: true, childList: true, attributes: true, attributeFilter: [watch] });
    const sizes = new ResizeObserver(place);
    sizes.observe(track);
    return () => { cancelAnimationFrame(frame); changes.disconnect(); sizes.disconnect(); };
  }, [ref, items, chosen, watch, remember]);
  return pill;
}
