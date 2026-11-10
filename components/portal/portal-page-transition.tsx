"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { clearNavDirection, markNavDirection } from "@/components/ui/nav-pending";

/**
 * Remounts route content per pathname, so each page's own m-stagger entrance replays on navigation
 * (back/forward included) without turning the server layouts into client components.
 *
 * Page motion (premium motion foundation, 2026-11-09; docs/design/UI-CONSISTENCY.md § Motion): the link that was
 * clicked says which way the move goes (`transitionTypes` on an IntentLink → `html[data-nav]`, nav-pending.tsx), and
 * the page that arrives stamps it on itself before its first paint (`data-enter`), so only the new page moves —
 * `forward` (down a rail, a record opened) slides in from the right, `back` from the left, anything else rises
 * (`area`). On a merged page only the step's column moves; its title and rail hold still. The browser's back
 * button counts as `back`. A hard load has no mark and no entrance.
 *
 * Not React's <ViewTransition>: a Next navigation here never commits as a pure transition, so React never starts
 * one for it (checked 2026-11-09); this is plain CSS on the arriving page and works in every browser.
 *
 * The wrapper has no box of its own (`display: contents`).
 */
export function PortalPageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The browser's back and forward buttons: treated as going back (the usual case).
  useEffect(() => {
    const onPop = () => markNavDirection(["nav-back"]);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <PageEntrance key={pathname}>
      {children}
    </PageEntrance>
  );
}

function PageEntrance({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    const direction = document.documentElement.dataset.nav;
    clearNavDirection();
    if (!direction || !node) return;
    // Only what is on screen as the page arrives moves (the page, or its loading state): content that replaces the
    // loading state later keeps its own short settle instead of sliding a second time. On a merged page that is the
    // step's column alone; the title and rail stay where they were.
    const movers = [...node.children].flatMap((child) => {
      const step = child.matches("[data-step-frame]") ? child : child.querySelector("[data-step-frame]");
      if (step) return [...step.querySelectorAll<HTMLElement>("[data-page-content]")];
      // A page that brings its own entrance (m-stagger, the dashboard's m-dash) is not raised a second time.
      if (direction === "area" && (child.classList.contains("m-stagger") || child.querySelector(".m-dash, .m-dash-ov"))) return [];
      return [child as HTMLElement];
    });
    for (const mover of movers) mover.dataset.enter = direction;
  }, []);
  return <div ref={ref} className="portal-page-transition">{children}</div>;
}
