import Link from "next/link";
import type { ReactNode } from "react";

import { CheckoutStart } from "@/components/public/checkout-start";
import { BILLING_CYCLE_LABELS, type BillingCycle } from "@/lib/money";

const PER: Record<BillingCycle, string> = { monthly: "month", quarterly: "quarter", yearly: "year" };

export type CheckoutViewProps = {
  planName: string | null;
  /** "Inbound + outbound · 12 seats · billed monthly" — empty when the plan defines none of it. */
  planLine: string;
  cycle: BillingCycle | null;
  /** "$249.00", or null when the plan has no price on the chosen cycle. */
  price: string | null;
  trialDays: number;
  /** "6 Oct 2026": the cancel-by date and the first charge. */
  trialEnds: string;
  /** Sent back from the return page with an unfinished payment. */
  pending: boolean;
};

/** Label over value, the pair both cards on this page are built from. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

function Step({ n, label, done }: { n: number; label: string; done: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className={
          done
            ? "inline-flex size-6 items-center justify-center rounded-full bg-[var(--success)] text-[var(--on-success)]"
            : "inline-flex size-6 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-semibold text-[var(--on-primary)]"
        }
        aria-hidden="true"
      >
        {done ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        ) : (
          n
        )}
      </span>
      <span className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">
        {label}
        <span className="sr-only">{done ? ", complete" : ", current step"}</span>
      </span>
    </span>
  );
}

/**
 * Step 3 of signup, as the board draws it: progress across the top, what is being bought on the
 * left with the coupon and the way out to the provider, and the order summary on the right.
 */
export function CheckoutView({ planName, planLine, cycle, price, trialDays, trialEnds, pending }: CheckoutViewProps) {
  return (
    <div className="portal-agent flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] px-4 py-10 sm:p-10">
      {/* Not a direct `main` child: the shell's `.portal-agent > main` reserves 264px for a sidebar. */}
      <div className="w-full max-w-[1040px]">
        <main className="m-in rounded-lg border border-border bg-card p-6 sm:p-10">
          <p className="text-center text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">Step 3 of 3</p>
          <h1 className="mt-2 text-center text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">Your workspace is ready</h1>
          <p className="mt-2.5 text-center text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            Confirm what you are buying. The card is entered on the provider’s page and never touches Insurvas servers.
          </p>

          <ol className="mt-6 flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-3.5 sm:flex-row sm:items-center sm:gap-0" aria-label="Signup progress">
            <li><Step n={1} label="Account complete" done /></li>
            <li className="m-track mx-3 hidden h-0.5 flex-1 bg-[var(--success)] sm:block" aria-hidden="true" />
            <li><Step n={2} label="Business profile" done /></li>
            <li className="m-track mx-3 hidden h-0.5 flex-1 bg-[var(--success)] sm:block" aria-hidden="true" />
            <li><Step n={3} label="Checkout" done={false} /></li>
          </ol>

          <div className="mt-7 flex flex-col gap-6 text-left lg:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <section className="rounded-lg border border-border bg-card p-5">
                <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">{planName ? `${planName} plan` : "Selected plan"}</h2>
                {planLine && <p className="mt-1 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">{planLine}</p>}
                <dl className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-4">
                  <Fact label="Trial">{trialDays} days</Fact>
                  <Fact label="Cancel by">{trialEnds}</Fact>
                  <Fact label="Today">$0.00</Fact>
                  <Fact label="After the trial">{price && cycle ? `${price} / ${PER[cycle]}` : "—"}</Fact>
                </dl>
              </section>

              <CheckoutStart />

              {/* Not on the board, kept on purpose: it is the only way back to pricing from here, and
                  a buyer who picked the wrong plan must not be stuck paying for it. */}
              <p className="text-center text-xs leading-normal tracking-[-0.01em]">
                <Link href="/pricing" className="font-semibold text-foreground underline underline-offset-2">Change plan</Link>
              </p>
            </div>

            <aside className="w-full shrink-0 lg:w-[300px]">
              <section className="rounded-lg border border-border bg-card p-5">
                <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">Order summary</h2>
                <dl className="mt-3.5 grid grid-cols-1 gap-y-4">
                  <Fact label="Plan">{planName ?? "—"}</Fact>
                  <Fact label="Billing">{cycle ? BILLING_CYCLE_LABELS[cycle] : "—"}</Fact>
                  <Fact label="Price">{price ?? "—"}</Fact>
                  <Fact label="Today">$0.00</Fact>
                  <Fact label="Next charge">{trialEnds}</Fact>
                </dl>
              </section>

              {/* An abandoned checkout reuses the same open session, and the return page sends an
                  unfinished payment back here with ?pending=1 — a calm notice, never an error. */}
              <div className="mt-4 rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
                <p className="font-semibold text-[var(--info-ink)]">Coming back later is fine</p>
                <p className="mt-1.5 text-[var(--body)]">
                  {pending
                    ? // "pending" also covers a payment the provider has not finished recording, so this
                      // must not tell someone who has paid to pay again.
                      "We could not confirm a payment yet. If you have already paid, do not pay again — your plan unlocks on its own once the provider records it. If you have not, continue to secure checkout and you will pick up the same session."
                    : "If you leave before paying, come back here and you will return to the same checkout."}
                </p>
              </div>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
