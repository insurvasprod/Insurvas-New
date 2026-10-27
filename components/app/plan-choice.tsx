"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Minus, Plus } from "lucide-react";

import { FunnelHeading } from "@/components/app/funnel-frame";
import { AuthAlert } from "@/components/portal/auth-controls";
import { Button } from "@/components/ui/button";
import { BILLING_CYCLES, BILLING_CYCLE_LABELS, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import {
  addonsFor,
  agencyPlanForSeats,
  choiceTotalCents,
  cyclesFor,
  type PlanChoiceModule,
  type PlanChoiceOption,
} from "@/lib/signup/planChoice";
import { cn } from "@/lib/utils";

type Audience = PlanChoiceOption["audience"];
const AUDIENCE_LABEL: Record<Audience, string> = { individual: "For one agent", agency: "For an agency" };
const PER: Record<BillingCycle, string> = { monthly: "month", quarterly: "quarter", yearly: "year" };
const SHORT: Record<BillingCycle, string> = { monthly: "mo", quarterly: "qtr", yearly: "yr" };

export type PlanChoiceInitial = { planCode: string; billingCycle: BillingCycle; seats: number | null; addonCodes: string[] };

type ChoiceState = {
  plans: PlanChoiceOption[];
  modules: PlanChoiceModule[];
  plan: PlanChoiceOption;
  cycle: BillingCycle;
  seats: number;
  addonCodes: string[];
  totalCents: number | null;
  trialEnds: string;
  noPayment: boolean;
  saving: boolean;
  error: string | null;
  setAudience: (audience: Audience) => void;
  pickPlan: (code: string) => void;
  setCycle: (cycle: BillingCycle) => void;
  setSeats: (seats: number) => void;
  toggleAddon: (code: string) => void;
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
 * Step 4 of 5, Your plan (owner pick B, 2026-10-26). One state shared by the form on the left and the
 * summary that replaces the brand story on the right, so the total moves as the owner chooses.
 */
export function PlanChoiceProvider({ plans, modules, initial, trialEnds, noPayment, children }: {
  plans: PlanChoiceOption[];
  modules: PlanChoiceModule[];
  initial: PlanChoiceInitial | null;
  trialEnds: string;
  noPayment: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const start = plans.find((plan) => plan.code === initial?.planCode) ?? plans[0];
  const [planCode, setPlanCode] = useState(start.code);
  const [cycle, setCycleState] = useState<BillingCycle>(initial && start.cents[initial.billingCycle] != null ? initial.billingCycle : cyclesFor(start)[0] ?? "monthly");
  const [seats, setSeatsState] = useState(seatsFor(start, initial?.seats ?? null));
  const [addonCodes, setAddonCodes] = useState<string[]>(initial?.addonCodes ?? []);
  // The one-agent plan last chosen, so switching to agency and back does not lose it.
  const [lastSolo, setLastSolo] = useState(start.audience === "individual" ? start.code : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = plans.find((candidate) => candidate.code === planCode) ?? start;
  const offered = addonsFor(plan, cycle).map((addon) => addon.code);
  const picked = addonCodes.filter((code) => offered.includes(code));

  function choose(next: PlanChoiceOption, nextSeats: number) {
    setError(null);
    setPlanCode(next.code);
    setSeatsState(nextSeats);
    if (next.audience === "individual") setLastSolo(next.code);
    // A cycle the new plan is not sold on falls back to its first one.
    if (next.cents[cycle] == null) setCycleState(cyclesFor(next)[0] ?? cycle);
  }

  const value: ChoiceState = {
    plans,
    modules,
    plan,
    cycle,
    seats,
    addonCodes: picked,
    totalCents: choiceTotalCents(plan, cycle, picked),
    trialEnds,
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
    toggleAddon: (code) => setAddonCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]),
    save: () => {
      setSaving(true);
      setError(null);
      fetch("/api/app/onboarding/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode: plan.code, billingCycle: cycle, seats, addonCodes: picked }),
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

const segment = (active: boolean) => cn(
  "h-9 flex-1 rounded-full px-3 text-sm font-semibold tracking-[-0.02em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
  active ? "bg-[var(--primary)] text-[var(--on-primary)]" : "text-muted-foreground hover:text-foreground",
);

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

function bandLabel(plan: PlanChoiceOption) {
  return plan.maxSeats == null ? `${plan.minSeats}+ seats` : `${plan.minSeats}–${plan.maxSeats} seats`;
}

/** The left side: who it is for, plan and billing, seats, add-ons. */
export function PlanChoiceForm() {
  const choice = useChoice();
  const { plans, plan, cycle, seats } = choice;
  const audiences = (["individual", "agency"] as const).filter((audience) => plans.some((candidate) => candidate.audience === audience));
  const shown = plans.filter((candidate) => candidate.audience === plan.audience);
  const cycles = BILLING_CYCLES.filter((item) => shown.some((candidate) => candidate.cents[item] != null));
  const addons = addonsFor(plan, cycle);
  // What is typed in the seat box, so it can be cleared and retyped without snapping to 1 midway.
  const [seatText, setSeatText] = useState<string | null>(null);
  const nextBand = plan.maxSeats == null ? null : plans.find((candidate) => candidate.audience === "agency" && candidate.minSeats === (plan.maxSeats ?? 0) + 1);

  return (
    <div>
      <FunnelHeading title="Choose your plan">Four choices. Your total updates as you go.</FunnelHeading>
      <form onSubmit={(event) => { event.preventDefault(); choice.save(); }} className="flex flex-col gap-6">
        {audiences.length > 1 && (
          <Section n={1} title="Who it is for">
            <div role="radiogroup" aria-label="Who it is for" className="flex gap-1 rounded-full border border-border bg-[var(--surface-alt)] p-1">
              {audiences.map((audience) => (
                <button key={audience} type="button" role="radio" aria-checked={plan.audience === audience} className={segment(plan.audience === audience)} onClick={() => choice.setAudience(audience)}>
                  {AUDIENCE_LABEL[audience]}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section n={audiences.length > 1 ? 2 : 1} title="Plan and billing">
          {cycles.length > 1 && (
            <div role="radiogroup" aria-label="Billing" className="mb-2.5 flex gap-1 rounded-full border border-border bg-[var(--surface-alt)] p-1">
              {cycles.map((item) => (
                <button key={item} type="button" role="radio" aria-checked={cycle === item} disabled={plan.cents[item] == null} title={plan.cents[item] == null ? `${plan.name} is not sold ${BILLING_CYCLE_LABELS[item].toLowerCase()}` : undefined} className={segment(cycle === item)} onClick={() => choice.setCycle(item)}>
                  {BILLING_CYCLE_LABELS[item]}
                </button>
              ))}
            </div>
          )}
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

        <Section n={audiences.length > 1 ? 3 : 2} title="Seats">
          {plan.audience === "agency" ? (
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button type="button" variant="outline" size="icon" className="size-9 border-[var(--border-strong)]" aria-label="One seat fewer" disabled={seats <= 1} onClick={() => choice.setSeats(seats - 1)}><Minus aria-hidden="true" /></Button>
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
                  className="h-9 w-[88px] rounded-lg border border-[var(--border-strong)] bg-card text-center text-base font-semibold tabular-nums text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                />
                <Button type="button" variant="outline" size="icon" className="size-9 border-[var(--border-strong)]" aria-label="One seat more" onClick={() => choice.setSeats(seats + 1)}><Plus aria-hidden="true" /></Button>
                <span className="text-sm text-muted-foreground">seats</span>
              </div>
              <input
                type="range"
                min={1}
                max={Math.max(200, seats)}
                value={seats}
                aria-label="Seats slider"
                onChange={(event) => choice.setSeats(Number(event.target.value))}
                className="mt-3.5 w-full accent-[var(--primary)]"
              />
              <ol aria-label="Seat bands" className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: shown.map((band) => `${band.maxSeats == null ? 50 : Math.max(30, band.maxSeats - band.minSeats + 1)}fr`).join(" ") }}>
                {shown.map((band) => (
                  <li key={band.code} className={cn("rounded-lg border px-2 py-1.5 text-xs leading-normal", band.code === plan.code ? "border-[var(--primary)] bg-[var(--primary-soft)] text-foreground" : "border-border text-muted-foreground")}>
                    <strong className="block font-semibold">{bandLabel(band).replace(" seats", "")}</strong>
                    {band.cents.monthly != null ? `${formatCentsAsCurrency(band.cents.monthly)}/mo` : ""}
                  </li>
                ))}
              </ol>
              <p className="mt-2.5 text-sm leading-normal text-[var(--body)]" aria-live="polite">
                {seats} seats → {plan.cents[cycle] != null ? `${formatCentsAsCurrency(plan.cents[cycle]!)} a ${PER[cycle]}` : plan.name}.{" "}
                {plan.maxSeats == null
                  ? "No seat limit."
                  : `${plan.maxSeats - seats} more seat${plan.maxSeats - seats === 1 ? "" : "s"} fit before the next band${nextBand?.cents[cycle] != null ? ` (${formatCentsAsCurrency(nextBand.cents[cycle]!)})` : ""}.`}
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <Button type="button" variant="outline" size="icon" className="size-9 border-[var(--border-strong)]" aria-label="One seat fewer" disabled><Minus aria-hidden="true" /></Button>
              <input type="number" aria-label="Seats" value={1} disabled readOnly className="h-9 w-[88px] rounded-lg border border-[var(--border-strong)] bg-card text-center text-base font-semibold text-foreground opacity-60" />
              <Button type="button" variant="outline" size="icon" className="size-9 border-[var(--border-strong)]" aria-label="One seat more" disabled><Plus aria-hidden="true" /></Button>
              <span className="text-sm leading-normal text-muted-foreground">
                One-agent plans have one seat. Need a team?{" "}
                {audiences.includes("agency") && <button type="button" className="font-semibold text-[var(--accent-ink)] hover:underline" onClick={() => choice.setAudience("agency")}>Switch to an agency plan</button>}
              </span>
            </div>
          )}
        </Section>

        <Section n={audiences.length > 1 ? 4 : 3} title="Add modules" note="optional">
          {addons.length === 0 ? (
            <p className="text-sm leading-normal text-muted-foreground">No add-on modules are offered on {plan.name} {BILLING_CYCLE_LABELS[cycle].toLowerCase()}.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {addons.map((addon) => {
                const on = choice.addonCodes.includes(addon.code);
                return (
                  <label key={addon.code} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors", on ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border-strong)] bg-card hover:border-[var(--accent-ink)]")}>
                    <input type="checkbox" checked={on} onChange={() => choice.toggleAddon(addon.code)} className="size-[18px] shrink-0 accent-[var(--accent-ink)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">{addon.name}</span>
                      {addon.description && <span className="block text-xs leading-normal text-[var(--body)]">{addon.description}</span>}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">+{formatCentsAsCurrency(addon.priceCents)}/{SHORT[addon.cycle]}</span>
                  </label>
                );
              })}
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

function TrialLine({ className }: { className?: string }) {
  const { noPayment, plan, trialEnds } = useChoice();
  return (
    <p className={cn("text-sm leading-normal tracking-[-0.02em]", className)}>
      {noPayment ? "No card needed. Nothing is charged." : plan.trialDays > 0 ? `$0.00 today · ${plan.trialDays}-day trial · first charge ${trialEnds}` : "The first period is charged today."}
    </p>
  );
}

function ContinueButton() {
  const { saving, save } = useChoice();
  return (
    <Button type="button" className="h-11 w-full" disabled={saving} onClick={save}>
      {saving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
      {saving ? "Saving…" : "Continue to payment"}
    </Button>
  );
}

/** The right side: the plan, what it covers module by module, the lines and the total. */
export function PlanChoiceSummary() {
  const { plan, modules, cycle, seats, addonCodes, totalCents } = useChoice();
  const granted = new Set(plan.featureKeys);
  const allFeatures = modules.reduce((sum, module) => sum + module.features.length, 0);
  const included = modules.reduce((sum, module) => sum + module.features.filter((feature) => granted.has(feature.key)).length, 0);
  const picked = addonsFor(plan, cycle).filter((addon) => addonCodes.includes(addon.code));
  const lines = [
    { label: plan.name, value: plan.cents[cycle] == null ? "—" : `${formatCentsAsCurrency(plan.cents[cycle]!)} / ${PER[cycle]}` },
    { label: "Seats", value: plan.audience === "agency" ? `${seats} of ${plan.maxSeats ?? "unlimited"} in this band` : "1 (one-agent plan)" },
    ...picked.map((addon) => ({ label: `${addon.name} add-on`, value: `+${formatCentsAsCurrency(addon.priceCents)} / ${PER[addon.cycle]}` })),
  ];

  return (
    <section aria-label="Your plan summary" className="mx-auto w-full max-w-[500px] rounded-[22px] border border-[var(--nav-line)] bg-black/35 p-6 text-[var(--nav-ink)] shadow-[0_30px_80px_rgba(0,0,0,.45)] backdrop-blur-xl">
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
      <div className="mt-4"><ContinueButton /></div>
    </section>
  );
}
