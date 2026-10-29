import Link from "next/link";
import { Check } from "lucide-react";

import { FunnelActions } from "@/components/portal/funnel-actions";
import { FunnelHeading } from "@/components/app/funnel-frame";
import { Button } from "@/components/ui/button";

/**
 * A finished sign-up step seen again through Back (owner, 2026-10-27). Steps 1 and 2 cannot be redone
 * once the account exists and the email is confirmed, so Back shows what was done, rather than an
 * empty form that would only fail.
 *
 * One way on (manager review, 2026-10-28): Continue returns to where the sign-up stands. The second
 * "Next: …" button and "Not you? Sign out" are gone; `back` adds the Back button on steps after the first.
 */
export function FunnelReview({ title, subtitle, rows, continueHref, back }: {
  title: string;
  subtitle: string;
  rows: { label: string; value: string; done?: boolean }[];
  continueHref: string;
  back?: string;
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
      <FunnelActions back={back} className="mt-6">
        <Button asChild className="h-11">
          <Link href={continueHref}>Continue</Link>
        </Button>
      </FunnelActions>
    </div>
  );
}
