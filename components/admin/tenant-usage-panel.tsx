import type { ReactNode } from "react";

import { SettingsMeter } from "@/components/app/settings/primitives";
import { usagePercent, usageState } from "@/lib/metering/constants";
import type { TenantUsageSummary } from "@/lib/metering/queries";
import { recordDate } from "@/lib/tenants/recordFormat";
import { meterWarnThreshold } from "@/lib/settings/queries";
import { cn } from "@/lib/utils";

/**
 * "Usage against plan limits" as board p-adm-tenant-detail draws it: one row per limit, a 14px
 * label and its figure over a 6px bar, rows split by a hairline. Seats and publishers are ceilings
 * (plan_limits), the rest are the plan's metered allowances for the current billing period.
 *
 * Tones (decision 3): a ceiling that is exactly full is a warning, not an error — nothing is broken,
 * the next one is refused. Over a ceiling (a downgrade left them above it) or over a meter's
 * allowance is an error. Unlimited rows are body-coloured with an empty bar: a bar without its
 * denominator is decoration.
 *
 * A Server Component, so it reads the warning threshold directly rather than taking a prop.
 */

type RowTone = "unlimited" | "ok" | "near" | "full" | "over" | "unknown";

const VALUE_INK: Record<RowTone, string> = {
  unlimited: "text-[var(--body)]",
  ok: "text-[var(--success-ink)]",
  near: "text-[var(--warning-ink)]",
  full: "text-[var(--warning-ink)]",
  over: "text-[var(--error-ink)]",
  unknown: "text-[var(--body)]",
};

const BAR: Record<RowTone, "muted" | "success" | "warning" | "error"> = {
  unlimited: "muted",
  ok: "success",
  near: "warning",
  full: "warning",
  over: "error",
  unknown: "muted",
};

const NOTE_INK = {
  muted: "text-[var(--muted)]",
  warning: "text-[var(--warning-ink)]",
  error: "text-[var(--error-ink)]",
} as const;

function n(value: number): string {
  return value.toLocaleString("en-US");
}

/** A ceiling (seats, publishers): full at the limit is a warning, past it is an error. */
function ceilingTone(used: number | null, max: number | null, warn: number): RowTone {
  if (used === null) return "unknown";
  if (max === null) return "unlimited";
  if (used > max) return "over";
  if (used === max) return "full";
  return max > 0 && used / max >= warn ? "near" : "ok";
}

function UsageRow({
  label,
  value,
  tone,
  used,
  max,
  note,
  noteTone = "muted",
  title,
}: {
  label: string;
  value: string;
  tone: RowTone;
  used: number;
  max: number;
  note?: ReactNode;
  noteTone?: keyof typeof NOTE_INK;
  title?: string;
}) {
  return (
    <div className="border-t border-[var(--border)] py-3">
      <div className="flex justify-between gap-3">
        <span className="text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{label}</span>
        <span
          className={cn("text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] tabular-nums whitespace-nowrap", VALUE_INK[tone])}
          title={title}
        >
          {value}
        </span>
      </div>
      <SettingsMeter value={used} max={max} tone={BAR[tone]} ariaLabel={`${label}: ${value}`} />
      {note && <p className={cn("m-0 mt-1.5 text-[12px] leading-[1.5] tracking-[-0.01em]", NOTE_INK[noteTone])}>{note}</p>}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h2 className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Usage against plan limits</h2>
      <p className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">A bar without its denominator is decoration.</p>
    </div>
  );
}

const CARD = "min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5";

export async function TenantUsagePanel({ usage }: { usage: TenantUsageSummary }) {
  const warn = await meterWarnThreshold();

  if (!usage.planId) {
    return (
      <section className={CARD} aria-label="Usage against plan limits">
        <Header />
        <p className="m-0 mt-3 border-t border-[var(--border)] pt-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
          No subscription, so nothing is metered. Allowances start once a plan is assigned.
        </p>
      </section>
    );
  }

  const seatTone = ceilingTone(usage.seatsUsed, usage.maxSeats, warn);
  const pub = usage.publishers;
  const pubTone = pub ? ceilingTone(pub.used, pub.max, warn) : "unknown";

  return (
    <section className={CARD} aria-label="Usage against plan limits">
      <Header />

      <UsageRow
        label="Seats"
        value={usage.seatsUsed === null ? "—" : `${n(usage.seatsUsed)} / ${usage.maxSeats === null ? "Unlimited" : n(usage.maxSeats)}`}
        tone={seatTone}
        used={usage.seatsUsed ?? 0}
        max={usage.maxSeats ?? 0}
        note={
          usage.seatsUsed === null
            ? `Seats could not be counted: ${usage.seatsError ?? "unknown error"}`
            : seatTone === "full"
              ? "At the seat limit — new users are refused."
              : seatTone === "over"
                ? "Over the seat limit — nobody is removed, but nobody new can join."
                : undefined
        }
        noteTone={usage.seatsUsed === null || seatTone === "over" ? "error" : "warning"}
      />

      {pub && (
        <UsageRow
          label="Publishers"
          value={pub.used === null ? "—" : `${n(pub.used)} / ${pub.max === null ? "Unlimited" : n(pub.max)}`}
          tone={pubTone}
          used={pub.used ?? 0}
          max={pub.max ?? 0}
          title="Draft and active publisher partners — the ones that count against the plan's publisher limit."
          note={
            pub.used === null
              ? pub.error ?? "Publishers could not be counted."
              : pubTone === "full" || pubTone === "over"
                ? "At the publisher limit — a new publisher is refused."
                : undefined
          }
          noteTone={pub.used === null || pubTone === "over" ? "error" : "warning"}
        />
      )}

      {usage.meters.map((row) => {
        const state = usageState(row, warn);
        const pct = usagePercent(row.used_qty, row.included_qty);
        const tone: RowTone = state;
        return (
          <UsageRow
            key={row.meter_key}
            label={row.label}
            value={`${n(row.used_qty)} / ${row.included_qty === null ? "Unlimited" : n(row.included_qty)}`}
            tone={tone}
            used={row.included_qty === null ? 0 : row.used_qty}
            max={row.included_qty ?? 0}
            title={pct === null ? undefined : `${pct}% of the allowance`}
            note={
              state === "over"
                ? row.hard_cap
                  ? "At the cap — further use is blocked until the period resets."
                  : "Over the allowance. Not capped, so it keeps working and bills as overage."
                : state === "near"
                  ? "Approaching the allowance."
                  : undefined
            }
            noteTone={state === "over" && row.hard_cap ? "error" : state === "over" ? "muted" : "warning"}
          />
        );
      })}

      <p className="m-0 border-t border-[var(--border)] pt-3 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
        {usage.meters.length === 0 ? "This plan doesn’t meter anything. " : ""}
        Metered rows cover the current billing period{usage.periodStart ? `, since ${recordDate(usage.periodStart)}` : ""}, and reset on the
        tenant’s billing date, not the calendar month.
      </p>
    </section>
  );
}
