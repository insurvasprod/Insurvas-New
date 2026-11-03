import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Meter } from "@/components/ui/stat";
import type { MoneyFigure } from "@/lib/dashboard/money";
import { formatCount, type HomeToday } from "@/lib/dashboard/homeView";
import { cn } from "@/lib/utils";

import { HomePanel } from "./home-panel";

const DOT = { good: "bg-[var(--success)]", warning: "bg-[var(--warning)]", danger: "bg-[var(--error)]", none: "bg-[var(--muted)]" } as const;
const INK = { good: "text-[var(--success-ink)]", warning: "text-foreground", danger: "text-[var(--error-ink)]", none: "text-foreground" } as const;

/**
 * Money and retention (LA-4.18) as one ledger: a line per figure — label, the short caption, the
 * number on the right — each opening the view that holds its rows. The dot is the state (amber to
 * look at, red at risk), always beside words. Persistency draws its share as a meter.
 */
export function HomeMoney({
  figures,
  upgrade,
  className,
}: {
  figures: MoneyFigure[];
  /** The one upgrade line (Sixteen #15): only when the agency's own data makes the case. */
  upgrade?: { policies: number; featureHref: string; rowsHref: string } | null;
  className?: string;
}) {
  if (figures.length === 0 && !upgrade) return null;
  return (
    <HomePanel title="Money and retention" className={className} bodyClassName="pt-1">
      <ul className="m-0 flex list-none flex-col p-0">
        {figures.map((figure) => {
          const tone = figure.tone ?? "none";
          return (
            <li key={figure.key} className="border-t border-[var(--gloss-divider)] first:border-t-0">
              <Link href={figure.href} className="group -mx-2 grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md px-2 py-1.5 text-inherit no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--surface-alt)_70%,transparent)]">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className={cn("size-2 shrink-0 rounded-full", DOT[tone])} aria-hidden="true" />
                    <span className="truncate">{figure.label}</span>
                  </span>
                  <span className="block truncate pl-4 text-xs text-muted-foreground">{figure.caption}</span>
                </span>
                {figure.ring ? (
                  <Meter value={figure.ring.value} max={figure.ring.max} tone="good" label={figure.ring.label} className="hidden w-16 sm:block" />
                ) : <span />}
                <span className="flex items-center gap-1">
                  <span className={cn("font-[family-name:var(--font-display)] text-lg font-semibold tracking-[-0.02em] tabular-nums", INK[tone])}>{figure.value}</span>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {upgrade && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-[var(--primary-soft)] px-3 py-2 text-[0.8125rem] text-[var(--accent-ink)]">
          <span className="min-w-0 flex-1">
            <Link href={upgrade.rowsHref} className="font-semibold text-inherit underline-offset-2 hover:underline">{formatCount(upgrade.policies)} {upgrade.policies === 1 ? "policy" : "policies"}</Link> could charge back. Lapse risk flags them first.
          </span>
          <Link href={upgrade.featureHref} className="font-semibold text-inherit no-underline hover:underline">See Lapse risk</Link>
        </div>
      )}
    </HomePanel>
  );
}

/** The team's standings over seven days (agency view only): dials as a bar, reach beside it. */
export function HomeTeam({ leaders, href, className }: { leaders: NonNullable<NonNullable<HomeToday["insights"]>["leaders"]>; href: string | null; className?: string }) {
  if (leaders.length === 0) return null;
  const max = Math.max(1, ...leaders.map((leader) => leader.dials));
  return (
    <HomePanel title="Top dialers" period="7 days" link={href ? { label: "Scorecard", href } : undefined} className={className} bodyClassName="pt-1">
      <ol className="m-0 flex list-none flex-col gap-3 p-0 pt-1">
        {leaders.slice(0, 5).map((leader, index) => {
          const reach = leader.dials ? Math.round((leader.contacts / leader.dials) * 100) : 0;
          return (
            <li key={leader.userId} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="truncate text-sm font-medium text-foreground">{leader.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{formatCount(leader.dials)}</span> · {reach}%</span>
              <span className="col-start-2 col-end-4 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]" aria-hidden="true">
                <span className={cn("m-bar-rise block h-full rounded-full", index === 0 ? "bg-[var(--primary)]" : "bg-[color-mix(in_srgb,var(--primary)_45%,var(--surface-alt))]")} style={{ width: `${(leader.dials / max) * 100}%` }} />
              </span>
            </li>
          );
        })}
      </ol>
    </HomePanel>
  );
}
