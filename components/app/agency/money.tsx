"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { BASIS_LABELS, type Basis } from "@/lib/agency/statementCore";
import { bpsToPercent, dollars } from "@/lib/agency/constants";
import { cn } from "@/lib/utils";

/**
 * Agency money on screen (AG-1.12): every producer money figure carries its basis label — a figure with no label
 * fails review — a negative is red and never clamped, and a missing value is a visible "—".
 */
export function BasisChip({ basis }: { basis: Basis }) {
  const tone = basis === "received" ? "good" : basis === "reported" ? "action" : "info";
  return <StatusChip dot={false} tone={tone} className="ml-1 align-middle">{BASIS_LABELS[basis]}</StatusChip>;
}

export function Money({ cents, className }: { cents: number | null | undefined; className?: string }) {
  if (cents === null || cents === undefined) return <span className={cn("text-[var(--warning-ink)]", className)}>—</span>;
  return <span className={cn("tabular-nums", cents < 0 && "font-semibold text-[var(--error-ink)]", className)}>{dollars(cents)}</span>;
}

export function Level({ bps, onMissing }: { bps: number | null | undefined; onMissing?: string }) {
  if (bps === null || bps === undefined) return <span className="font-semibold text-[var(--warning-ink)]">{onMissing ?? "—"}</span>;
  return <span className={cn("tabular-nums", bps < 0 && "font-semibold text-[var(--error-ink)]")}>{bpsToPercent(bps)}</span>;
}
