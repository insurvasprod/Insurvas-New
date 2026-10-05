"use client";

/**
 * The one card every workspace step is drawn in (LA-3 boards l3-ws-*): a grey header strip with the
 * step's question and its status chips, the body, and a footer strip with one line of context on the
 * left and the step's actions on the right (back, then the primary action last).
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function StepCard({ title, chips, children, footerNote, actions, className, bodyClassName }: {
  title: ReactNode;
  chips?: ReactNode;
  children: ReactNode;
  footerNote?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface)]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-t-[11px] border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
        {chips && <span className="flex flex-wrap items-center gap-2.5">{chips}</span>}
      </div>
      <div className={cn("flex min-w-0 flex-col gap-[18px] px-6 py-5", bodyClassName)}>{children}</div>
      {(footerNote || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-b-[11px] border-t border-[var(--border)] bg-[var(--canvas)] px-5 py-3.5">
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
