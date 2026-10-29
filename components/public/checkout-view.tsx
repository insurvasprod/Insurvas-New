import Link from "next/link";
import type { ReactNode } from "react";

import { FunnelFrame, FunnelHeading } from "@/components/app/funnel-frame";
import { Button } from "@/components/ui/button";
import { CheckoutStart } from "@/components/public/checkout-start";
import { PaymentCoupon, PaymentEmbed, PaymentProvider } from "@/components/public/checkout-embed";
import { BILLING_CYCLE_LABELS, type BillingCycle } from "@/lib/money";
import { cn } from "@/lib/utils";

const PER: Record<BillingCycle, string> = { monthly: "month", quarterly: "quarter", yearly: "year" };

export type CheckoutViewProps = {
  planName: string | null;
  /** "24 seats · billed monthly" — empty when the plan defines none of it. */
  planLine: string;
  cycle: BillingCycle | null;
  /** "$249.00", or null when the plan has no price on the chosen cycle. */
  price: string | null;
  /** "$99.00" when the plan carries a one-time setup fee, else null. */
  setupFee?: string | null;
  trialDays: number;
  /** "6 Oct 2026": the cancel-by date and the first charge. */
  trialEnds: string;
  /** Sent back from the return page with an unfinished payment. */
  pending: boolean;
  /** Sent back from an off-site payment step (a bank page, 3-D Secure) that failed or was cancelled. */
  failed?: boolean;
  /** CHECKOUT_PAYMENT_MODE=none: the button starts the plan at once; no card, no provider. */
  noPayment?: boolean;
  /** Add-ons ticked on the plan screen. They are attached when the plan starts and billed on the Insurvas invoice. */
  addons?: { name: string; price: string; cycle: BillingCycle }[];
  /** Prefills the email field in Whop's form. */
  email?: string;
  /** Which Whop environment the embedded form talks to: the one our API key belongs to. */
  environment?: "production" | "sandbox";
  /** The plan screen, when one was shown; a plan picked on Pricing has no screen to go back to (Change plan stays). */
  backHref?: string;
};

/**
 * The automatic-renewal terms, stated once, beside the payment form: what it costs, how often, that it
 * renews until cancelled, when the first charge lands, that taxes may apply, and where to cancel. Whop
 * gives one trial per buyer per plan, so a returning buyer is told the first period may be charged
 * today rather than being promised $0.
 */
function renewalTerms({ cycle, price, setupFee, trialDays, trialEnds, addons }: Pick<CheckoutViewProps, "cycle" | "price" | "setupFee" | "trialDays" | "trialEnds" | "addons">): ReactNode {
  const period = cycle ? PER[cycle] : null;
  const amount = price && period ? <><strong>{price} per {period}</strong>, renewing automatically every {period} until you cancel.</> : <>The subscription renews automatically each billing period until you cancel.</>;
  const firstCharge = trialDays > 0
    ? <> Nothing is charged today; your card is first charged on <strong>{trialEnds}</strong>, when the {trialDays}-day trial ends. If you have had a trial on this plan before, the first {period ?? "period"} is charged today instead.</>
    : <> The first {period ?? "period"} is charged today.</>;
  return (
    <>
      {amount}
      {firstCharge}
      {setupFee ? <> A one-time setup fee of {setupFee} also applies; the payment form shows when it is charged.</> : null}
      {addons?.length ? <> Add-ons are billed on your Insurvas invoice.</> : null}
      {" "}Taxes may apply. Cancel online at any time in Settings › Plan &amp; billing; cancelling stops the next renewal.
    </>
  );
}

/**
 * The receipt (owner pick A, 2026-10-26): plan and Change plan, the lines, what is due today, the
 * coupon and the renewal terms. On the brand panel beside the form on a wide screen; above the form,
 * on the page's own colours, below 1024px where the panel is hidden.
 */
function Receipt({ props, dark }: { props: CheckoutViewProps; dark: boolean }) {
  const { planName, planLine, cycle, price, setupFee = null, trialDays, trialEnds, noPayment = false, addons = [] } = props;
  const muted = dark ? "text-[var(--nav-muted)]" : "text-[var(--body)]";
  const strong = dark ? "text-[var(--on-dark)]" : "text-foreground";
  const line = dark ? "border-[var(--nav-line)]" : "border-border";
  const rows = [
    ...(!noPayment && trialDays > 0 ? [{ label: `First charge on ${trialEnds}`, value: price && cycle ? `${price} / ${PER[cycle]}` : "—" }] : []),
    ...(!noPayment && trialDays === 0 ? [{ label: "Then", value: price && cycle ? `${price} / ${PER[cycle]}` : "—" }] : []),
    ...addons.map((addon) => ({ label: `${addon.name} add-on · on your Insurvas invoice`, value: `+${addon.price} / ${PER[addon.cycle]}` })),
    ...(setupFee && !noPayment ? [{ label: "Setup fee", value: `${setupFee} one-time` }] : []),
    ...(!noPayment && cycle ? [{ label: "Billing", value: `${BILLING_CYCLE_LABELS[cycle]}, until you cancel` }] : []),
  ];

  return (
    <section
      aria-label="Your plan"
      className={cn(
        "flex w-full flex-col gap-5",
        dark ? "mx-auto max-w-[460px] rounded-[22px] border border-[var(--nav-line)] bg-black/35 p-6 text-[var(--nav-ink)] shadow-[0_30px_80px_rgba(0,0,0,.45)] backdrop-blur-xl" : "rounded-xl border border-border bg-card p-4",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-xs font-semibold uppercase tracking-[0.08em]", dark ? "text-[var(--nav-muted)]" : "text-muted-foreground")}>Your plan</p>
          <h2 className={cn("mt-1 text-2xl font-semibold leading-tight tracking-[-0.02em]", strong)}>{planName ?? "Your plan"}</h2>
          {planLine && <p className={cn("text-sm", muted)}>{planLine}</p>}
        </div>
        {/* Back to the plan screen: a buyer who picked the wrong plan must not be stuck paying for it. */}
        <Link href="/app/onboarding/plan?change=1" className={cn("shrink-0 whitespace-nowrap text-sm font-semibold hover:underline", dark ? "text-[var(--nav-ink)]" : "text-[var(--accent-ink)]")}>Change plan</Link>
      </div>

      <dl className="text-sm">
        {rows.map((row) => (
          <div key={row.label} className={cn("flex justify-between gap-4 border-t py-2.5", line)}>
            <dt className={muted}>{row.label}</dt>
            <dd className={cn("text-right font-semibold tabular-nums", strong)}>{row.value}</dd>
          </div>
        ))}
        <div className={cn("flex items-baseline justify-between gap-4 border-t pt-3.5", line)}>
          <dt className={cn("font-semibold", strong)}>Due today</dt>
          <dd className={cn("text-title-lg font-semibold tabular-nums tracking-[-0.02em]", strong)}>{noPayment || trialDays > 0 ? "$0.00" : price ?? "—"}</dd>
        </div>
      </dl>

      {!noPayment && <PaymentCoupon dark={dark} />}

      <p id={dark ? "renewal-terms" : undefined} className={cn("text-xs leading-normal tracking-[-0.01em]", muted)}>
        {noPayment
          ? <>No card is needed and nothing is charged. Your plan starts now{trialDays > 0 ? <> with a {trialDays}-day trial</> : null}, and no billing is set up for it.</>
          : renewalTerms(props)}
      </p>
    </section>
  );
}

export function CheckoutView(props: CheckoutViewProps) {
  const { trialDays, pending, failed = false, noPayment = false, email = "", environment = "production", backHref } = props;

  // Kept short on purpose (manager review, 2026-10-28): the Whop form cannot shrink, so everything
  // around it does, and the whole step fits a 1536×826 screen without scrolling.
  const body = (
    <FunnelFrame step={2} wide aside={<Receipt props={props} dark />}>
      <FunnelHeading title={noPayment ? "Confirm your plan" : trialDays > 0 ? `Start your ${trialDays}-day trial` : "Start your plan"}>
        {noPayment
          ? "No payment is taken. Your workspace opens as soon as you continue."
          : trialDays > 0 ? "$0 today. Your card goes straight to Whop, our payment provider." : "Your card goes straight to Whop, our payment provider."}
      </FunnelHeading>

      {/* "Pending" also covers a payment the provider has not finished recording, so this must not
          tell someone who has paid to pay again. */}
      {pending && !noPayment && (
        <div role="status" className="mb-5 rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
          <p className="font-semibold text-[var(--info-ink)]">We could not confirm a payment yet</p>
          <p className="mt-1 text-[var(--body)]">If you have already paid, do not pay again: your plan unlocks on its own once the provider records it. If you have not, the form below picks up the same checkout.</p>
        </div>
      )}
      {failed && !noPayment && (
        <div role="alert" className="mb-5 rounded-lg border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3.5 text-sm leading-normal">
          <p className="font-semibold text-[var(--error-ink)]">Your payment did not go through</p>
          <p className="mt-1 text-[var(--body)]">No money was taken. Try again below, or use another card or payment method.</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* Below 1024px the brand panel is hidden: the receipt, with its coupon and terms, comes first. */}
        <div className="lg:hidden"><Receipt props={props} dark={false} /></div>

        {noPayment
          ? <CheckoutStart noPayment />
          : <PaymentEmbed email={email} environment={environment} />}

        {/* Back sits under the form, where every other step keeps it. Whop's own button submits payment. */}
        {backHref && (
          <div>
            <Button asChild variant="outline" className="h-12 border-[var(--border-strong)] px-6">
              <Link href={backHref}>Back</Link>
            </Button>
          </div>
        )}
      </div>
    </FunnelFrame>
  );

  return noPayment ? body : <PaymentProvider>{body}</PaymentProvider>;
}
