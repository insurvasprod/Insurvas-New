"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, LoaderCircle, Minus, Plus, Users } from "lucide-react";

import { FunnelHeading } from "@/components/app/funnel-frame";
import { AuthAlert } from "@/components/portal/auth-controls";
import { FunnelActions } from "@/components/portal/funnel-actions";
import { Button } from "@/components/ui/button";
import { BILLING_CYCLE_LABELS, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import {
  agencyPlanForSeats,
  choiceTotalCents,
  cyclesFor,
  type PlanChoiceModule,
  type PlanChoiceOption,
} from "@/lib/signup/planChoice";
import { cn } from "@/lib/utils";
import { firstChargeDate } from "@/lib/checkout/constants";
import { dayMonthYear } from "@/lib/format/dates";

type Audience = PlanChoiceOption["audience"];
// Manager review, 2026-10-28: "Independent agent", and a capital A on "Agency".
const AUDIENCE_LABEL: Record<Audience, string> = { individual: "Independent Agent", agency: "For an Agency" };
const PER: Record<BillingCycle, string> = { monthly: "month", quarterly: "quarter", yearly: "year" };

/** Sign-up offers two cycles (owner, 2026-10-29): with Quarterly the "Independent Agent" toggle had no room. */
const SIGNUP_CYCLES: readonly BillingCycle[] = ["monthly", "yearly"];
const signupCyclesFor = (plan: PlanChoiceOption) => cyclesFor(plan).filter((item) => SIGNUP_CYCLES.includes(item));

export type PlanChoiceInitial = { planCode: string; billingCycle: BillingCycle; seats: number | null; addonCodes: string[] };

type ChoiceState = {
  plans: PlanChoiceOption[];
  modules: PlanChoiceModule[];
  plan: PlanChoiceOption;
  cycle: BillingCycle;
  seats: number;
  totalCents: number | null;
  /** When the page was rendered: each plan's first charge is counted from it. */
  now: string;
  noPayment: boolean;
  saving: boolean;
  error: string | null;
  setAudience: (audience: Audience) => void;
  pickPlan: (code: string) => void;
  setCycle: (cycle: BillingCycle) => void;
  setSeats: (seats: number) => void;
  save: () => void;
};

const ChoiceContext = createContext<ChoiceState | null>(null);
const useChoice = () => {
  const value = useContext(ChoiceContext);
  if (!value) throw new Error("PlanChoice parts must sit inside PlanChoiceProvider");
  return value;
};

/** A seat count inside the band: 10 for a first band, the floor for the bands above it. */
const seatsFor = (plan: PlanChoiceOption, wanted: number | null) => {
  if (plan.audience === "individual") return 1;
  const start = wanted ?? Math.max(plan.minSeats, 10);
  return Math.max(plan.minSeats, plan.maxSeats == null ? start : Math.min(plan.maxSeats, start));
};

/**
 * the plan screen (step 2 of 3), Your plan (owner pick B, 2026-10-26). One state shared by the form on the left and the
 * summary that replaces the brand story on the right, so the total moves as the owner chooses.
 */
export function PlanChoiceProvider({ plans, modules, initial, now, noPayment, children }: {
  plans: PlanChoiceOption[];
  modules: PlanChoiceModule[];
  initial: PlanChoiceInitial | null;
  /** When the page was rendered: each plan's first charge is counted from it. */
  now: string;
  noPayment: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const start = plans.find((plan) => plan.code === initial?.planCode) ?? plans[0];
  const [planCode, setPlanCode] = useState(start.code);
  // A cycle picked on the pricing page is kept, quarterly included (it is still offered there).
  const [cycle, setCycleState] = useState<BillingCycle>(initial && start.cents[initial.billingCycle] != null ? initial.billingCycle : signupCyclesFor(start)[0] ?? "monthly");
  const [seats, setSeatsState] = useState(seatsFor(start, initial?.seats ?? null));
  // The one-agent plan last chosen, so switching to agency and back does not lose it.
  const [lastSolo, setLastSolo] = useState(start.audience === "individual" ? start.code : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = plans.find((candidate) => candidate.code === planCode) ?? start;

  function choose(next: PlanChoiceOption, nextSeats: number) {
    setError(null);
    setPlanCode(next.code);
    setSeatsState(nextSeats);
    if (next.audience === "individual") setLastSolo(next.code);
    // A cycle the new plan is not sold on falls back to its first one.
    if (next.cents[cycle] == null) setCycleState(signupCyclesFor(next)[0] ?? cycle);
  }

  const value: ChoiceState = {
    plans,
    modules,
    plan,
    cycle,
    seats,
    // No add-on can be chosen at sign-up (owner, 2026-10-27: "we can't add modules anywhere").
    totalCents: choiceTotalCents(plan, cycle, []),
    now,
    noPayment,
    saving,
    error,
    setAudience: (audience) => {
      if (audience === plan.audience) return;
      const next = audience === "agency"
        ? agencyPlanForSeats(plans, 10) ?? plans.find((candidate) => candidate.audience === "agency")
        : plans.find((candidate) => candidate.code === lastSolo) ?? plans.find((candidate) => candidate.audience === "individual");
      if (next) choose(next, seatsFor(next, audience === "agency" ? 10 : 1));
    },
    pickPlan: (code) => {
      const next = plans.find((candidate) => candidate.code === code);
      if (next) choose(next, seatsFor(next, seats));
    },
    setCycle: (next) => { if (plan.cents[next] != null) { setError(null); setCycleState(next); } },
    setSeats: (wanted) => {
      if (plan.audience !== "agency" || !Number.isFinite(wanted)) return;
      const count = Math.max(1, Math.min(100000, Math.trunc(wanted)));
      // The seat count picks the band; the band is the plan (AG-0.12).
      const band = agencyPlanForSeats(plans, count);
      if (band && band.code !== plan.code) choose(band, count);
      else { setError(null); setSeatsState(count); }
    },
    save: () => {
      setSaving(true);
      setError(null);
      fetch("/api/app/onboarding/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode: plan.code, billingCycle: cycle, seats, addonCodes: [] }),
      })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) { setError(body?.error ?? "Could not save your plan. Try again."); setSaving(false); return; }
          router.push(body?.redirectTo ?? "/app/checkout");
          router.refresh();
        })
        .catch(() => { setError("Could not reach Insurvas. Check your connection and try again."); setSaving(false); });
    },
  };

  return <ChoiceContext.Provider value={value}>{children}</ChoiceContext.Provider>;
}

/**
 * A 36px segmented control with 8px corners: the chosen side is a white thumb on a grey track
 * (owner, 2026-10-27; v3: pills only on marketing CTAs). Green stays for the primary action and the
 * chosen plan.
 */
const segmentTrack = "flex gap-0.5 rounded-lg border border-border bg-[var(--surface-alt)] p-0.5";
const segment = (active: boolean) => cn(
  "h-8 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-semibold tracking-[-0.02em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
  active ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08),0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground",
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:text-muted-foreground",
);

/** "Agency", "One-agent": for "Agency plans are billed monthly". */
const AUDIENCE_NOUN: Record<Audience, string> = { individual: "One-agent", agency: "Agency" };

/**
 * The seats row (owner, 2026-10-27): one bordered box at one size for both audiences, so switching
 * between them changes what is inside it, not the shape of the section.
 */
const seatRow = "flex min-h-[52px] flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-[var(--border-strong)] bg-card px-3 py-2";

/**
 * − [n] + as one joined control (owner, 2026-10-27: the three separate boxes touched the row's edge).
 * One border, hairline dividers, 36px tall (32px on a short screen, data-stepper in globals.css), so
 * the row always keeps at least 8px around it.
 */
const stepperButton = "grid w-9 place-items-center text-[var(--body)] transition-colors hover:bg-[var(--surface-alt)] hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4";

function Section({ n, title, note, children }: { n: number; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2.5 text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">
        <span className="text-[var(--accent-ink)]">{n}</span> · {title}
        {note && <span className="font-normal text-muted-foreground"> ({note})</span>}
      </h2>
      {children}
    </section>
  );
}

export function PlanChoiceForm() {
  const choice = useChoice();
  const { plans, plan, cycle, seats } = choice;
  const audiences = (["individual", "agency"] as const).filter((audience) => plans.some((candidate) => candidate.audience === audience));
  const shown = plans.filter((candidate) => candidate.audience === plan.audience);
  // Every cycle any plan is sold on, so the billing control has the same options for both audiences
  // (owner, 2026-10-27); one this audience is not sold on is shown, disabled, with the reason.
  // Monthly and Yearly; Quarterly only when it is the cycle already picked on the pricing page.
  const cycles = (cycle === "quarterly" ? (["monthly", "quarterly", "yearly"] as BillingCycle[]) : SIGNUP_CYCLES).filter((item) => plans.some((candidate) => candidate.cents[item] != null));
  const soldHere = cycles.filter((item) => shown.some((candidate) => candidate.cents[item] != null));
  const whyNot = (item: BillingCycle) =>
    soldHere.length === 1 && !soldHere.includes(item)
      ? `${AUDIENCE_NOUN[plan.audience]} plans are billed ${BILLING_CYCLE_LABELS[soldHere[0]].toLowerCase()}`
      : plan.cents[item] == null ? `${plan.name} is not sold ${BILLING_CYCLE_LABELS[item].toLowerCase()}` : null;
  // Section numbers start after "Who it is for" when both audiences are sold.
  const first = audiences.length > 1 ? 1 : 0;
  // What is typed in the seat box, so it can be cleared and retyped without snapping to 1 midway.
  const [seatText, setSeatText] = useState<string | null>(null);

  return (
    <div>
      {/* No subtitle: the numbered sections say what to do (owner, 2026-10-27). */}
      <FunnelHeading title="Choose your plan" />
      {/* Who and billing side by side, so the step fits a laptop window (owner, 2026-10-27). Billing
          shows even with one cycle, so the row does not change shape between one agent and agency. */}
      <form onSubmit={(event) => { event.preventDefault(); choice.save(); }} data-auth-fields="" className="flex flex-col gap-6">
        {/* "Who it is for" gets the wider share: "Independent Agent" stays on one line (owner, 2026-10-29). */}
        <div className={cn("grid grid-cols-1 gap-4", audiences.length > 1 ? "sm:grid-cols-[3fr_2fr]" : "sm:grid-cols-2")}>
          {audiences.length > 1 && (
            <Section n={1} title="Who it is for">
              <div role="radiogroup" aria-label="Who it is for" className={segmentTrack}>
                {audiences.map((audience) => (
                  <button key={audience} type="button" role="radio" aria-checked={plan.audience === audience} className={segment(plan.audience === audience)} onClick={() => choice.setAudience(audience)}>
                    {AUDIENCE_LABEL[audience]}
                  </button>
                ))}
              </div>
            </Section>
          )}
          <Section n={first + 1} title="Billing">
            <div role="radiogroup" aria-label="Billing" className={segmentTrack}>
              {cycles.map((item) => {
                const reason = whyNot(item);
                return (
                  <button
                    key={item}
                    type="button"
                    role="radio"
                    onClick={() => { if (!reason) choice.setCycle(item); }}
                    aria-checked={cycle === item}
                    // Not `disabled`: a disabled button shows no tooltip, and the reason is the point.
                    aria-disabled={reason ? true : undefined}
                    aria-describedby={reason ? `billing-why-${item}` : undefined}
                    tabIndex={reason ? -1 : undefined}
                    title={reason ?? undefined}
                    className={segment(cycle === item)}
                  >
                    {BILLING_CYCLE_LABELS[item]}
                    {reason && <span id={`billing-why-${item}`} className="sr-only">{reason}</span>}
                  </button>
                );
              })}
            </div>
          </Section>
        </div>

        <Section n={first + 2} title="Plan">
          <div role="radiogroup" aria-label="Plan" className="flex flex-col gap-2">
            {shown.map((candidate) => {
              const on = candidate.code === plan.code;
              const cents = candidate.cents[cycle];
              return (
                <button
                  key={candidate.code}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-plan-card=""
                  disabled={cents == null}
                  onClick={() => choice.pickPlan(candidate.code)}
                  className={cn(
                    "flex w-full items-center gap-3.5 rounded-xl border px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                    on ? "border-[1.5px] border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border-strong)] bg-card hover:border-[var(--accent-ink)]",
                  )}
                >
                  <span aria-hidden className={cn("grid size-[18px] shrink-0 place-items-center rounded-full border-2", on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)]")}>
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{candidate.name}</span>
                    {candidate.blurb && <span className="block text-xs leading-normal text-[var(--body)]">{candidate.blurb}</span>}
                  </span>
                  <span className="shrink-0 text-right text-base font-semibold tabular-nums text-foreground">
                    {cents == null
                      ? <span className="text-xs font-normal text-muted-foreground">Not sold {BILLING_CYCLE_LABELS[cycle].toLowerCase()}</span>
                      : <>{formatCentsAsCurrency(cents)}<span className="text-xs font-normal text-muted-foreground"> / {PER[cycle]}</span></>}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section n={first + 3} title="Seats">
          {plan.audience === "agency" ? (
            <div data-seat-row="" className={seatRow}>
              <div className="flex items-center gap-2.5">
                <div data-stepper="" className="inline-flex h-9 items-stretch overflow-hidden rounded-md border border-[var(--border-strong)] bg-card">
                <button type="button" onClick={() => choice.setSeats(seats - 1)} aria-label="One seat fewer" disabled={seats <= 1} className={stepperButton}><Minus aria-hidden="true" /></button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  aria-label="Seats"
                  value={seatText ?? seats}
                  onChange={(event) => {
                    setSeatText(event.target.value);
                    const typed = Number.parseInt(event.target.value, 10);
                    if (typed >= 1) choice.setSeats(typed);
                  }}
                  onBlur={() => setSeatText(null)}
                  className="w-16 border-x border-[var(--border-strong)] bg-transparent text-center text-base font-semibold tabular-nums text-foreground outline-none [appearance:textfield] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button type="button" onClick={() => choice.setSeats(seats + 1)} aria-label="One seat more" className={stepperButton}><Plus aria-hidden="true" /></button>
                </div>
                <span className="text-sm text-muted-foreground">seats</span>
              </div>
              <span className="text-sm text-muted-foreground">{plan.maxSeats == null ? "No seat limit" : `Up to ${plan.maxSeats} on this plan`}</span>
            </div>
          ) : (
            <div data-seat-row="" className={seatRow}>
              <span className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--surface-alt)] text-[var(--body)]"><Users className="size-4" aria-hidden="true" /></span>
                <span className="leading-tight">
                  <span className="block text-sm font-semibold text-foreground">1 seat</span>
                  <span className="block text-xs text-muted-foreground">One-agent plans include one seat</span>
                </span>
              </span>
              {audiences.includes("agency") && (
                <button type="button" onClick={() => choice.setAudience("agency")} data-tap="" className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-[var(--accent-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring-color)] [&_svg]:transition-transform hover:[&_svg]:translate-x-[2px]">
                  Switch to agency<ArrowRight className="size-[13px] stroke-[2.4]" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </Section>

        {choice.error && <AuthAlert>{choice.error}</AuthAlert>}

        {/* Below 1024px the summary panel is hidden with the brand story, so the total and the button sit here. */}
        <div className="flex flex-col gap-3 border-t border-border pt-4 lg:hidden">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-foreground">Total</span>
            <span className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-foreground">{choice.totalCents == null ? "—" : formatCentsAsCurrency(choice.totalCents)}<span className="text-sm font-normal text-muted-foreground"> / {PER[cycle]}</span></span>
          </div>
          <TrialLine className="text-[var(--accent-ink)]" />
          <ContinueButton />
        </div>
      </form>
    </div>
  );
}

/**
 * The plan step when the plan was picked on the pricing page (manager review, 2026-10-28, 03:43:
 * "I already made a choice from the landing page. Why do I need to make another choice? Just show
 * them this information."). What they picked, and that today costs nothing; "Change plan" opens the
 * full chooser (?change=1). Back and "Continue to payment" sit under it; the right side shows the
 * product slides, since the plan is already on the left (owner, 2026-10-28).
 */
export function PlanChosenPanel() {
  const choice = useChoice();
  const { plan, cycle, seats, totalCents, noPayment } = choice;
  const price = plan.cents[cycle];
  const rows = [
    { label: "Who it is for", value: plan.audience === "individual" ? "Independent Agent" : "Agency" },
    { label: "Billing", value: BILLING_CYCLE_LABELS[cycle] },
    { label: "Seats", value: plan.audience === "individual" ? "1" : String(seats) },
    { label: "Price", value: price == null ? "—" : `${formatCentsAsCurrency(price)} / ${PER[cycle]}` },
  ];
  return (
    <div>
      <FunnelHeading title="Your plan">
        {noPayment ? "Picked on the pricing page. Nothing is charged." : plan.trialDays > 0 ? "Picked on the pricing page. Nothing to pay today." : "Picked on the pricing page."}
      </FunnelHeading>
      <section aria-label="The plan you picked" data-plan-chosen="" className="rounded-xl border-[1.5px] border-[var(--primary)] bg-[var(--primary-soft)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-[-0.02em] text-foreground">{plan.name}</p>
            {plan.blurb && <p className="mt-0.5 text-sm text-[var(--body)]">{plan.blurb}</p>}
          </div>
          <Check className="mt-1 size-5 shrink-0 text-[var(--accent-ink)]" aria-hidden="true" />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="m-0 font-semibold tabular-nums text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-[color-mix(in_srgb,var(--primary)_35%,transparent)] pt-3">
          <span className="text-sm font-semibold text-foreground">Today</span>
          <span className="text-title-lg font-semibold tabular-nums tracking-[-0.02em] text-foreground">{noPayment || plan.trialDays > 0 ? "$0.00" : totalCents == null ? "—" : formatCentsAsCurrency(totalCents)}</span>
        </div>
        <TrialLine className="mt-1 text-[var(--accent-ink)]" />
      </section>
      <p className="mt-4 text-sm text-muted-foreground">
        Want something else?{" "}
        <Link href="/app/onboarding/plan?change=1" data-tap="" className="font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">Change plan</Link>
      </p>
      {choice.error && <AuthAlert className="mt-4">{choice.error}</AuthAlert>}
      {/* Back and Continue under the plan, at every width: the right side shows the product slides
          here, not the summary (owner, 2026-10-28). */}
      <div className="mt-6"><ContinueButton /></div>
    </div>
  );
}

function TrialLine({ className }: { className?: string }) {
  const { noPayment, plan, now } = useChoice();
  const trialEnds = dayMonthYear(firstChargeDate(plan.trialDays, new Date(now)), "UTC");
  return (
    <p className={cn("text-sm leading-normal tracking-[-0.02em]", className)}>
      {noPayment ? "No card needed. Nothing is charged." : plan.trialDays > 0 ? `$0.00 today · ${plan.trialDays}-day trial · first charge ${trialEnds}` : "The first period is charged today."}
    </p>
  );
}

/** Back beside "Continue to payment", the footer of every sign-up step (manager review, 2026-10-28). */
function ContinueButton({ onDark = false }: { onDark?: boolean }) {
  const { saving, save } = useChoice();
  return (
    <FunnelActions back="/app/verify-email" onDark={onDark}>
      <Button type="button" className="h-11" disabled={saving} onClick={save}>
        {saving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {saving ? "Saving…" : "Continue to payment"}
      </Button>
    </FunnelActions>
  );
}

/** The right side: the plan, what it covers module by module, the lines and the total. */
export function PlanChoiceSummary() {
  const { plan, modules, cycle, seats, totalCents } = useChoice();
  const granted = new Set(plan.featureKeys);
  const allFeatures = modules.reduce((sum, module) => sum + module.features.length, 0);
  const included = modules.reduce((sum, module) => sum + module.features.filter((feature) => granted.has(feature.key)).length, 0);
  const lines = [
    { label: plan.name, value: plan.cents[cycle] == null ? "—" : `${formatCentsAsCurrency(plan.cents[cycle]!)} / ${PER[cycle]}` },
    { label: "Seats", value: plan.audience === "agency" ? `${seats} of ${plan.maxSeats ?? "unlimited"} in this band` : "1 (one-agent plan)" },
  ];

  return (
    <section aria-label="Your plan summary" className="mx-auto w-full max-w-[500px] rounded-xl border border-[var(--nav-line)] bg-black/20 p-6 text-[var(--nav-ink)]">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--nav-muted)]">Your plan</p>
      <h2 className="mt-1.5 text-2xl font-semibold leading-tight tracking-[-0.02em] text-[var(--on-dark)]">{plan.name}</h2>
      <p className="text-sm text-[var(--nav-muted)]">{included} of {allFeatures} features</p>

      <ul className="my-4 grid grid-cols-2 gap-x-5 gap-y-1">
        {modules.map((module) => {
          const count = module.features.filter((feature) => granted.has(feature.key)).length;
          const all = count === module.features.length;
          return (
            <li key={module.key} className={cn("flex items-center justify-between gap-2 py-0.5 text-sm", all ? "text-[var(--on-dark)]" : count ? "text-[var(--nav-ink)]" : "text-[var(--nav-muted)] opacity-70")}>
              <span className="flex min-w-0 items-center gap-1.5"><span aria-hidden="true">{all ? "✓" : count ? "◐" : "–"}</span><span className="truncate">{module.label}</span></span>
              <span className="shrink-0 text-xs text-[var(--nav-muted)]">{all ? "all" : `${count}/${module.features.length}`}</span>
            </li>
          );
        })}
      </ul>

      <dl className="text-sm">
        {lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-4 border-t border-[var(--nav-line)] py-2.5">
            <dt className="text-[var(--nav-muted)]">{line.label}</dt>
            <dd className="text-right font-semibold tabular-nums text-[var(--on-dark)]">{line.value}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-[var(--nav-line)] pt-3.5">
          <dt className="font-semibold text-[var(--on-dark)]">Total</dt>
          <dd className="text-title-lg font-semibold tabular-nums tracking-[-0.02em] text-[var(--on-dark)]">
            {totalCents == null ? "—" : formatCentsAsCurrency(totalCents)}<span className="text-sm font-normal text-[var(--nav-muted)]"> / {PER[cycle]}</span>
          </dd>
        </div>
      </dl>
      <TrialLine className="mt-1 text-[var(--primary)]" />
      {/* On the green panel: Back in the panel's colours (2026-10-28: it was white on white). */}
      <div className="mt-4"><ContinueButton onDark /></div>
    </section>
  );
}
