import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

/**
 * One row of a My profile card (redesign 2026-10-27, layout B): what it is on the left, the value in
 * the middle, its own actions on the right. A form a row opens sits under it, full width, so the row
 * it belongs to stays in sight. Stacks on a phone.
 */
export function ProfileRow({ id, label, htmlFor, children, actions, below, top = false, tone, rowRef }: {
  id?: string;
  label: ReactNode;
  /** The control the label names, when the row has one input. */
  htmlFor?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** A form or note the row opened, drawn under it. */
  below?: ReactNode;
  /** Align to the top, for a value taller than one line. */
  top?: boolean;
  /** "warn": the row needs the reader (two-step sign-in a role requires, still off). */
  tone?: "warn";
  rowRef?: Ref<HTMLDivElement>;
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div ref={rowRef} id={id} className={cn("flex scroll-mt-24 flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border)] px-5 py-3", top ? "items-start" : "items-center", tone === "warn" && "bg-[var(--warning-surface)]")}>
      <Label htmlFor={htmlFor} className={cn("shrink-0 grow-0 basis-full text-sm font-semibold text-[var(--ink)] sm:basis-[170px]", top && "sm:pt-2")}>{label}</Label>
      <div className="min-w-0 flex-[1_1_280px]">{children}</div>
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      {below && <div className="basis-full">{below}</div>}
    </div>
  );
}

/** The panel a row opens: a quiet ground that sets the form apart from the rows around it. */
export function RowPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-1 flex flex-col gap-3 rounded-[10px] bg-[var(--surface-alt)] p-3.5", className)}>{children}</div>;
}

/**
 * A card of rows. Its title names it for screen readers only: the tab card above already says it,
 * and one title per screen (final critique, 2026-10-27). The line under it stays — it says what the
 * card is for.
 */
export function RowCard({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
      <header className="px-5 py-3">
        <h3 id={id} className="sr-only">{title}</h3>
        <p className="text-sm text-[var(--muted)]">{sub}</p>
      </header>
      {children}
    </section>
  );
}
