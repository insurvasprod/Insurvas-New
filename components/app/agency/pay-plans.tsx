"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, control } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { StepSlot } from "@/components/app/step-frame/step-slot";
import { DataToolbar } from "@/components/ui/data-toolbar";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { usDate } from "@/components/app/commissions/team-payouts/shared";
import { bpShare, cardOf, chargebackSummary, MODEL_STARTERS, normalizePlan, PAY_MODEL_CARDS, PAY_MODEL_LABELS, parsePctToBp, pctOf, planProblem, planSummary, type PayModel, type PayPlan } from "@/lib/agency/payPlanCore";
import { dollars, dollarsToCents } from "@/lib/agency/constants";
import { CheckBox } from "@/components/ui/check-box";
import { notify } from "@/lib/notify";
import { PRODUCER_PAYOUTS_SLOT } from "./slots";

type Member = { userId: string; name: string; status: string; plan: (PayPlan & { id: string }) | null; next: (PayPlan & { id: string }) | null };

/**
 * Team payouts › Pay plans (round 7, 6·1, owner 2026-11-10): who is paid how. The whole row opens the plan page
 * (/app/producer-payouts/plans/<person>); no button in the row. "No plan yet" is the tab's count and a chip here.
 */
export function PayPlansTable({ team, pending }: { team: Member[]; pending: boolean }) {
  const router = useRouter();
  const [onlyMissing, setOnlyMissing] = useState(false);
  if (pending) return <TableCard><EmptyState title="Pay plans are not switched on yet" hint="Until then everyone is paid by their contract level, as before." /></TableCard>;
  const missing = team.filter((m) => !m.plan).length;
  const rows = onlyMissing ? team.filter((m) => !m.plan) : team;
  const href = (m: Member) => `/app/producer-payouts/plans/${m.userId}`;
  return (
    <TableCard toolbar={team.length === 0 ? undefined : (
      <DataToolbar>
        <ToggleChip selected={onlyMissing} onClick={() => setOnlyMissing(!onlyMissing)} count={missing} countTone={missing ? "danger" : undefined}>No plan yet</ToggleChip>
      </DataToolbar>
    )}>
      {team.length === 0 ? <EmptyState title="No team members yet" hint="People appear here once they have joined the agency." /> : (
        <Table>
          <TableHeader><TableRow><TableHead className="w-[20%]">Team member</TableHead><TableHead className="w-[14%]">Pay plan</TableHead><TableHead>How they are paid</TableHead><TableHead className="w-[16%]">When a policy cancels</TableHead><TableHead className="w-[12%]">Since</TableHead><TableHead className="w-[16%]">Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.userId} className="cursor-pointer" onClick={() => router.push(href(m))}>
                <TableCell className="whitespace-nowrap font-medium"><Link className="hover:underline" href={href(m)} onClick={(e) => e.stopPropagation()}>{m.name}</Link></TableCell>
                <TableCell className="whitespace-nowrap">{m.plan ? PAY_MODEL_LABELS[m.plan.model] : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{m.plan ? planSummary(m.plan) : "Paid by contract level, as before"}</TableCell>
                <TableCell>{m.plan ? chargebackSummary(m.plan) : "At their level"}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{m.plan ? usDate(m.plan.effectiveFrom) : "—"}</TableCell>
                {/* The row's one chip: no plan, then not active, then a plan that changes later (its detail is on the plan page). */}
                <TableCell>{!m.plan ? <StatusChip tone="warning">No plan yet</StatusChip> : m.status !== "active" ? <StatusChip tone="neutral">{m.status}</StatusChip> : m.next ? <StatusChip tone="neutral">Changes {usDate(m.next.effectiveFrom)}</StatusChip> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}

const money = (cents: number) => { const d = String(Math.abs(cents)).padStart(3, "0"); return `${d.slice(0, -2)}.${d.slice(-2)}`; };

/**
 * The plan form (round 1 board T2): a full page. Pick a model and only its fields show.
 *
 * /ui-taste pass (owner, 2026-11-08): picking a model fills in that model's own starting numbers (Salary + bonus
 * used to inherit Big split's 70%); the cards drop their numbers so the steps are the only numbered thing; and
 * a line under the numbers says the deal back in plain words before it is saved.
 *
 * Second pass (owner 2026-11-08, "I don't see you touched the pay plan edit"): two columns. The form drops its
 * step numbers; a model card shows a radio dot; the panel on the right says what the person gets, line by line,
 * and works one example month into dollars, live as the numbers change.
 */
export function PayPlanForm({ member, readOnly }: { member: Member; readOnly: boolean }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const start = member.plan;
  const [model, setModel] = useState<PayModel>(start?.model ?? "big_split");
  const [base, setBase] = useState(start ? money(start.baseCents) : "0.00");
  const [pct, setPct] = useState(start?.salesPctBp != null ? pctOf(start.salesPctBp).replace(/%$/, "") : "70");
  const [bonus, setBonus] = useState(start ? money(start.appBonusCents) : "0.00");
  const [fee, setFee] = useState(start ? money(start.saveFeeCents) : "20.00");
  const [chargebacks, setChargebacks] = useState(start?.chargebacksApply ?? true);
  const [from, setFrom] = useState(start && start.effectiveFrom >= today ? start.effectiveFrom : today.slice(0, 8) + "01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = cardOf(model);
  // Switching model starts from that model's own numbers; the plan already saved keeps its own when picked again.
  const switchTo = (next: PayModel) => {
    if (next === model) return;
    setModel(next);
    if (next !== "sidekick" && next !== "salary_bonus" && next !== "big_split") return;
    const own = start?.model === next ? start : null;
    const s = MODEL_STARTERS[next];
    setBase(own ? money(own.baseCents) : s.base);
    setPct(own?.salesPctBp != null ? pctOf(own.salesPctBp).replace(/%$/, "") : s.pct);
    setBonus(own ? money(own.appBonusCents) : s.bonus);
    setFee(own ? money(own.saveFeeCents) : s.fee);
    setChargebacks(own ? own.chargebacksApply : true);
  };
  const pickCard = (k: "0" | "1" | "2" | "3") => switchTo(k === "0" ? "contract_level" : k === "1" ? (model === "solo_owner" ? "solo_owner" : "sidekick") : k === "2" ? "salary_bonus" : "big_split");

  const plan: PayPlan = normalizePlan({
    model,
    baseCents: dollarsToCents(base) ?? -1,
    salesPctBp: model === "salary_bonus" || model === "big_split" ? parsePctToBp(pct) : null,
    appBonusCents: dollarsToCents(bonus) ?? -1,
    saveFeeCents: dollarsToCents(fee) ?? -1,
    chargebacksApply: chargebacks,
    effectiveFrom: from,
  });
  const problem = (model === "salary_bonus" || model === "big_split") && parsePctToBp(pct) === null ? "Enter the share as a percent, like 70 or 12.5." : planProblem(plan);

  async function save() {
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/app/agency/pay-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.userId, ...plan }) });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) { setError(json?.error ?? "That didn't save"); return; }
    notify.done(`${member.name}'s pay plan is saved from ${usDate(from)}.`);
    router.push("/app/producer-payouts?tab=plans");
    router.refresh();
  }

  const splitModel = model === "salary_bonus" || model === "big_split";
  // What the plan means, line by line, and one worked month (owner's examples: $2,000 of commission on their
  // own sales, 8 submitted applications, 5 saved deals) so the numbers read as money, not settings.
  const ex = { commission: 200000, apps: 8, saves: 5 };
  const sharePct = parsePctToBp(pct) ?? 0;
  const lines: Array<[string, string]> = model === "contract_level"
    ? [["Commission", "Their contract level against the agency's, as before"], ["When a policy cancels", "Paid back at their level"]]
    : model === "solo_owner"
      ? [["Commission", "Keeps 100%"], ["Payroll", "Not on payroll"]]
      : model === "sidekick"
        ? [["Per saved deal", `$${fee || "0.00"}`], ["Commission", "None"]]
        : model === "salary_bonus"
          ? [["Base pay", `$${base || "0.00"} a month`], ["Share of their sales", `${pct || "0"}%`], ["Bonus per submitted app", `$${bonus || "0.00"}`], ["When a policy cancels", chargebacks ? `Pays back ${pct || "0"}%` : "The agency absorbs it"]]
          : [["Agent's share", `${pct || "0"}%`], ["Agency keeps", pctOf(10000 - sharePct)], ["When a policy cancels", `Pays back ${pct || "0"}%`]];
  const exampleCents = model === "salary_bonus"
    ? (dollarsToCents(base) ?? 0) + bpShare(ex.commission, sharePct) + ex.apps * (dollarsToCents(bonus) ?? 0)
    : model === "big_split" ? bpShare(ex.commission, sharePct) : model === "sidekick" ? ex.saves * (dollarsToCents(fee) ?? 0) : null;
  const example = model === "salary_bonus" ? `$2,000 of commission on their sales and ${ex.apps} submitted applications`
    : model === "big_split" ? "$2,000 of commission on their sales" : model === "sidekick" ? `${ex.saves} saved deals` : null;
  const section = "flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0";
  const heading = "m-0 text-sm font-semibold text-[var(--ink)]";

  return (
    <>
      {!readOnly ? <StepSlot id={PRODUCER_PAYOUTS_SLOT}><Button asChild variant="outline"><Link href="/app/producer-payouts?tab=plans">Discard</Link></Button><Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save plan"}</Button></StepSlot> : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex flex-col gap-5 rounded-xl border border-border bg-[var(--color-card)] p-5">
          <div className={section}>
            <h2 className={heading}>How is {member.name} paid?</h2>
            <div role="radiogroup" aria-label="Pay model" className="grid gap-3 md:grid-cols-2">
              {PAY_MODEL_CARDS.map((c) => {
                const on = card === c.key;
                return (
                  <button key={c.key} type="button" role="radio" aria-checked={on} disabled={readOnly} onClick={() => pickCard(c.key)}
                    className={`flex items-start gap-3 rounded-[10px] border p-3 text-left transition-colors ${on ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-border bg-[var(--color-card)] hover:border-[var(--primary)]"}`}>
                    <span aria-hidden="true" className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2 ${on ? "border-[var(--primary)]" : "border-[var(--border)]"}`}>{on ? <span className="size-2 rounded-full bg-primary" /> : null}</span>
                    <span className="min-w-0"><span className="block text-sm font-semibold text-[var(--ink)]">{c.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{c.hint}</span></span>
                  </button>
                );
              })}
            </div>
          </div>

          {card === "0" ? null : (
            <div className={section}>
              <h2 className={heading}>The numbers</h2>
              {card === "1" ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="This person is" htmlFor="plan-role"><select id="plan-role" className={control} disabled={readOnly} value={model} onChange={(e) => switchTo(e.target.value as PayModel)}><option value="solo_owner">The owner (keeps everything, not on payroll)</option><option value="sidekick">A sidekick (retention)</option></select></Field>
                  {model === "sidekick" ? <Field label="Paid per saved deal ($)" htmlFor="plan-fee" hint="A deal is saved when the client pays again after this person's retention call."><input id="plan-fee" className={control} inputMode="decimal" disabled={readOnly} value={fee} onChange={(e) => setFee(e.target.value)} /></Field> : null}
                </div>
              ) : card === "2" ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Base pay each month ($)" htmlFor="plan-base"><input id="plan-base" className={control} inputMode="decimal" disabled={readOnly} value={base} onChange={(e) => setBase(e.target.value)} /></Field>
                  <Field label="Share of commission on their own sales (%)" htmlFor="plan-pct"><input id="plan-pct" className={control} inputMode="decimal" disabled={readOnly} value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
                  <Field label="Bonus per submitted application ($)" htmlFor="plan-bonus" hint="Once per client, the first time their application is submitted."><input id="plan-bonus" className={control} inputMode="decimal" disabled={readOnly} value={bonus} onChange={(e) => setBonus(e.target.value)} /></Field>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Agent's share (%)" htmlFor="plan-split" hint={parsePctToBp(pct) !== null ? `The agency keeps ${pctOf(10000 - (parsePctToBp(pct) ?? 0))}.` : undefined}><input id="plan-split" className={control} inputMode="decimal" disabled={readOnly} value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
                </div>
              )}
              {splitModel ? (
                model === "salary_bonus" ? (
                  <label className="flex items-start gap-3 text-sm"><CheckBox className="mt-0.5" disabled={readOnly} checked={chargebacks} onChange={(e) => setChargebacks(e.target.checked)} /><span><span className="font-medium">{member.name} pays back their share when a policy cancels</span><span className="block text-xs text-muted-foreground">Off: the agency absorbs it. Base pay and bonuses are never taken back.</span></span></label>
                ) : <p className="m-0 text-sm text-muted-foreground">When a policy cancels, they pay back their share of what the carrier takes back.</p>
              ) : null}
            </div>
          )}

          <div className={section}>
            <h2 className={heading}>Starts on</h2>
            <div className="grid gap-3 md:grid-cols-3"><Field label="From" htmlFor="plan-from" hint="Months already paid keep the plan they were paid on."><input id="plan-from" type="date" className={control} disabled={readOnly} value={from} onChange={(e) => setFrom(e.target.value)} /></Field></div>
          </div>
          {error ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p> : null}
        </section>

        <aside aria-label="What this plan means" className="flex flex-col gap-4 rounded-xl border border-border bg-[var(--color-card)] p-5 xl:sticky xl:top-4">
          <div>
            <p className="m-0 text-xs text-muted-foreground">What {member.name} gets</p>
            <p className="m-0 mt-1 text-base font-semibold text-[var(--ink)]">{PAY_MODEL_LABELS[model]}</p>
          </div>
          <dl className="m-0 grid gap-2 text-sm">
            {lines.map(([k, v]) => <div key={k} className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="m-0 text-right font-medium tabular-nums">{v}</dd></div>)}
            <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">Starts</dt><dd className="m-0 font-medium tabular-nums">{usDate(from)}</dd></div>
          </dl>
          {exampleCents !== null && example ? (
            <div className="border-t border-border pt-4">
              <p className="m-0 text-xs text-muted-foreground">For example, a month with {example}</p>
              <p className="m-0 mt-1 text-2xl font-semibold tabular-nums text-[var(--ink)]">{problem ? "—" : dollars(exampleCents)}</p>
            </div>
          ) : null}
          {problem ? <p className="m-0 text-sm text-[var(--error-ink)]">{problem}</p> : null}
        </aside>
      </div>
    </>
  );
}
