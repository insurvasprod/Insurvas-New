"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";

import { Collapse, ModuleIcon } from "@/components/public/pricing-motion";
import { catalogFeatures } from "@/lib/pricing/planFit";
import { featuresByModule, type PublicFeature, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * "What's included, module by module" — replaces the old 30-row compare table (2026-10-13 pricing).
 *
 * The modules, features and which plan holds each are read from the catalog. The one-line
 * descriptions are not in the catalog: they are written here, one per feature key, each checked
 * against the screen that feature unlocks in the agent app. A key with no line here shows its label
 * alone — and features the app does not have a working screen for yet (payment repair, win-back,
 * payout runs, P&L, tax summaries, the litigation packet, the AI assistant) are deliberately left
 * without one, so the page never describes something that is not there.
 */
export const FEATURE_DESCRIPTIONS: Record<string, string> = {
  // Book of business
  book_of_business: "Every policy in your carriers' files plus any you enter by hand, in one list with its premium, money and history.",
  statement_ingestion: "Bring in carrier policy and commission files however they arrive, and match each policy to its client and agent.",
  commission_ledger: "Every commission line, with the policy or statement behind each amount.",
  appointment_vault: "Carrier appointments, licences, E&O cover and continuing education, kept in one place.",
  discrepancy_report: "What each carrier paid against what your contract says it owes, with a dispute letter for each gap.",
  // Acquisition
  inbound_transfers: "See, screen and claim live transfers as they arrive, with waiting calls and team status on one floor view.",
  outbound_dialing: "Work assigned lead lists from a dialer that checks every number against your DNC vendors before it dials.",
  lead_import: "Upload purchased lead lists and map their columns; each list is scrubbed before anyone dials it.",
  duplicate_detection: "Catch household duplicates and existing customers before you pay for the same lead twice.",
  // Sell
  quoting: "Compare carrier premiums side by side and print a plain-language comparison for the client.",
  applications: "Fill carrier applications in the app, from health interview to policy number, and track pending cases to issue.",
  draft_date_optimizer: "Recommends the draft date least likely to bounce, from when the client's income actually arrives.",
  callback_calendar: "Callbacks booked in the customer's own time, with reminders.",
  daily_deal_flow: "Every deal worked today, by partner, with confirmed numbers.",
  carrier_extension: "A browser extension that fills the carrier's online application from yours. It never submits for you.",
  sales_report: "Where cases drop out, how long each step takes, and which carriers decline what.",
  // Retention
  chargeback_radar: "A daily call list of policies at risk of lapsing, from the carriers' own files, with the reason and the commission at stake.",
  // Insight
  true_cpa: "What each lead vendor really costs per issued policy, with evidence-backed return claims for bad leads.",
  cohort_persistency: "Persistency, placement and chargebacks from your carrier files, by carrier, product, agent and lead source.",
  partner_quality: "Compare lead quality and conversion across the partners who send you leads.",
  // Partners
  publisher_records: "Manage the publishers, marketing companies and affiliates who send you leads.",
  partner_portal: "Publishers sign in to their own portal to submit leads and message you, and see only their own records.",
  // Compliance
  tcpa_checker: "Keep the numbers you must never call, and check a number before anyone dials it.",
  consent_locker: "Every consent certificate stored with our own copy, searchable by person when a complaint arrives.",
};

type ModuleView = { module: string; label: string; features: PublicFeature[]; from: string | null };

function PlanChips({ feature, plans }: { feature: PublicFeature; plans: PublicPlan[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {plans.map((plan) => {
        const included = plan.features.some((own) => own.key === feature.key);
        return (
          <span
            key={plan.code}
            className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap ${
              included ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border border-dashed border-border text-muted-foreground"
            }`}
          >
            {included ? <Check aria-hidden="true" className="size-3 stroke-[3]" /> : <Minus aria-hidden="true" className="size-3" />}
            <span className="sr-only">{included ? "Included in" : "Not in"} </span>
            {plan.name}
          </span>
        );
      })}
    </div>
  );
}

function FeatureRows({ view, plans, animate }: { view: ModuleView; plans: PublicPlan[]; animate: boolean }) {
  return (
    <ul className="divide-y divide-border">
      {view.features.map((feature, index) => {
        const description = FEATURE_DESCRIPTIONS[feature.key];
        return (
          <li
            key={feature.key}
            className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 ${animate ? "pz-swap" : ""}`}
            style={animate ? { animationDelay: `${60 + index * 45}ms` } : undefined}
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-[-0.01em] text-foreground">{feature.label}</div>
              {description ? <p className="mt-1 max-w-[520px] text-sm leading-normal tracking-[-0.01em] text-muted-foreground">{description}</p> : null}
            </div>
            <div className="shrink-0 sm:max-w-[48%] sm:pt-0.5">
              <PlanChips feature={feature} plans={plans} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PricingExplorer({ plans }: { plans: PublicPlan[] }) {
  const modules = useMemo<ModuleView[]>(() => {
    const groups = featuresByModule([...catalogFeatures(plans).values()]);
    return groups.map((group) => ({
      ...group,
      // The first plan, in page order, that holds any of the module: "From Basic".
      from: plans.find((plan) => plan.features.some((feature) => feature.module === group.module))?.name ?? null,
    }));
  }, [plans]);
  const [active, setActive] = useState(0);
  const [openMobile, setOpenMobile] = useState<string | null>(modules[0]?.module ?? null);

  if (modules.length === 0) return null;
  const current = modules[Math.min(active, modules.length - 1)];

  return (
    <>
      {/* Desktop: a module list and a detail pane. */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-rest)] lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="border-r border-border bg-[var(--surface-alt)] p-3">
          <div role="tablist" aria-label="Modules" aria-orientation="vertical" className="relative">
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-12 rounded-xl border border-border bg-card shadow-[var(--shadow-rest)] transition-transform duration-500 ease-[var(--e-out)]"
              style={{ transform: `translateY(${active * 52}px)` }}
            />
            {modules.map((view, index) => {
              const selected = index === active;
              return (
                <button
                  key={view.module}
                  type="button"
                  role="tab"
                  id={`module-tab-${view.module}`}
                  aria-selected={selected}
                  aria-controls="module-panel"
                  onClick={() => setActive(index)}
                  className={`relative z-10 mb-1 flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] ${
                    selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-200 ${selected ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "bg-card text-muted-foreground"}`}>
                    <ModuleIcon module={view.module} className="size-4" />
                  </span>
                  <span className="flex-1 truncate text-sm font-semibold tracking-[-0.01em]">{view.label}</span>
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">{view.features.length}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div id="module-panel" role="tabpanel" aria-labelledby={`module-tab-${current.module}`} className="min-h-[420px] p-8">
          <div key={current.module} className="pz-swap">
            <div className="flex items-center gap-3.5">
              <span className="grid size-11 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--accent-ink)]">
                <ModuleIcon module={current.module} className="size-5" />
              </span>
              <div>
                <h3 className="text-title-md font-semibold tracking-[-0.02em] text-foreground">{current.label}</h3>
                <div className="text-sm text-muted-foreground">
                  {current.features.length} feature{current.features.length === 1 ? "" : "s"}
                  {current.from ? ` · from ${current.from}` : ""}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <FeatureRows key={current.module} view={current} plans={plans} animate />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile and tablet: the same modules as an accordion. */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card lg:hidden">
        {modules.map((view, index) => {
          const open = openMobile === view.module;
          return (
            <div key={view.module} className={index ? "border-t border-border" : undefined}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`module-${view.module}`}
                onClick={() => setOpenMobile(open ? null : view.module)}
                className="flex w-full items-center gap-3 px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring-color)] sm:px-5"
              >
                <span className={`grid size-9 shrink-0 place-items-center rounded-lg transition-colors duration-200 ${open ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "bg-[var(--surface-alt)] text-muted-foreground"}`}>
                  <ModuleIcon module={view.module} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{view.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {view.features.length} feature{view.features.length === 1 ? "" : "s"}
                    {view.from ? ` · from ${view.from}` : ""}
                  </span>
                </span>
                <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-[var(--e-out)] ${open ? "rotate-180" : ""}`} />
              </button>
              <Collapse open={open} id={`module-${view.module}`}>
                <div className="px-4 pb-2 sm:px-5">
                  <FeatureRows view={view} plans={plans} animate={false} />
                </div>
              </Collapse>
            </div>
          );
        })}
      </div>
    </>
  );
}
