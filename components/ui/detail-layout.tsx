import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The header of a record: what it is, what state it is in, and what you can do to it.
 *
 * `meta` is the chip row under the title — type, owner, dates, a StatusChip. It is the fastest read
 * on the page and the reason the title does not have to carry qualifiers.
 */
export function DetailHeader({
  breadcrumb,
  title,
  meta,
  actions,
}: {
  breadcrumb?: ReactNode;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      {breadcrumb && <div className="text-sm text-muted-foreground">{breadcrumb}</div>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="min-w-0 text-[32px] font-semibold leading-[1.13] tracking-[-0.025em]">
          {title}
        </h1>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">{meta}</div>}
    </div>
  );
}

/**
 * Record on the left, context on the right.
 *
 * The rail holds what supports a decision — next action, recent activity, attribution — and never
 * what the record IS. At tablet width and below it drops beneath the main column, because a 320px
 * rail beside a 320px record is two unreadable columns.
 */
export function DetailLayout({
  children,
  rail,
  className,
}: {
  children: ReactNode;
  rail?: ReactNode;
  className?: string;
}) {
  if (!rail) return <div className={cn("space-y-4", className)}>{children}</div>;

  return (
    <div className={cn("grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start", className)}>
      <div className="min-w-0 space-y-4">{children}</div>
      <aside className="space-y-4 xl:sticky xl:top-6">{rail}</aside>
    </div>
  );
}

/**
 * A labelled group of facts inside a record — the shape every "Customer overview" block repeats.
 */
export function FactGrid({
  facts,
  columns = 2,
}: {
  facts: { label: string; value: ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-8 gap-y-3",
        columns === 1 && "grid-cols-1",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3"
      )}
    >
      {facts.map((fact) => (
        <div key={fact.label} className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border pb-2 last:border-b-0 sm:border-b-0 sm:pb-0">
          <dt className="shrink-0 text-sm text-muted-foreground">{fact.label}</dt>
          <dd className="min-w-0 text-right text-sm font-medium sm:text-left">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
