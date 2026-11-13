"use client";

/**
 * Settings › Calling windows and Inbound settings (round 8) — the parts both pages share: the card
 * that scrolls inside, its band header, and the one save band at the card's foot.
 */

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cardHead, cardSurface } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export { StatusLine, type StatusTone } from "@/components/app/settings/cadence/shared";

/** A card with the board's band header (title left, controls right) and a body that scrolls inside. */
export function BoardCard({
  title,
  right,
  children,
  footer,
  className,
  label,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section aria-label={label} className={cn(cardSurface, "flex min-h-0 min-w-0 flex-col overflow-hidden", className)}>
      <div className={cn(cardHead, "flex flex-wrap items-center gap-2 border-b border-border px-4 py-3")}>
        <b className="text-sm font-semibold text-[var(--ink)]">{title}</b>
        {right && <div className="ml-auto flex flex-wrap items-center gap-2.5">{right}</div>}
      </div>
      {children}
      {footer}
    </section>
  );
}

/** The card's foot line: a hint, or a short note with a link. */
export function CardFoot({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-border px-4 py-2.5 text-xs text-[var(--muted)]", className)}>{children}</div>;
}

/**
 * The page's one save (foundation rule): quiet while nothing has changed, the gold band with Discard
 * and Save once something has.
 */
export function SaveBand({
  count,
  what,
  idle,
  saving,
  onDiscard,
  save,
}: {
  count: number;
  what?: string;
  /** What the quiet band says. */
  idle: string;
  saving: boolean;
  onDiscard: () => void;
  /** The Save button, built by the page (it carries the setup guide's target); disabled while nothing changed. */
  save: ReactNode;
}) {
  if (count === 0)
    return (
      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-sm text-[var(--muted)]">
        <span>{idle}</span>
        <span className="ml-auto">{save}</span>
      </div>
    );
  return (
    <div role="region" aria-label="Unsaved changes" className="flex flex-wrap items-center gap-2 border-t border-border bg-[var(--highlight-soft)] px-4 py-2.5 text-sm font-medium text-[var(--highlight-ink)]">
      <span className="min-w-0">{count} unsaved {count === 1 ? "change" : "changes"}{what ? ` · ${what}` : ""}</span>
      <span className="ml-auto flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDiscard}>Discard</Button>
        {save}
      </span>
    </div>
  );
}
