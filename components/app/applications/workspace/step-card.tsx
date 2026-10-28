"use client";

/**
 * The one card every workspace step is drawn in (owner pick C, 2026-10-28): the card's name and its status
 * chips, the body, and a foot with one line of context on the left and the step's actions on the right
 * (back, then the next step last). The step's own name and purpose sit above it, in the workspace.
 */

import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Inside a FoldSection the section's header already names the card (owner 2026-10-28): a StepCard
 * drawn there drops its own frame and title and sits as a plain panel, so there is no card in a card.
 */
const BareContext = createContext<false | "panel" | "plain">(false);
/**
 * `plain` (owner 2026-10-28, After step): no panel either, and no status chips — the section's
 * header already says the status, so the card's body sits straight in the section.
 */
export function BareStepCards({ children, plain = false }: { children: ReactNode; plain?: boolean }) {
  return <BareContext.Provider value={plain ? "plain" : "panel"}>{children}</BareContext.Provider>;
}

export function StepCard({ title, chips, children, footerNote, actions, className, bodyClassName }: {
  title: ReactNode;
  chips?: ReactNode;
  children: ReactNode;
  footerNote?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const bare = useContext(BareContext);
  if (bare) {
    const plain = bare === "plain";
    return (
      <div aria-label={typeof title === "string" ? title : undefined} className={cn("flex min-w-0 flex-col gap-3", !plain && "rounded-[14px] border border-[var(--border)] bg-[var(--surface-alt)] p-3", plain && "px-1 pt-1", className)}>
        {chips && !plain && <span className="flex flex-wrap items-center justify-end gap-2.5">{chips}</span>}
        <div className={cn("flex min-w-0 flex-col gap-[18px]", bodyClassName)}>{children}</div>
        {(footerNote || actions) && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-3">
            <span className="min-w-0 text-xs text-[var(--muted)]">{footerNote}</span>
            {actions && <span className="flex flex-wrap items-center gap-3">{actions}</span>}
          </div>
        )}
      </div>
    );
  }
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-3.5">
        <h3 className="text-base font-semibold tracking-[-0.01em] text-[var(--ink)]">{title}</h3>
        {chips && <span className="flex flex-wrap items-center gap-2.5">{chips}</span>}
      </div>
      <div className={cn("flex min-w-0 flex-col gap-[18px] px-5 py-5", bodyClassName)}>{children}</div>
      {(footerNote || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] px-5 py-3.5">
          <span className="min-w-0 text-xs text-[var(--muted)]">{footerNote}</span>
          {actions && <span className="flex flex-wrap items-center gap-3">{actions}</span>}
        </div>
      )}
    </section>
  );
}

/** A sub-section inside a step's body: a small heading and its content (no card around a card). */
export function StepSection({ title, action, children, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
