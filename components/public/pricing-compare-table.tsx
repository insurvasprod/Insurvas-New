"use client";

import { useMemo } from "react";
import { Check, Minus } from "lucide-react";

import { ModuleIcon } from "@/components/public/pricing-motion";
import { Table, TableBody, TableHeader } from "@/components/ui/table";
import { catalogFeatures } from "@/lib/pricing/planFit";
import { featuresByModule, type PublicPlan } from "@/lib/publicPlans/types";

/**
 * Every feature against every plan, grouped by module (redesign A, 2026-10-24). The explorer explains
 * one feature at a time; this answers "which plan has X" in one look. Rows, columns and ticks are the
 * live catalog, so a feature added in the admin catalog appears here without a code change. Wide on a
 * phone, so it scrolls sideways inside its own box with the feature names pinned.
 */
export function PricingCompareTable({ plans }: { plans: PublicPlan[] }) {
  const modules = useMemo(() => featuresByModule([...catalogFeatures(plans).values()]), [plans]);
  const holds = useMemo(() => plans.map((plan) => new Set(plan.features.map((feature) => feature.key))), [plans]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <Table className="min-w-[640px] border-collapse">
        <caption className="sr-only">Features included in each plan</caption>
        <TableHeader>
          <tr className="bg-[var(--surface-alt)]">
            <th scope="col" className="sticky left-0 bg-[var(--surface-alt)] px-5 py-3.5 text-left font-semibold text-foreground">Feature</th>
            {plans.map((plan) => (
              <th key={plan.code} scope="col" className="px-4 py-3.5 text-center font-semibold text-foreground">{plan.name}</th>
            ))}
          </tr>
        </TableHeader>
        <TableBody>
          {modules.map((group) => (
            <ModuleRows key={group.module} group={group} plans={plans} holds={holds} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ModuleRows({ group, plans, holds }: { group: ReturnType<typeof featuresByModule>[number]; plans: PublicPlan[]; holds: Set<string>[] }) {
  return (
    <>
      <tr className="border-t border-border bg-[var(--surface-alt)]">
        <th scope="colgroup" colSpan={plans.length + 1} className="sticky left-0 bg-[var(--surface-alt)] px-5 py-2.5 text-left">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.04em] text-[var(--accent-ink)]">
            <ModuleIcon module={group.module} className="size-3.5" />
            {group.label}
          </span>
        </th>
      </tr>
      {group.features.map((feature) => (
        <tr key={feature.key} className="border-t border-border">
          <th scope="row" className="sticky left-0 bg-card px-5 py-3 text-left font-normal text-[var(--body)]">{feature.label}</th>
          {plans.map((plan, index) => (
            <td key={plan.code} className="px-4 py-3 text-center">
              {holds[index].has(feature.key)
                ? <Check className="mx-auto size-4 stroke-[3] text-[var(--accent-ink)]" aria-label={`Included in ${plan.name}`} />
                : <Minus className="mx-auto size-4 text-muted-foreground" aria-label={`Not in ${plan.name}`} />}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
