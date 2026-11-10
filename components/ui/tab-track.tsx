"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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
export function TabTrack({ className, children, ...rest }: { className: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
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

  // The chosen tab's pill slides from tab to tab (§ Motion, "indicator", 2026-11-09) instead of jumping: one pill
  // under the row, sized to the chosen tab — or to the tab just clicked while its view is on its way (a pending
  // marker inside it, nav-pending.tsx). It jumps into place the first time and only glides after that.
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number; glide: boolean } | null>(null);
  useEffect(() => {
    const track = ref.current;
    if (!track) return;
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tabs = [...track.querySelectorAll<HTMLElement>(':scope > [role="tab"]')];
        const on = tabs.find((tab) => tab.querySelector(":scope > [data-nav-pending]")) ?? tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
        setPill((now) => (on ? { left: on.offsetLeft, top: on.offsetTop, width: on.offsetWidth, height: on.offsetHeight, glide: now !== null } : null));
      });
    };
    place();
    const changes = new MutationObserver(place);
    changes.observe(track, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });
    const sizes = new ResizeObserver(place);
    sizes.observe(track);
    return () => { cancelAnimationFrame(frame); changes.disconnect(); sizes.disconnect(); };
  }, []);

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
      data-tab-track={pill ? "pill" : ""}
      className={cn(className, "relative isolate [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
      style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
    >
      {pill && (
        <span
          aria-hidden="true"
          data-tab-pill={pill.glide ? "glide" : ""}
          style={{ transform: `translate(${pill.left}px, ${pill.top}px)`, width: pill.width, height: pill.height }}
        />
      )}
      {children}
    </div>
  );
}
