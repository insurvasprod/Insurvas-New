import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { FunnelHeading } from "@/components/app/funnel-frame";
import { Button } from "@/components/ui/button";

/**
 * A finished sign-up step seen again through Back (owner, 2026-10-27). Steps 1 and 2 cannot be redone
 * once the account exists and the email is confirmed, so Back shows what was done, rather than an
 * empty form that would only fail.
 *
 * Two ways on (owner, 2026-10-27): Continue returns to where the signup stands; "Next" walks one step
 * forward, so someone who went back can step through again. Next is left out when it is the same place.
 */
export function FunnelReview({ title, subtitle, rows, continueHref, next, children }: {
  title: string;
  subtitle: string;
  rows: { label: string; value: string; done?: boolean }[];
  continueHref: string;
  /** The step after this one, by name: "Next: Your email". */
  next?: { href: string; label: string };
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
      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
        <Button asChild className="h-11 flex-1">
          <Link href={continueHref}>Continue</Link>
        </Button>
        {next && next.href !== continueHref && (
          <Button asChild variant="outline" className="h-11 flex-1 border-[var(--border-strong)]">
            <Link href={next.href}>Next: {next.label}<ArrowRight aria-hidden="true" /></Link>
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}
