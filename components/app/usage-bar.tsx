import { usagePercent, usageState, DEFAULT_METER_WARN_THRESHOLD } from "@/lib/metering/constants";

/**
 * One meter's usage for the current period.
 *
 * It replaced a line reading `dials    1,240 / 2,000`, which is accurate and asks the reader to do
 * the arithmetic. The bar answers the only question an agent actually has — am I about to run out
 * — before they have read the numbers.
 *
 * The bands come from the same `usageState()` the admin usage monitor uses, so an agent and an
 * operator cannot be looking at the same tenant and disagree about whether it is in trouble.
 */
export function UsageBar({
  label,
  unit,
  used,
  included,
  hardCap,
  warnThreshold = DEFAULT_METER_WARN_THRESHOLD,
}: {
  label: string;
  unit: string;
  used: number;
  /** Null means unlimited. */
  included: number | null;
  hardCap: boolean;
  /** Resolved from the `usage.warn_percent` setting by the caller; the coded default is a fallback. */
  warnThreshold?: number;
}) {
  const percent = usagePercent(used, included);
  const state = usageState(
    { meter_key: label, label, unit, used_qty: used, included_qty: included, hard_cap: hardCap },
    warnThreshold,
  );

  const format = (n: number) => n.toLocaleString("en-US");
  const suffix = unit ? ` ${unit}` : "";

  // Unlimited gets no bar. A progress bar with no end is a bar that is always nearly empty, which
  // implies a limit that is not there.
  if (included === null) {
    return (
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {format(used)}
          {suffix} used · <span className="text-foreground">unlimited</span>
        </span>
      </div>
    );
  }

  const barColor =
    state === "over"
      ? "var(--color-danger)"
      : state === "near"
        ? "var(--color-warning)"
        : "var(--color-blue)";

  const remaining = Math.max(0, included - used);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {format(used)} / {format(included)}
          {suffix}
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.min(100, Math.round(percent ?? 0))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} usage`}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.min(100, percent ?? 0)}%`, background: barColor }}
        />
      </div>

      {/* Says what happens next, not just where they are. A hard cap stopping work is a different
          sentence from an overage that will appear on a bill, and the difference is money. */}
      <p className="text-xs text-muted-foreground">
        {state === "over"
          ? hardCap
            ? "You've used your allowance — this is paused until the period resets."
            : "You've used your allowance — anything further is billed as overage."
          : `${format(remaining)}${suffix} left this period.`}
      </p>
    </div>
  );
}
