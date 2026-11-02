"use client";

import { useEffect, useRef } from "react";

/**
 * The table foundation (owner 2026-11-02), applied by every TableCard to itself:
 *
 *  1. Full height. When the card is the last thing on the page, it reaches the bottom of the screen —
 *     the same line as a merged page's rail foot — and its pager sits on that line. Rows stay at the top;
 *     the card does not end half way down an empty page.
 *  2. Columns spread evenly. "I don't want one side of the page squeezed with data and the other blank."
 *     Each column is measured at its natural width; a column narrower than an equal share of the card is
 *     widened to it, a wider one keeps what it needs, and the leftover is shared out again. No column is
 *     ever narrower than its content (cells do not wrap), and a table that does not fit scrolls sideways
 *     as before. A table opts out with `data-even="off"`.
 */

/** The shell's padding under the page (p-4, sm:p-6, lg:p-8). */
export function bottomGap() {
  return window.innerWidth >= 1024 ? 32 : window.innerWidth >= 640 ? 24 : 16;
}

/** The box the card scrolls in: a merged page's step column, or the window. */
export function scroller(card: HTMLElement): HTMLElement | null {
  for (let node = card.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.clientHeight > 0 && node.tagName !== "MAIN") return node;
  }
  return null;
}

/** True when nothing visible follows the card inside `stop` (the card is the page's last block). */
export function isLast(card: HTMLElement, stop: Element): boolean {
  for (let node: HTMLElement | null = card; node && node !== stop && node !== document.body; node = node.parentElement) {
    for (let next = node.nextElementSibling as HTMLElement | null; next; next = next.nextElementSibling as HTMLElement | null) {
      if (next.offsetHeight > 0 && getComputedStyle(next).position !== "fixed" && getComputedStyle(next).position !== "absolute") return false;
    }
  }
  return true;
}

/** The line a last card reaches: its scroll box's foot (a merged page's rail foot), or the window's. Null when the card is not last. */
export function fillLine(card: HTMLElement): number | null {
  const box = scroller(card);
  const stop = box ?? document.querySelector("main") ?? document.body;
  if (!isLast(card, stop)) return null;
  return box ? box.getBoundingClientRect().bottom - parseFloat(getComputedStyle(box).paddingBottom || "0") : window.innerHeight - bottomGap();
}

function fillHeight(card: HTMLElement) {
  card.style.minHeight = "";
  const bottom = fillLine(card);
  if (bottom === null) return;
  const top = card.getBoundingClientRect().top;
  const room = Math.floor(bottom - top - 2);
  // Only when the card starts on screen and there is room to grow into; never shrink below its content.
  if (top < window.innerHeight && room > card.offsetHeight) card.style.minHeight = `${room}px`;
}

function spreadColumns(table: HTMLTableElement) {
  if (table.dataset.even === "off" || table.offsetParent === null) return;
  const head = table.tHead?.rows[0] ?? table.rows[0];
  if (!head) return;
  const cells = [...head.cells];
  if (cells.length < 2 || cells.some((cell) => cell.colSpan > 1)) return;
  const room = table.parentElement?.clientWidth ?? 0;
  if (!room) return;
  // Natural widths: the table at its content's width, auto layout, none of our widths.
  table.style.tableLayout = "auto";
  table.style.width = "max-content";
  table.style.minWidth = "0";
  for (const cell of cells) if (cell.dataset.evenWidth) { cell.style.width = ""; delete cell.dataset.evenWidth; }
  const natural = cells.map((cell) => cell.getBoundingClientRect().width);
  const total = natural.reduce((sum, width) => sum + width, 0);
  table.style.width = "";
  table.style.minWidth = "";
  if (total >= room - 1) { table.style.tableLayout = ""; return; } // Too wide: keep auto and scroll sideways.
  // Equal shares, but a column that needs more than its share keeps its width; share the rest again.
  const widths = natural.slice();
  let open = cells.map((_, index) => index);
  let left = room;
  for (;;) {
    const share = left / open.length;
    const big = open.filter((index) => natural[index] > share);
    if (!big.length) { for (const index of open) widths[index] = share; break; }
    for (const index of big) { widths[index] = natural[index]; left -= natural[index]; }
    open = open.filter((index) => !big.includes(index));
    if (!open.length) break;
  }
  table.style.tableLayout = "fixed";
  cells.forEach((cell, index) => { cell.style.width = `${Math.floor(widths[index])}px`; cell.dataset.evenWidth = "1"; });
}

export function TableCardLayout() {
  const marker = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    // The marker sits in the card's table area, so the card's first and last blocks keep their corners.
    const area = marker.current?.parentElement;
    const card = area?.closest<HTMLElement>('[data-slot="table-card"]');
    if (!area || !card) return;
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const table of area.querySelectorAll<HTMLTableElement>("table")) spreadColumns(table);
        fillHeight(card);
      });
    };
    run();
    // Rows arriving, a page turned, a tab switched: content changes. Our own style writes are attributes,
    // which this does not watch, so it never feeds itself.
    const changes = new MutationObserver(run);
    changes.observe(card, { childList: true, subtree: true, characterData: true });
    const sizes = new ResizeObserver(run);
    const main = document.querySelector("main");
    if (main) sizes.observe(main);
    if (card.parentElement) sizes.observe(card.parentElement);
    window.addEventListener("resize", run);
    return () => { cancelAnimationFrame(frame); changes.disconnect(); sizes.disconnect(); window.removeEventListener("resize", run); };
  }, []);
  return <span ref={marker} hidden aria-hidden="true" />;
}
