import Link from "next/link";
import { CalendarCheck } from "lucide-react";

import { StatusChip } from "@/components/ui/status-chip";
import { clock, formatCount, type ScheduleItem } from "@/lib/dashboard/homeView";
import { cn } from "@/lib/utils";

import { HomePanel } from "./home-panel";

/**
 * Today, in one list: appointments and due callbacks by time, late callbacks on top. Times are the
 * agency's clock; the customer's own is in the hover text. Six rows at most — the calendar is the list.
 */
export function HomeSchedule({
  items,
  total,
  zone,
  showAgent,
  link,
  className,
}: {
  items: ScheduleItem[];
  total: number;
  zone: string;
  /** The agency view names whose appointment it is. */
  showAgent: boolean;
  link: { label: string; href: string } | null;
  className?: string;
}) {
  const more = total - items.length;
  return (
    <HomePanel
      title="Today"
      period={total ? `${formatCount(total)} scheduled` : undefined}
      link={link ?? undefined}
      className={className}
      bodyClassName="pt-1"
      footer={more > 0 && link ? <Link href={link.href} className="font-medium text-foreground no-underline hover:underline">{formatCount(more)} more today</Link> : undefined}
    >
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <span className="grid size-9 place-items-center rounded-full bg-[var(--success-surface)] text-[var(--success-ink)]"><CalendarCheck className="size-4" aria-hidden="true" /></span>
          <p className="m-0 text-sm font-medium text-foreground">Nothing scheduled</p>
          <p className="m-0 text-xs text-muted-foreground">No appointments or callbacks left today.</p>
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {items.map((item) => {
            const theirs = item.theirZone && item.theirZone !== zone ? `${clock(item.atUtc, item.theirZone)} their time` : null;
            return (
              <li key={item.id} className="border-t border-[var(--gloss-divider)] first:border-t-0">
                <Link
                  href={item.href}
                  title={theirs ?? undefined}
                  className="-mx-2 grid grid-cols-[4.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-inherit no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--surface-alt)_70%,transparent)]"
                >
                  <span className={cn("text-[0.8125rem] font-semibold tabular-nums", item.late ? "text-[var(--error-ink)]" : "text-foreground")}>{clock(item.atUtc, zone)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{item.name}</span>
                    {showAgent && item.who && <span className="block truncate text-xs text-muted-foreground">with {item.who}</span>}
                  </span>
                  {item.kind === "appointment" ? (
                    <StatusChip tone="info">Appointment</StatusChip>
                  ) : (
                    <StatusChip tone={item.late ? "danger" : "warning"}>{item.late ? "Late callback" : "Callback"}</StatusChip>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </HomePanel>
  );
}
