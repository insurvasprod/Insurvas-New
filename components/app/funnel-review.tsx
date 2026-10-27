import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { FunnelHeading } from "@/components/app/funnel-frame";
import { Button } from "@/components/ui/button";

/**
 * A finished sign-up step seen again through Back (owner, 2026-10-27). Steps 1 and 2 cannot be redone
 * once the account exists and the email is confirmed, so Back shows what was done and a Continue to
 * where the signup stands, rather than an empty form that would only fail.
 */
export function FunnelReview({ title, subtitle, rows, continueHref, children }: {
  title: string;
  subtitle: string;
  rows: { label: string; value: string; done?: boolean }[];
  continueHref: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <FunnelHeading title={title}>{subtitle}</FunnelHeading>
      <dl className="m-0 divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3.5">
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="m-0 flex min-w-0 items-center gap-2 break-all text-base font-semibold tracking-[-0.02em] text-foreground">
              {row.value}
              {row.done && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--success-surface)] px-2.5 py-[3px] text-xs font-semibold text-[var(--success-ink)]">
                  <Check className="size-3 stroke-[3]" aria-hidden="true" />Confirmed
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <Button asChild className="mt-6 h-11 w-full">
        <Link href={continueHref}>Continue</Link>
      </Button>
      {children}
    </div>
  );
}
