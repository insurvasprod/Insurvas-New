import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatQuantity, usagePercent, usageState } from "@/lib/metering/constants";
import type { TenantUsageSummary } from "@/lib/metering/queries";

const BAR_COLOR: Record<ReturnType<typeof usageState>, string> = {
  unlimited: "bg-[var(--color-blue)]",
  ok: "bg-[var(--color-success)]",
  near: "bg-[var(--color-warning)]",
  over: "bg-[var(--color-danger)]",
};

export function TenantUsagePanel({ usage }: { usage: TenantUsageSummary }) {
  if (!usage.planId) {
    return (
      <Card>
        <CardContent>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">Usage</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No subscription, so nothing is metered. Allowances start once a plan is assigned.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">Usage</h2>
          <p className="text-xs text-muted-foreground">
            Current billing period
            {usage.periodStart && ` — since ${new Date(usage.periodStart).toLocaleDateString()}`}. Resets on the
            tenant&apos;s billing date, not the calendar month.
          </p>
        </div>

        {usage.meters.length === 0 && (
          <p className="text-sm text-muted-foreground">This plan doesn&apos;t meter anything.</p>
        )}

        <div className="space-y-3">
          {usage.meters.map((row) => {
            const state = usageState(row);
            const pct = usagePercent(row.used_qty, row.included_qty);

            return (
              <div key={row.meter_key} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{row.label}</span>
                  <span className="text-muted-foreground">
                    {row.included_qty === null ? (
                      <>
                        {formatQuantity(row.used_qty, row.unit)} ·{" "}
                        <span className="text-[var(--color-blue)]">unlimited</span>
                      </>
                    ) : (
                      <>
                        {row.used_qty.toLocaleString("en-US")} / {row.included_qty.toLocaleString("en-US")}{" "}
                        {row.unit}s
                        {pct !== null && ` · ${pct}%`}
                      </>
                    )}
                  </span>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${BAR_COLOR[state]}`}
                    style={{ width: `${Math.min(100, pct ?? (row.used_qty > 0 ? 100 : 0))}%` }}
                  />
                </div>

                {state === "over" && row.hard_cap && (
                  <p className="text-xs text-[var(--color-danger)]">
                    At the cap — further use is blocked until the period resets.
                  </p>
                )}
                {state === "over" && !row.hard_cap && (
                  <p className="text-xs text-muted-foreground">
                    Over the allowance. Not capped, so it keeps working and bills as overage.
                  </p>
                )}
                {state === "near" && (
                  <p className="text-xs text-[var(--color-warning)]">Approaching the allowance.</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Seats</span>
          <Badge
            variant="outline"
            className={
              usage.maxSeats !== null && usage.seatsUsed >= usage.maxSeats
                ? "border-transparent bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                : undefined
            }
          >
            {usage.seatsUsed}
            {usage.maxSeats !== null ? ` / ${usage.maxSeats}` : " (unlimited)"}
          </Badge>
          {usage.maxSeats !== null && usage.seatsUsed >= usage.maxSeats && (
            <span className="text-xs text-[var(--color-danger)]">
              At the seat limit — new users are refused.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
