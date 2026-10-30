import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * One Home panel (redesign 2026-10-28): the v3 card anatomy at dashboard size — a header with the
 * title, its period and one link to the full page; the body; an optional footer on a divider.
 * The mockups' card (`m-glass`, owner 2026-10-30), as every other card, so the whole page reads as one set.
 */
export function HomePanel({
  title,
  period,
  link,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  /** Muted after the title: "14 days", "today". */
  period?: string;
  /** The one way into the full page, top right. */
  link?: { label: string; href: string };
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section aria-label={title} data-size="panel" className={cn("m-glass flex min-w-0 flex-col rounded-lg border border-border", className)}>
      <header className="flex min-h-12 items-center gap-2 px-4 pt-3">
        <h2 className="m-0 min-w-0 flex-1 truncate font-[family-name:var(--font-display)] text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] text-foreground">
          {title}
          {period && <span className="font-[family-name:var(--font-sans)] text-[0.8125rem] font-normal tracking-normal text-muted-foreground"> · {period}</span>}
        </h2>
        {link && <PanelLink href={link.href}>{link.label}</PanelLink>}
      </header>
      <div className={cn("flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2", bodyClassName)}>{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-b-[15px] border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </section>
  );
}

/** The small "View all ›" link in a panel header. */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-mr-1.5 inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[0.8125rem] font-medium text-muted-foreground no-underline transition-colors hover:bg-[var(--surface-alt)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
    >
      {children}
      <ChevronRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

/** One footer fact: "Contact rate 38%". */
export function PanelFact({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "warning" | "danger" }) {
  const ink = tone === "good" ? "text-[var(--success-ink)]" : tone === "warning" ? "text-[var(--warning-ink)]" : tone === "danger" ? "text-[var(--error-ink)]" : "text-foreground";
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="truncate">{label}</span>
      <span className={cn("shrink-0 font-semibold tabular-nums", ink)}>{value}</span>
    </span>
  );
}

/** A panel still reading: its title, then skeleton lines the height of what will arrive. */
export function HomePanelLoading({ title, className, lines = 4, tall = false }: { title: string; className?: string; lines?: number; tall?: boolean }) {
  return (
    <section aria-label={title} aria-busy="true" data-size="panel" className={cn("m-glass flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4", tall && "min-h-[300px]", className)}>
      <h2 className="m-0 font-[family-name:var(--font-display)] text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] text-foreground">{title}</h2>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="m-skel block h-4 rounded" style={{ width: `${index === 0 ? 40 : 100 - index * 12}%` }} />
      ))}
      {tall && <span className="m-skel mt-auto block h-28 w-full rounded" />}
    </section>
  );
}

/** The stat row still reading: four card-shaped skeletons. */
export function KpiRowLoading({ count = 4 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Today's figures" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="m-glass flex h-[132px] flex-col gap-3.5 rounded-lg border border-border p-4">
          <span className="m-skel block h-4 w-1/2 rounded" />
          <span className="m-skel block h-7 w-2/5 rounded" />
          <span className="m-skel mt-auto block h-3.5 w-full rounded" />
        </div>
      ))}
    </div>
  );
}
