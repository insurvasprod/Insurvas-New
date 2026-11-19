import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type BillingStatusTone = "ok" | "warn" | "bad";

const DOT: Record<BillingStatusTone, string> = {
  ok: "bg-[var(--success)]",
  warn: "bg-[var(--warning)]",
  bad: "bg-[var(--error)]",
};

/**
 * The one quiet line under a Billing page's title (billing-r2; owner rule: no notice cards on the page): a
 * coloured dot, then the page's facts joined by " · ". The first part may be a link to the rows it counts.
 * Used by Invoices, Refunds & credits and Reconciliation, and inside the invoice sheet for a mismatch.
 */
export function BillingStatusLine({ tone, parts, className }: { tone: BillingStatusTone; parts: ReactNode[]; className?: string }) {
  const shown = parts.filter((part) => part !== null && part !== undefined && part !== false && part !== "");
  if (!shown.length) return null;
  return (
    <p className={cn("flex min-w-0 items-start gap-2 text-xs leading-5 text-muted-foreground", className)} role="status">
      <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", DOT[tone])} aria-hidden="true" />
      <span className="min-w-0">
        {shown.map((part, index) => (
          <span key={index}>{index > 0 && " · "}{part}</span>
        ))}
      </span>
    </p>
  );
}
