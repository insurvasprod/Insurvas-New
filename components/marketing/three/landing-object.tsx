"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { LandingObjectKind } from "./three-object";

/**
 * The landing page's 3D objects, code-split: three.js loads after first paint and only on the
 * pages that show one. Until it arrives (and wherever WebGL is unavailable) the box is empty and
 * decorative — every word on the page is ordinary HTML beside it.
 *
 * Each object is only created once its box comes within a screen of the viewport (2026-10-13): the
 * globe, the shield and the card used to build their scenes — two of them with an environment map —
 * all at page load, which froze the landing intro for over half a second.
 */
const ThreeObject = dynamic(() => import("./three-object"), { ssr: false, loading: () => null });

export function LandingObject({ kind, className }: { kind: LandingObjectKind; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
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
      {near && <ThreeObject kind={kind} />}
    </div>
  );
}
