"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * DetailPanel — the one way the agent app opens a record's details, or a create form, beside a list
 * (2026-10-09). A header row (title, optional subtitle and status, optional actions, X), a body that
 * scrolls, and an optional footer that stays put for the primary actions.
 *
 *   mode="split"   sits in the page's flex row beside the table (lg:flex-row, items-stretch) at 30%,
 *                  as tall as the table — the Callbacks page's 70 / 30 split. `splitFrom="xl"` keeps
 *                  it an overlay between lg and xl, for pages whose table cannot spare the room there.
 *   mode="overlay" fixed to the right edge under the top bar, full height, over a translucent
 *                  backdrop that closes it on click — for pages where the table must not shrink.
 *
 * Below lg both are a full-width sheet under the top bar. Render it only while it is open: it moves
 * focus to itself when it mounts and hands focus back to the opener when it unmounts. Escape closes
 * it, except while a field that uses Escape itself has focus, or a dialog or menu is open over it.
 */
export type DetailPanelProps = {
  mode: "split" | "overlay";
  /** The panel's name; the panel is labelled by it. */
  title: ReactNode;
  /** One short line under the title. */
  subtitle?: ReactNode;
  /** Chips or a short status line under the title. */
  status?: ReactNode;
  /** Header buttons, placed before the close button. */
  actions?: ReactNode;
  /** The primary actions, kept in view below the scrolling body. */
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** Accessible name of the X button. */
  closeLabel?: string;
  /** split only: the breakpoint from which the panel sits in the row (default lg). */
  splitFrom?: "lg" | "xl";
  id?: string;
  /** Frame adjustments (sticky, height caps, width). */
  className?: string;
  /** Replaces the body's default spacing (flex column, gap-4, p-4). */
  bodyClassName?: string;
};

const FRAME = "m-panel fixed inset-x-0 bottom-0 top-[var(--top-bar-h)] z-40 flex min-h-0 min-w-0 flex-col border-t border-border bg-card text-foreground shadow-[var(--shadow-overlay)] outline-none";
// 420px, the sheet width (UI-CONSISTENCY §11, foundation v3).
const OVERLAY_LG = "lg:left-auto lg:w-[420px] lg:border-t-0 lg:border-l";
// Beside the list the panel is a card on the stage, so it takes the same glass as the cards
// (foundation v3); as an overlay or a phone sheet it stays opaque, over the page.
// Written out in full: Tailwind only sees class names that appear literally.
const SPLIT_LG = "lg:static lg:z-auto lg:w-[30%] lg:min-w-[360px] lg:shrink-0 lg:rounded-lg lg:border lg:border-border lg:shadow-[var(--shadow-rest)] lg:bg-[color-mix(in_srgb,var(--color-card)_var(--glass-alpha),transparent)] lg:backdrop-blur-[20px] lg:backdrop-saturate-150";
const SPLIT_XL = "xl:static xl:z-auto xl:w-[30%] xl:min-w-[360px] xl:shrink-0 xl:rounded-lg xl:border xl:border-border xl:shadow-[var(--shadow-rest)] xl:bg-[color-mix(in_srgb,var(--color-card)_var(--glass-alpha),transparent)] xl:backdrop-blur-[20px] xl:backdrop-saturate-150";
const BACKDROP = "fixed inset-x-0 bottom-0 top-[var(--top-bar-h)] z-40 bg-[rgba(16,24,32,0.42)]";

/** Fields and widgets that use Escape themselves (clearing a search, closing a list). */
const OWNS_ESCAPE = "textarea, select, input[type=search], [contenteditable=''], [contenteditable='true'], [role=combobox], [aria-haspopup][aria-expanded='true'], [data-escape-local]";
/** Layers that sit over the panel and close first. */
const OPEN_LAYER = "[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu][data-state=open], [role=listbox][data-state=open]";

export function DetailPanel({ mode, title, subtitle, status, actions, footer, children, onClose, closeLabel = "Close", splitFrom = "lg", id, className, bodyClassName }: DetailPanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Escape closes the panel — once the field or layer that owns the key has had it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(OWNS_ESCAPE)) return;
      if (document.querySelector(OPEN_LAYER)) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus moves into the panel when it opens, and back to whatever opened it when it closes — unless
  // the person has already moved focus somewhere else on purpose.
  useEffect(() => {
    const node = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    node?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      const focusWasInside = !active || active === document.body || Boolean(node?.contains(active));
      if (opener && opener.isConnected && focusWasInside) opener.focus({ preventScroll: true });
    };
  }, []);

  const frame = mode === "overlay" ? OVERLAY_LG : splitFrom === "xl" ? cn(OVERLAY_LG, SPLIT_XL) : SPLIT_LG;
  const backdrop = mode === "overlay" ? BACKDROP : splitFrom === "xl" ? cn(BACKDROP, "hidden lg:block xl:hidden") : null;

  return (
    <>
      {backdrop && <div aria-hidden="true" className={backdrop} onClick={() => onCloseRef.current()} />}
      <aside ref={panelRef} id={id} tabIndex={-1} aria-labelledby={titleId} data-slot="detail-panel" data-mode={mode} className={cn(FRAME, frame, className)}>
        <div className="flex shrink-0 items-start gap-3 border-b border-border py-3 pr-3 pl-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 truncate text-base font-semibold text-foreground" title={typeof title === "string" ? title : undefined}>{title}</h2>
            {subtitle && <p className="m-0 mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
            {status && <div className="mt-1.5 flex flex-wrap items-center gap-2">{status}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={closeLabel} title={`${closeLabel} (Esc)`} onClick={onClose}><X aria-hidden="true" /></Button>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName ?? "flex flex-col gap-4 p-4")}>{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-3">{footer}</div>}
      </aside>
    </>
  );
}
