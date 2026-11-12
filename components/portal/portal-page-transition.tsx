"use client";

import { usePagePathname } from "@/components/ui/page-pathname";
import { useEffect, useLayoutEffect, useRef } from "react";

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
  const pathname = usePagePathname();

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

/** The cascade's last step: sections past the fifth arrive with it, so a page is settled within about 0.4 s. */
const CASCADE_STEPS = 5;
/** How long late content (the loading frame swapped for the page, a skeleton for its data) still settles in. */
const SETTLE_WINDOW_MS = 10_000;
/** Pages that bring their own entrance (the dashboards' m-dash, m-stagger lists) keep it. */
/** The smallest late block that settles in. */
const SETTLE_MIN_HEIGHT = 40;
const OWN_STAGGER = ".m-stagger, .m-dash, .m-dash-ov";

function PageEntrance({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    const direction = document.documentElement.dataset.nav;
    clearNavDirection();
    if (!direction || !node) return;
    // Only what is on screen as the page arrives moves (the page, or its loading state). The calm cascade (owner
    // 2026-11-12, "one thing at a time"): on an `area` move each section of the arriving page — the title line, the
    // strip, each card — rises in turn, 50ms apart. A rail move (forward / back) slides the step's column as one;
    // on a merged page the title and rail stay where they were.
    const movers = [...node.children].flatMap((child) => moversOf(child, direction));
    movers.forEach((mover, index) => stamp(mover, "enter", direction, index));
    // Content that replaces the loading state later settles in place instead of sliding a second time.
    return settleLateContent(node);
  }, []);
  return <div ref={ref} className="portal-page-transition">{children}</div>;
}

/** What moves when `child` arrives: a merged page's step column (its sections, on an `area` move), else the page's sections or the page as one. */
function moversOf(child: Element, direction: string): HTMLElement[] {
  const step = child.matches("[data-step-frame]") ? child : child.querySelector("[data-step-frame]");
  if (step) {
    const columns = [...step.querySelectorAll<HTMLElement>("[data-page-content]")];
    return direction === "area" ? columns.flatMap((column) => (column.querySelector(OWN_STAGGER) ? [column] : sectionsOf(column))) : columns;
  }
  if (direction === "area" && (child.matches(OWN_STAGGER) || child.querySelector(".m-dash, .m-dash-ov"))) return [];
  return direction === "area" ? sectionsOf(child) : [child as HTMLElement];
}

function stamp(element: HTMLElement, kind: "enter" | "settle", value: string, index: number) {
  element.dataset[kind] = value;
  element.style.setProperty("--enter-i", String(Math.min(index, CASCADE_STEPS - 1)));
}

/** What can be drawn: not a template, script or hidden placeholder (a streamed boundary leaves those behind). */
function drawn(parent: Element): HTMLElement[] {
  return [...parent.children].filter((child): child is HTMLElement => child instanceof HTMLElement && !child.hidden && !["TEMPLATE", "SCRIPT", "STYLE", "LINK"].includes(child.tagName) && !child.classList.contains("sr-only"));
}

/**
 * A page's sections: down through single wrappers to the first level that holds several things (the page's column
 * of header, strip and cards), opening `display: contents` boxes, which cannot move on their own.
 */
function sectionsOf(root: Element): HTMLElement[] {
  let node: Element = root;
  for (let depth = 0; depth < 4; depth++) {
    const kids = drawn(node);
    if (kids.length === 0) break;
    if (kids.length === 1) { node = kids[0]; continue; }
    return kids.flatMap((kid) => (getComputedStyle(kid).display === "contents" ? drawn(kid) : [kid]));
  }
  return node instanceof HTMLElement ? [node] : [];
}

/**
 * Content that lands after the frame settles in place (m-content-in, the same 50ms rhythm) instead of sliding a
 * second time: the page replacing its loading frame cascades section by section, a card replacing its skeleton
 * settles. A swap counts when a skeleton left in the same commit. Watched for a few seconds, then let go.
 */
function settleLateContent(root: HTMLElement): () => void {
  const observer = new MutationObserver((records) => {
    const wasSkeleton = records.some((record) => [...record.removedNodes].some((gone) => gone instanceof Element && (gone.matches(".m-skel, [role=status]") || gone.querySelector(".m-skel") !== null)));
    if (!wasSkeleton) return;
    const arrived = records.flatMap((record) => [...record.addedNodes]).filter((added): added is HTMLElement => added instanceof HTMLElement && added.isConnected);
    let index = 0;
    for (const added of arrived) {
      if (added.dataset.enter !== undefined || added.closest(OWN_STAGGER)) continue;
      // Blocks only (a card, a table, a strip): a page number or a count changing on its own just appears.
      for (const section of moversOf(added, "area")) if (section.offsetHeight >= SETTLE_MIN_HEIGHT) stamp(section, "settle", "", index++);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  const stop = window.setTimeout(() => observer.disconnect(), SETTLE_WINDOW_MS);
  return () => { window.clearTimeout(stop); observer.disconnect(); };
}
