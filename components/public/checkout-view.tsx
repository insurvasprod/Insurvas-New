import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { FunnelFrame, FunnelHeading } from "@/components/app/funnel-frame";
import { AuthAlert } from "@/components/portal/auth-controls";
import { AuthLegalLinks } from "@/components/portal/auth-layout";
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
  /** Add-ons ticked on the plan screen (step 2 of 3). They are attached when the plan starts and billed on the Insurvas invoice. */
  addons?: { name: string; price: string; cycle: BillingCycle }[];
  /** Prefills (and locks) the email in Whop's form: the verified account address. */
  email?: string;
  /** The cardholder name to prefill; null when the owner has not typed one yet. */
  name?: string | null;
  /** Which Whop environment the embedded form talks to: the one our API key belongs to. */
  environment?: "production" | "sandbox";
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
        // Short screens (1366×657): tighter, so Payment never scrolls (manager review, 2026-10-28).
        "flex w-full flex-col gap-5 [@media(max-height:720px)]:gap-3",
        dark ? "mx-auto max-w-[460px] rounded-xl border border-[var(--nav-line)] bg-black/20 p-6 text-[var(--nav-ink)] [@media(max-height:720px)]:p-5" : "rounded-xl border border-border bg-card p-4",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-xs font-semibold uppercase tracking-[0.08em]", dark ? "text-[var(--nav-muted)]" : "text-muted-foreground")}>Your plan</p>
          <h2 className={cn("mt-1 text-2xl font-semibold leading-tight tracking-[-0.02em]", strong)}>{planName ?? "Your plan"}</h2>
          {planLine && <p className={cn("text-sm", muted)}>{planLine}</p>}
        </div>
        {/* Back to the plan screen (step 2 of 3): a buyer who picked the wrong plan must not be stuck paying for it. */}
        <Link href="/app/onboarding/plan?change=1" className={cn("shrink-0 whitespace-nowrap text-sm font-semibold hover:underline", dark ? "text-[var(--nav-ink)]" : "text-[var(--accent-ink)]")}>Change plan</Link>
      </div>

      <dl className="text-sm">
        {rows.map((row) => (
          <div key={row.label} className={cn("flex justify-between gap-4 border-t py-2.5 [@media(max-height:720px)]:py-1.5", line)}>
            <dt className={muted}>{row.label}</dt>
            <dd className={cn("text-right font-semibold tabular-nums", strong)}>{row.value}</dd>
          </div>
        ))}
        <div className={cn("flex items-baseline justify-between gap-4 border-t pt-3.5 [@media(max-height:720px)]:pt-2", line)}>
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
      {/* Privacy · Terms · Support: under the form on every other step, here in the summary. */}
      <AuthLegalLinks className="!mt-0" onDark={dark} />
    </section>
  );
}

export function CheckoutView(props: CheckoutViewProps) {
  const { trialDays, pending, failed = false, noPayment = false, email = "", name = null, environment = "production" } = props;

  const body = (
    // Manager review, 2026-10-28: the payment step must not scroll. Whop's form is as tall as it is, so
    // Back sits on the step line, where step 1 has "Have an account? Sign in", instead of a row under it.
    <FunnelFrame
      step={4}
      wide
      // The legal links move into the summary, which has room (owner, 2026-10-28: "a tiny bit of scrolling").
      legal={false}
      aside={<Receipt props={props} dark />}
      stepsAside={
        <Link href="/app/onboarding/plan" data-funnel-back="" className="inline-flex items-center gap-1 font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" />Back to your plan
        </Link>
      }
    >
      {/* No visible heading or subtitle (owner, 2026-10-28): the stepper says "Payment" and the
          summary beside the form says what is charged and when, so the form starts right under the
          stepper. The heading stays for screen readers. */}
      <div className="sr-only"><FunnelHeading title={noPayment ? "Confirm your plan" : trialDays > 0 ? `Start your ${trialDays}-day free trial` : "Start your plan"} /></div>

      {/* "Pending" also covers a payment the provider has not finished recording, so this must not
          tell someone who has paid to pay again. */}
      {pending && !noPayment && (
        <AuthAlert tone="info" className="mb-5" title="We could not confirm a payment yet">
          If you have already paid, do not pay again: your plan unlocks on its own once the provider records it. If you have not, the form below picks up the same checkout.
        </AuthAlert>
      )}
      {failed && !noPayment && (
        <AuthAlert className="mb-5" title="Your payment did not go through">
          No money was taken. Try again below, or use another card or payment method.
        </AuthAlert>
      )}

      <div className="flex flex-col gap-4">
        {/* Below 1024px the brand panel is hidden: the receipt, with its coupon and terms, comes first. */}
        <div className="lg:hidden"><Receipt props={props} dark={false} /></div>

        {noPayment
          ? <CheckoutStart noPayment />
          : <PaymentEmbed email={email} name={name} environment={environment} />}

      </div>
    </FunnelFrame>
  );

  return noPayment ? body : <PaymentProvider>{body}</PaymentProvider>;
}
