import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One Home panel (redesign 2026-10-28): the v3 card anatomy at dashboard size — a header with the
 * title, its period and one link to the full page; the body; an optional footer on a divider.
 * The mockups' card (`m-glass`, owner 2026-10-30), as every other card, so the whole page reads as one set.
 */
export function HomePanel({
  title,
  icon,
  period,
  sub,
  badge,
  roundLink = false,
  link,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  /** A mark before the title (a person's initials). */
  icon?: ReactNode;
  /** Muted after the title: "14 days", "today". */
  period?: string;
  /** A muted line under the title: "Last 7 days". */
  sub?: string;
  /** A chip beside the link, top right: "+1 sale vs your average". */
  badge?: ReactNode;
  /** The link drawn as a round "›" button (its label is read out), as the dashboard mockups draw it. */
  roundLink?: boolean;
  /** The one way into the full page, top right. */
  link?: { label: string; href: string };
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section aria-label={title} data-size="panel" className={cn("m-glass flex min-w-0 flex-col rounded-lg border border-border", className)}>
      {/* On a phone the badge (a chart's legend, a chip) takes its own line under the title, so the title is
          never squeezed to "Premium ·…" between the badge and the button (QA pass 2026-11). */}
      <header className="flex min-h-12 flex-wrap items-center gap-2 px-4 pt-3">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="m-0 min-w-0 truncate font-[family-name:var(--font-display)] text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] text-foreground">
            {title}
            {period && <span className="font-[family-name:var(--font-sans)] text-[0.8125rem] font-normal tracking-normal text-muted-foreground"> · {period}</span>}
          </h2>
          {sub && <span className="line-clamp-2 text-xs text-muted-foreground">{sub}</span>}
        </div>
        {badge && <div data-panel-badge="" className="flex min-w-0 items-center max-sm:order-last max-sm:basis-full">{badge}</div>}
        {link && (roundLink ? <PanelRoundLink href={link.href} label={link.label} /> : <PanelLink href={link.href}>{link.label}</PanelLink>)}
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

/**
 * The way to the full page from a panel header: a labelled outline button ("Activity ›"), so a salesperson
 * sees where it goes (QA pass 2026-11: a bare grey link or a lone "›" read as decoration).
 */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm" className="shrink-0">
      <Link href={href} className="no-underline">
        {children}
        <ChevronRight aria-hidden="true" />
      </Link>
    </Button>
  );
}

/** Kept for callers that asked for the round "›": it is the same labelled button now, never an icon alone. */
export function PanelRoundLink({ href, label }: { href: string; label: string }) {
  return <PanelLink href={href}>{label}</PanelLink>;
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
