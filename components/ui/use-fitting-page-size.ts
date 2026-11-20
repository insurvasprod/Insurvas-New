"use client";

import { useEffect, useState } from "react";

import { fillLine, scroller } from "./table-card-layout";

/**
 * The most rows a page ever shows. The owner's 10-row cap (2026-10-13) gave way on 2026-10-30: "make
 * sure that the table lines are dynamic for how much the height left there is available".
 */
export const MAX_ROWS = 50;

/** The shell's padding under the page (p-4, sm:p-6, lg:p-8). */
function bottomGap() {
  return window.innerWidth >= 1024 ? 32 : window.innerWidth >= 640 ? 24 : 16;
}

/**
 * The list on screen: the one table card that draws a pager. Hidden tabs are skipped; with two such
 * lists on one page nothing is measured and the estimate below is used.
 */
function listCard(): HTMLElement | null {
  const cards = [...document.querySelectorAll<HTMLElement>('main [data-slot="table-card"]')]
    .filter((card) => card.offsetParent !== null && card.querySelector('nav[aria-label$=" pages"]'));
  return cards.length === 1 ? cards[0] : null;
}

/**
 * Rows per page: exactly as many as fit the window under the table's own head, with the pager at the
 * window's foot (owner 2026-10-30).
 *
 * Measured, not guessed: where the list's first row starts, how tall its footer is, and how tall its
 * rows really are (a two-line row counts as one), so a page with a tall strip or an open filter panel
 * gets fewer rows and a bare list gets more. Re-measured whenever the window or the page above the
 * list changes size. Until the list is drawn, and on a page with two paged lists, `reserved` (the
 * page's chrome in pixels) and `rowHeight` give the estimate.
 *
 * One hook (2026-10-09): the redesign had nine copies of it.
 */
export function useFittingPageSize(reserved: number, rowHeight: number, { fallback = 10, min = 5, max = MAX_ROWS }: { fallback?: number; min?: number; max?: number } = {}) {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const clamp = (rows: number) => Math.min(max, MAX_ROWS, Math.max(min, rows));
    const estimate = () => {
      const header = document.querySelector<HTMLElement>('main [data-page-header="visible"]')?.getBoundingClientRect().height ?? 0;
      return clamp(Math.floor((window.innerHeight - reserved - header) / rowHeight));
    };
    // From the room alone: how many rows of the height they have fit between the rows' top and the line, whatever is
    // showing now. 2026-11-19 (owner: the Policies list flipped between 9 and 10 rows): sizing from the rows on screen
    // chased its own last render (shrink on 10, grow on 9), and a measure inside the state updater read the page
    // mid-update. Measured once per frame, outside React's update, it settles in one step.
    const measure = (current: number) => {
      const card = listCard();
      const body = card?.querySelector<HTMLElement>("tbody");
      if (!card || !body) return current;
      const rows = [...body.children].map((row) => (row as HTMLElement).offsetHeight).filter(Boolean);
      if (!rows.length) return current;
      // The usual row: the most common height, so one two-line row does not shrink the page.
      const counts = new Map<number, number>();
      for (const height of rows) counts.set(height, (counts.get(height) ?? 0) + 1);
      const each = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
      const footer = card.lastElementChild !== body.closest(".overflow-x-auto") ? (card.lastElementChild as HTMLElement | null)?.offsetHeight ?? 0 : 0;
      // The line the card may reach (table foundation §6b): a merged page's column foot, less a footnote
      // under the card (Files' stage legend, owner 2026-11-02: "remove that scroll"); else the window's.
      // Both the line and the body's top are measured as if the box were scrolled to its top.
      const box = scroller(card);
      const offset = box ? box.scrollTop : window.scrollY;
      const line = fillLine(card) ?? window.innerHeight - bottomGap();
      const top = body.getBoundingClientRect().top + offset;
      // The card's own border at the foot, and a pixel so rounding never adds a scrollbar.
      const room = line - top - footer - 2;
      const fits = clamp(Math.floor(room / each));
      // A short last page leaves room on purpose: it keeps the size the full pages have.
      if (rows.length < current && fits >= rows.length) return current;
      return fits;
    };
    let frame = 0;
    let size = fallback;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measure(size);
        if (next !== size) { size = next; setSize(next); }
      });
    };
    size = estimate();
    setSize(size); // eslint-disable-line react-hooks/set-state-in-effect
    fit();
    // Anything above the list that grows or shrinks (a strip loading, a filter panel opening) moves it.
    const main = document.querySelector("main");
    const observer = main ? new ResizeObserver(fit) : null;
    if (main) observer?.observe(main);
    // The list's rows arrive after the hook first runs, and inside a fixed-height frame nothing
    // resizes when they do: measure again whenever the page's content changes (at most once a frame).
    const changes = main ? new MutationObserver(fit) : null;
    if (main) changes?.observe(main, { childList: true, subtree: true });
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); changes?.disconnect(); window.removeEventListener("resize", fit); };
  }, [reserved, rowHeight, min, max, fallback]);
  return size;
}
