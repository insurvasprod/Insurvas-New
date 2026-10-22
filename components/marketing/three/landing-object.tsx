"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { LandingObjectKind } from "./three-object";

/**
 * The landing page's 3D objects, code-split: three.js loads after first paint and only on the
 * pages that show one. Until it arrives (and wherever WebGL is unavailable) the box is empty and
 * decorative — every word on the page is ordinary HTML beside it.
 *
 * Each object is only created once its box comes within a screen of the viewport (2026-10-13): the
 * globe, the shield and the card used to build their scenes — two of them with an environment map —
 * all at page load, which froze the landing intro for over half a second. Nor while the intro plays
 * (html.intro-play until intro-done, 2026-10-22): the hero's ribbon is in view from the start, and
 * creating its WebGL context 0.2 s into the 3D shot stalled it for 200 ms.
 */
const ThreeObject = dynamic(() => import("./three-object"), { ssr: false, loading: () => null });

// Whether the landing intro is out of the way, read from <html>'s classes.
const introOver = () => {
  const classes = document.documentElement.classList;
  return !classes.contains("intro-play") || classes.contains("intro-done");
};
const watchIntro = (onChange: () => void) => {
  const watcher = new MutationObserver(onChange);
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => watcher.disconnect();
};

export function LandingObject({ kind, className }: { kind: LandingObjectKind; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const clear = useSyncExternalStore(watchIntro, introOver, () => false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setNear(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: "100% 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);
  return (
    <div ref={ref} aria-hidden="true" className={className}>
      {near && clear && <ThreeObject kind={kind} />}
    </div>
  );
}
