import Link from "next/link";
import type { ReactNode } from "react";

import { CountUp } from "@/components/ui/count-up";
import { LaunchKey } from "@/components/ui/launchpad";
import { cn } from "@/lib/utils";

export type TileTone = "default" | "good" | "warning" | "danger";
export type TileRow = { label: string; value?: string; tone?: TileTone; href?: string };
export type TileBar = { label: string; total: number; part: number };

const INK: Record<TileTone, string> = {
  default: "text-foreground",
  good: "text-[var(--success-ink)]",
  warning: "text-[var(--warning-ink)]",
  danger: "text-[var(--error-ink)]",
};
const DOT: Record<TileTone, string> = {
  default: "bg-[color-mix(in_srgb,var(--primary)_55%,var(--muted))]",
  good: "bg-[var(--primary)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--error)]",
};

/** A tile still reading: its title, and the figure and rows as skeletons. */
export function DashTileLoading({ title }: { title: string }) {
  return (
    <section aria-label={title} aria-busy="true" className="m-glass flex min-h-[196px] min-w-0 flex-col gap-3 rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2">
        <LaunchKey />
        <h3 className="m-0 flex-1 truncate text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{title}</h3>
      </div>
      <span className="m-skel block h-8 w-24 rounded" />
      <span className="m-skel block h-3.5 w-full rounded" />
      <span className="m-skel block h-3.5 w-2/3 rounded" />
    </section>
  );
}

/** A figure that is a number counts up; a word ("Locked", "—") is shown as it is. */
export function TileFigure({ value }: { value: string }) {
  return /\d/.test(value) ? <CountUp text={value} fromZero /> : <>{value}</>;
}

/**
 * One tile, exactly as Dashboard C draws it (redesign 2026-10-25): the number in the corner, the
 * title, "Live" when it polls, "Open →"; the big figure with its unit and, on a one-row tile, the
 * tile's one action beside it; then its rows — each a dot, a line and a value, each opening its page
 * — or its week of bars; on a tall tile the action sits at the foot.
 *
 * Server-safe. `children` is for a body that loads for itself (the close-out list, pending cases).
 */
export function DashTile({
  title,
  href,
  icon,
  live = false,
  big,
  unit,
  tone = "default",
  cta,
  ctaAtFoot = false,
  rows,
  bars,
  children,
}: {
  title: string;
  href: string;
  icon?: ReactNode;
  live?: boolean;
  big?: string;
  unit?: ReactNode;
  tone?: TileTone;
  cta?: { label: string; href: string };
  ctaAtFoot?: boolean;
  rows?: TileRow[];
  bars?: TileBar[];
  children?: ReactNode;
}) {
  const ctaClass = cn(
    "inline-flex h-9 shrink-0 items-center justify-center rounded-full px-4 text-sm font-semibold leading-normal whitespace-nowrap no-underline transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
    "bg-[var(--primary)] text-[var(--on-primary)]",
  );
  const maxBar = Math.max(1, ...(bars ?? []).map((bar) => bar.total));
  return (
    <section
      aria-label={title}
      className={cn(
        "m-glass m-dash-tile flex min-h-[196px] min-w-0 flex-col gap-2.5 overflow-hidden rounded-2xl border p-4",
        "border-border",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <LaunchKey />
        {icon && <span className="shrink-0 text-muted-foreground [&_svg]:size-4" aria-hidden="true">{icon}</span>}
        <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{title}</h3>
        {live && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold leading-normal text-[var(--accent-ink)]">
            <span className="m-live-dot" aria-hidden="true" />Live
          </span>
        )}
        <Link href={href} className="inline-flex h-7 shrink-0 items-center rounded-lg border border-border px-2.5 text-xs font-semibold leading-normal text-muted-foreground no-underline transition-colors hover:border-[var(--border-strong)] hover:text-foreground" aria-label={`Open ${title}`}>
          Open →
        </Link>
      </div>

      {(big !== undefined || (cta && !ctaAtFoot)) && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {big !== undefined && (
            <span className={cn("m-figure text-3xl font-semibold leading-tight tracking-[-0.03em] tabular-nums", INK[tone])}>
              <TileFigure value={big} />
            </span>
          )}
          {unit && <span className="min-w-0 text-sm leading-normal text-muted-foreground">{unit}</span>}
          {cta && !ctaAtFoot && <Link href={cta.href} className={cn(ctaClass, "ml-auto")}>{cta.label}</Link>}
        </div>
      )}

      {bars && bars.length > 0 && (
        <div aria-hidden="true" className="flex min-h-[64px] flex-1 items-end gap-1.5">
          {bars.map((bar, index) => (
            <span key={index} className="flex h-full flex-1 flex-col justify-end gap-0.5">
              <span className="m-bar-rise rounded-t-[4px] bg-[color-mix(in_srgb,var(--primary)_28%,transparent)]" style={{ height: `${Math.max(2, ((bar.total - bar.part) / maxBar) * 100)}%` }} />
              <span className="m-bar-rise rounded-b-[4px] bg-[var(--primary)]" style={{ height: `${Math.max(bar.part ? 2 : 0, (bar.part / maxBar) * 100)}%` }} />
              <span className="pt-1 text-center text-xs leading-none text-muted-foreground">{bar.label}</span>
            </span>
          ))}
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="m-0 flex min-h-0 list-none flex-col gap-0.5 p-0">
          {rows.map((row, index) => {
            const body = (
              <>
                <span className={cn("size-[7px] shrink-0 rounded-full", DOT[row.tone ?? "default"])} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm leading-normal text-foreground">{row.label}</span>
                {row.value && <span className={cn("shrink-0 text-xs font-semibold leading-normal tabular-nums", row.tone && row.tone !== "default" ? INK[row.tone] : "text-muted-foreground")}>{row.value}</span>}
              </>
            );
            return (
              <li key={index}>
                {row.href ? (
                  <Link href={row.href} className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-1 text-inherit no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]">{body}</Link>
                ) : (
                  <span className="-mx-2 flex items-center gap-2 px-2 py-1">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {children}

      {cta && ctaAtFoot && <Link href={cta.href} className={cn(ctaClass, "mt-auto w-full")}>{cta.label}</Link>}
    </section>
  );
}
