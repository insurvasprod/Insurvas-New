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
      className={cn(className, "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
      style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
    >
      {children}
    </div>
  );
}
