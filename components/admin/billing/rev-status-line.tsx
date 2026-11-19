import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type BillingStatusTone = "ok" | "warn" | "bad";

const DOT: Record<BillingStatusTone, string> = {
  ok: "bg-[var(--success)]",
  warn: "bg-[var(--warning)]",
  bad: "bg-[var(--error)]",
};

/**
 * The one quiet line under a Billing page's title (admin round 1, docs/design/admin-r1/billing-r2.html): what the
 * page's figures add up to, and what needs a look, in words, instead of a notice card (owner rule: no notices on the
 * page). The first part may be a link; the rest are plain parts joined by "·". Used by Coupons, Offers, Credits &
 * limits, Revenue and Payment provider; server-safe.
 */
export function BillingStatusLine({ tone, lead, parts }: {
  tone: BillingStatusTone;
  /** The first part, in ink; a link when it opens the rows it counts. */
  lead: { text: string; href?: string };
  parts?: ReadonlyArray<ReactNode>;
}) {
  return (
    <p className="m-0 flex min-w-0 items-center gap-2 text-xs text-muted-foreground" role="status">
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} aria-hidden="true" />
      <span className="min-w-0 truncate">
        {lead.href ? (
          <Link href={lead.href} scroll={false} className="font-medium text-foreground underline underline-offset-2 hover:text-[var(--accent-ink)]">
            {lead.text}
          </Link>
        ) : (
          <span className="font-medium text-foreground">{lead.text}</span>
        )}
        {(parts ?? []).filter((part) => part !== null && part !== false && part !== "").map((part, index) => (
          <span key={index}> · {part}</span>
        ))}
      </span>
    </p>
  );
}
