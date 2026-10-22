"use client";

/**
 * /app/draft-dates — the optimiser on its own (LA-3.9; board l3-draft-dates), for a call that has
 * not reached an application yet. Pure calculation with the tenant's buffer: nothing here is saved.
 * The recommendation, the alternates and the sentence to read aloud come from the same hook and
 * parts as the Payment step's draft-date card.
 */

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { PagedTableCard } from "@/components/ui/paged";
import { Field, control } from "@/components/app/settings/primitives";
import { INCOME_TYPE_LABEL } from "@/lib/applications/constants";

import { ordinal } from "@/components/app/applications/parts";
import { StepCard } from "@/components/app/applications/workspace/step-card";
import { ArrivalTable, IncomeFields, ReadAloud, readAloudFor, scheduleShort, useDraftDate, whyText } from "./draft-date-panel";
import { useDraftBuffer } from "./use-draft-buffer";

/** How each benefit pays — the schedules `recommendDraftDay` implements, in the words the agent uses. */
const HOW_EACH_PAYS: { label: string; value: string }[] = [
  { label: INCOME_TYPE_LABEL.ssa, value: "2nd, 3rd or 4th Wednesday, by birth day" },
  { label: "Social Security since before May 1997", value: "3rd of the month" },
  { label: INCOME_TYPE_LABEL.ssi, value: "1st of the month" },
  { label: INCOME_TYPE_LABEL.ssa_ssi, value: "1st (SSI) and 3rd (Social Security)" },
  { label: INCOME_TYPE_LABEL.va, value: "1st of the month" },
  { label: INCOME_TYPE_LABEL.pension, value: "Set by the plan" },
  { label: INCOME_TYPE_LABEL.payroll, value: "Whatever the employer runs" },
  { label: "Any of them", value: "A weekend or holiday pays the business day before" },
];

function firstOfNextMonth() {
  const d = new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 10);
}

export function DraftDateCalculator() {
  const [dob, setDob] = useState("");
  const [anchor, setAnchor] = useState(firstOfNextMonth);
  const buffer = useDraftBuffer();
  // The optimiser drafts from the month after `from`; the anchor names the first drafted month.
  const from = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(anchor);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 2, 1)) : undefined;
  }, [anchor]);
  const m = useDraftDate({ initial: {}, dob: dob || null, buffer, from });
  const { rec, recommended, options, shown } = m;
  const aloud = readAloudFor(m, shown);
  const others = options.filter((o) => o.day !== shown);
  const allLater = others.length > 0 && recommended !== null && others.every((o) => o.day > recommended);
  const why = whyText(m, "they");
  const schedule = scheduleShort(m.input);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title="Draft-date calculator" description="The safest day to draft the premium." />

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <StepCard title="Income and draft day" className="w-full min-w-0 flex-1" bodyClassName="gap-0 p-0">
          <div className="grid gap-4 px-5 py-[18px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)_minmax(0,1.05fr)]">
            <Field label="Date of birth" htmlFor="dd.dob" hint="Its day sets the pay cycle">
              <input id="dd.dob" type="date" className={control} value={dob} onChange={(e) => setDob(e.target.value)} />
            </Field>
            <IncomeFields m={m} dob={dob || null} readOnly={false} idPrefix="dd" className="sm:grid-cols-2" />
            <Field label="Anchor date" htmlFor="dd.anchor" hint="First month the policy can draft">
              <input id="dd.anchor" type="date" className={control} value={anchor} onChange={(e) => setAnchor(e.target.value || firstOfNextMonth())} />
            </Field>
          </div>

          <div className="px-5 pb-5">
            {!rec ? (
              <p className="text-sm text-[var(--muted)]">Pick an income type to see the draft day.</p>
            ) : rec.kind === "not_applicable" ? (
              <p className="text-sm text-[var(--muted)]">{rec.why}</p>
            ) : (
              <div className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--primary-soft)] p-4">
                {/* The figure in the system's StatTile type (2026-10-06 redesign: no off-scale 32px). */}
                {/* The why sits behind a tip beside the figure (2026-10-09 copy pass). */}
                <div className="flex items-start gap-1">
                  <StatTile
                    className="border-0 bg-transparent p-0 shadow-none"
                    label={shown === recommended ? (rec.kind === "neutral" ? "Best guess" : "Recommended draft day") : "Draft day"}
                    value={shown === null ? "—" : ordinal(shown)}
                  />
                  {why && <InfoTip label="Why this day" side="right">{why}</InfoTip>}
                </div>
                {aloud && <ReadAloud title="Read this back to them, word for word" text={aloud} />}
                {others.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-[var(--muted)]">{shown !== recommended ? "Or go back to the recommendation" : allLater ? "If they would rather have it later" : "If they would rather have another day"}</span>
                    {others.map((o) => (
                      <div key={o.day} className="flex max-w-[240px] flex-col gap-1">
                        <Button type="button" variant="outline" onClick={() => m.apply({ draftDay: o.day })}>Use the {ordinal(o.day)}</Button>
                        {o.reason && <span className="text-xs text-[var(--muted)]">{o.reason}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reference, not the answer: folded until it is wanted (2026-10-06 redesign). */}
          <details className="group border-t border-[var(--border)] px-5 py-3">
            <summary className="flex h-9 cursor-pointer list-none items-center gap-2 text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)] outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
              How each income type pays
            </summary>
            <dl className="grid gap-x-6 gap-y-4 pt-2 pb-2 sm:grid-cols-2">
              {HOW_EACH_PAYS.map((row) => (
                <div key={row.label} className="min-w-0">
                  <dt className="text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">{row.label}</dt>
                  <dd className="text-sm font-semibold text-[var(--ink)]">{row.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </StepCard>

        <PagedTableCard
          total={m.rec?.kind === "recommended" ? m.rec.arrivals.length : 0}
          noun="months"
          title="Twelve months ahead"
          action={schedule && rec?.kind === "recommended" ? <StatusChip tone="info" dot={false}>{schedule}</StatusChip> : undefined}
          className="w-full shrink-0 xl:w-[462px]"
        >
          {rec?.kind === "recommended" ? (
            <ArrivalTable m={m} day={shown} />
          ) : (
            <EmptyState title="No schedule yet" hint="Pick an income type to see the next twelve deposits." />
          )}
        </PagedTableCard>
      </div>
    </div>
  );
}
