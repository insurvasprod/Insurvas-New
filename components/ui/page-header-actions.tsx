"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A page's actions (PageHeader). When the page's tabs or step bar follow the header, the actions
 * share that row (CSS in globals.css, "Page header without a title"); this measures what the CSS
 * needs and writes it as custom properties on the header's parent — the shared box of the header
 * and its lead — and nothing else:
 *   --page-actions-w        the actions' width (a tabs row leaves room for them);
 *   --page-actions-h        the actions' height (a centred step bar's row grows to it);
 *   --page-lead-h           the lead row's height (the actions sit at its middle);
 *   --page-lead-content-w   a centred step bar's own width (the actions keep clear of it).
 * Without script the actions simply keep their own row.
 */

/** The page's tabs or step bar, or a row that starts with them (the same test as the CSS). */
const LEAD = "[data-page-lead], :has(> [data-page-lead]:first-child)";

export function PageHeaderActions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const actions = ref.current;
    const header = actions?.parentElement;
    const box = header?.parentElement;
    if (!actions || !header || !box) return;
    const lead = header.nextElementSibling as HTMLElement | null;
    const isLead = Boolean(lead?.matches(LEAD));
    const centred = lead?.getAttribute("data-page-lead") === "center";
    const measure = () => {
      const rect = actions.getBoundingClientRect();
      box.style.setProperty("--page-actions-w", `${Math.ceil(rect.width) + 16}px`);
      box.style.setProperty("--page-actions-h", `${Math.ceil(rect.height)}px`);
      if (!lead || !isLead) return;
      if (centred) {
        const bar = lead.firstElementChild as HTMLElement | null;
        if (bar) box.style.setProperty("--page-lead-content-w", `${Math.ceil(bar.getBoundingClientRect().width)}px`);
      } else {
        box.style.setProperty("--page-lead-h", `${Math.ceil(lead.getBoundingClientRect().height)}px`);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(actions);
    if (lead) observer.observe(lead);
    if (centred && lead?.firstElementChild) observer.observe(lead.firstElementChild);
    return () => {
      observer.disconnect();
      for (const name of ["--page-actions-w", "--page-actions-h", "--page-lead-h", "--page-lead-content-w"]) box.style.removeProperty(name);
    };
  }, []);
  return <div ref={ref} className="flex max-w-full flex-wrap items-center justify-end gap-2">{children}</div>;
}
