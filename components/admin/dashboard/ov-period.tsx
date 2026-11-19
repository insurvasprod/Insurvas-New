"use client";

import { useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DASH_PERIOD_LABELS, pickDashPeriod, type DashPeriod } from "@/lib/adminDashboard/periods";

/**
 * The dashboard's period ("30 days · 90 days · 12 months") as the shared filter button (owner 2026-11-18: a period
 * is a filter at the top right, not a sub-page). It draws PeriodMenu's trigger and menu (components/ui/period-menu.tsx)
 * but chooses with onSelect instead of links: the cards were drawn on the server for every period and `ByPeriod`
 * only picks which one shows, so changing it needs no round trip of figures. The period still lives in the address
 * (`?period=`, every other parameter kept), so a link or a reload lands on the same view.
 */
export function PeriodSwitch({ periods, fallback, label = "Period" }: { periods: readonly DashPeriod[]; fallback: DashPeriod; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const current = pickDashPeriod(query.get("period"), periods, fallback);
  const [chosen, setChosen] = useState<DashPeriod | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = pending && chosen ? chosen : current;

  const choose = (period: DashPeriod) => {
    if (period === current) return;
    const params = new URLSearchParams(query.toString());
    params.set("period", period);
    setChosen(period);
    startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" aria-label={`${label}: ${DASH_PERIOD_LABELS[shown]}`} className="gap-2">
          <CalendarDays aria-hidden="true" />
          {DASH_PERIOD_LABELS[shown]}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {periods.map((period) => {
          const on = period === shown;
          return (
            <DropdownMenuItem key={period} aria-current={on ? "true" : undefined} onSelect={() => choose(period)} className="flex items-center justify-between gap-3">
              <span>{DASH_PERIOD_LABELS[period]}</span>
              <Check aria-hidden="true" className={cn("size-4", on ? "opacity-100" : "opacity-0")} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shows the view drawn for the period in the address. */
export function ByPeriod({ views, periods, fallback }: { views: Partial<Record<DashPeriod, ReactNode>>; periods: readonly DashPeriod[]; fallback: DashPeriod }) {
  const period = pickDashPeriod(useSearchParams().get("period"), periods, fallback);
  return <>{views[period] ?? null}</>;
}
