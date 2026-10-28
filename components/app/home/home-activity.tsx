import { DeltaChip } from "@/components/ui/stat";
import { formatCount, hourText, niceMax, type ActivityView } from "@/lib/dashboard/homeView";
import { cn } from "@/lib/utils";

import { HomePanel, PanelFact } from "./home-panel";

/**
 * Calls over fourteen days (the dashboard's lead chart, UI-CONSISTENCY §4a): one bar a day, the
 * reached part solid and the rest of the dials pale, today lighter because it is not over. The
 * seven-day total and its change sit above it; contact rate, best hour and top outcome below.
 */
export function HomeActivity({ view, href, className }: { view: ActivityView; href: string | null; className?: string }) {
  const top = niceMax(view.max);
  const ticks = [top, top / 2, 0];
  const labelAt = new Set([0, Math.floor(view.bars.length / 2), view.bars.length - 1]);

  return (
    <HomePanel
      title="Calls"
      period="14 days"
      link={href ? { label: "Team activity", href } : undefined}
      className={className}
      footer={
        <>
          {view.rate !== null && <PanelFact label="Reached · 7 days" value={`${formatCount(view.weekReached)} · ${Math.round(view.rate)}%`} />}
          {view.bestHour && <PanelFact label="Best hour" value={`${hourText(view.bestHour.hour)} · ${Math.round(view.bestHour.rate)}%`} />}
          {view.topOutcome && <PanelFact label="Top outcome" value={`${view.topOutcome.label} · ${view.topOutcome.share}%`} />}
        </>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-[family-name:var(--font-display)] text-[1.875rem] font-semibold leading-none tracking-[-0.035em] tabular-nums text-foreground">
            {formatCount(view.weekDials)}
          </span>
          <span className="text-[0.8125rem] text-muted-foreground">dials · 7 days</span>
          {view.change !== null && (
            <span className="inline-flex items-center gap-1.5">
              <DeltaChip value={view.change} goodWhen="up" />
              <span className="text-xs text-muted-foreground">vs. prior 7 days</span>
            </span>
          )}
        </div>
        <ul aria-hidden="true" className="m-0 flex list-none gap-3 p-0 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[var(--primary)]" />Reached</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[color-mix(in_srgb,var(--primary)_26%,var(--surface-alt))]" />No contact</li>
        </ul>
      </div>

      <figure className="m-0 mt-3 flex min-h-0 flex-1 flex-col" aria-label={`Dials per day for 14 days; ${formatCount(view.weekReached)} of ${formatCount(view.weekDials)} reached in the last 7 days`}>
        <div className="relative min-h-[132px] flex-1 pr-9">
          {ticks.map((tick, index) => (
            <span key={tick} aria-hidden="true" className="absolute inset-x-0 flex items-center" style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}>
              <span className={cn("h-px flex-1", tick === 0 ? "bg-[var(--border)]" : "border-t border-dashed border-[var(--border)]")} />
              <span className="w-9 -translate-y-px pl-2 text-xs leading-none tabular-nums text-muted-foreground">{formatCount(tick)}</span>
            </span>
          ))}
          <ol className="relative m-0 grid h-full list-none items-end gap-[clamp(3px,0.6vw,8px)] p-0" style={{ gridTemplateColumns: `repeat(${view.bars.length}, minmax(0, 1fr))` }}>
            {view.bars.map((bar) => {
              const height = (bar.dials / top) * 100;
              const reachedShare = bar.dials ? (bar.reached / bar.dials) * 100 : 0;
              return (
                <li key={bar.key} className="flex h-full flex-col justify-end" title={`${bar.weekday} ${bar.label}: ${formatCount(bar.dials)} dials, ${formatCount(bar.reached)} reached${bar.isToday ? " (so far)" : ""}`}>
                  <span
                    className={cn("m-bar-rise flex flex-col justify-end overflow-hidden rounded-t-[4px] rounded-b-[2px] bg-[color-mix(in_srgb,var(--primary)_26%,var(--surface-alt))]", bar.isToday && "opacity-60")}
                    style={{ height: `${Math.max(bar.dials ? 2 : 0, height)}%` }}
                  >
                    <span className="block bg-[var(--primary)]" style={{ height: `${reachedShare}%` }} />
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <div aria-hidden="true" className="grid pr-9 pt-1.5 text-xs leading-none tabular-nums text-muted-foreground" style={{ gridTemplateColumns: `repeat(${view.bars.length}, minmax(0, 1fr))` }}>
          {view.bars.map((bar, index) => (
            <span key={bar.key} className={cn("whitespace-nowrap", index === 0 ? "text-left" : index === view.bars.length - 1 ? "text-right" : "text-center")}>
              {labelAt.has(index) ? (bar.isToday ? "Today" : bar.label) : ""}
            </span>
          ))}
        </div>
      </figure>
    </HomePanel>
  );
}
