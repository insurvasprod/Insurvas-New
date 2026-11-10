"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Segmented } from "@/components/ui/view-tabs";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MoreMenu } from "@/components/ui/more-menu";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { CheckBox } from "@/components/ui/check-box";
import { dollars } from "@/lib/agency/constants";
import { defaultChoice, draftPay, monthLabel, monthRange, PAY_METHODS, PAY_MODEL_LABELS, parsePctToBp, pctOf, previousMonth, type PayModel, type RunMode } from "@/lib/agency/payPlanCore";
import { Money } from "./money";
import { sendJson, useAgencyData } from "./use-agency-data";

type Preview = {
  producerUserId: string; displayName: string; status: string; balanceBeforeCents: number; earnedCents: number; chargebackCents: number; periodCents: number;
  balanceCents: number; negativePolicies: Array<{ policy_number: string; amount_cents: number; occurred_on: string }>; alreadyRun: boolean;
  planModel: string | null; salaryCents: number; bonusCents: number; saveFeeCents: number; absorbedCount: number;
};
type Run = { id: string; producerUserId: string; periodStart: string; periodEnd: string; status: string; netCents: number; withheldCents: number; balanceAfterCents: number; decisionMode: string | null; paidOn: string | null; paidMethod: string | null; paymentReference: string | null };
type Rules = { negativePolicy: string; recoveryPctBp: number };
type Row = { include: boolean; mode: RunMode; pct: string; method: string; reference: string; paidOn: string };
type Step = "pick" | "draft" | "confirm";
type RunFilter = "all" | "paid" | "owes" | "nothing" | "void";

const DECISION_LABEL: Record<string, string> = { withhold: "Took it all back", recover: "Took back a share", forgive: "Let it go", amount: "Stated amount", pay_full: "Paid in full" };
const voided = (r: Run) => r.status === "void" || r.status === "voided";
const below = (p: Preview) => p.balanceBeforeCents < 0 || p.balanceCents < 0;
const today = () => new Date().toISOString().slice(0, 10);

function recentMonths(count = 12): string[] {
  const out: string[] = [];
  let m = today().slice(0, 7);
  for (let i = 0; i < count; i++) { out.push(m); m = previousMonth(`${m}-01`); }
  return out;
}

/**
 * Team payouts, Accounting › Producer payouts (owner's Accounting doc "Team Payouts", round 1 boards T3–T6,
 * 2026-11-07). Run payroll is three steps on one page:
 *   1 Month & team — pick the month (a run covers a whole month) and who is paid; a month already paid is shown.
 *   2 Draft — nothing is saved. Base pay, commission share, bonuses and fees, chargebacks and what was owed from
 *     before, per person. Anyone below zero gets the owner's choice: Carry it, Take N% this month, Let it go.
 *   3 Confirm — how each person was paid (Bank transfer, Zelle, Check…), then Confirm marks the month PAID, gives
 *     each person a private statement and books the payroll. A month cannot be paid twice; void a run to fix it.
 * Runs lists what was paid; a row opens its statement. Void a run and Write off stay in each row's More.
 *
 * /ui-taste pass (owner, 2026-11-08): the three steps are a progress bar (done steps checked, the current one
 * filled) with one line under it saying what to do now, and Back / Next sit right beside it. The month picker is
 * next to Refresh; the toolbar's left says how many people are chosen and what that pays. "Below zero" became
 * "Owes from before", and the choice reads Take it all back first / Take back a share / Let it go.
 */
export function PayoutsBoard({ tab, canCommit, moneyActions = false }: { tab: "run" | "runs"; canCommit: boolean; moneyActions?: boolean }) {
  const router = useRouter();
  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState(() => previousMonth(today()));
  const period = monthRange(month);
  const { data, error, loading, refreshing, reload } = useAgencyData<{ preview: Preview[]; runs: Run[]; rules?: Rules }>(`/api/app/agency/payouts?from=${period.from}&to=${period.to}`);
  const [step, setStep] = useState<Step>("pick");
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<null | { kind: "void"; run: Run } | { kind: "write_off"; producer: Preview }>(null);
  const [reason, setReason] = useState("");
  const rules: Rules = data?.rules ?? { negativePolicy: "carry_forward", recoveryPctBp: 2000 };

  useEffect(() => {
    if (!data) return;
    const choice = defaultChoice(data.rules?.negativePolicy);
    const pct = pctOf(data.rules?.recoveryPctBp ?? 2000).replace(/%$/, "");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the choices reset each time a month's preview arrives
    setRows(Object.fromEntries(data.preview.map((p) => [p.producerUserId, {
      include: !p.alreadyRun && (p.periodCents !== 0 || p.balanceCents !== 0),
      mode: below(p) ? choice : "pay_full", pct, method: "Bank transfer", reference: "", paidOn: today(),
    }])));
  }, [data]);

  const preview = useMemo(() => data?.preview ?? [], [data]);
  const names = useMemo(() => new Map(preview.map((p) => [p.producerUserId, p.displayName])), [preview]);
  const [runPage, setRunPage] = useState(1);
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  const [runSearch, setRunSearch] = useState("");
  const [runMonth, setRunMonth] = useState("all");
  const runPageSize = useFittingPageSize(320, 45);
  const chosen = preview.filter((p) => rows[p.producerUserId]?.include && !p.alreadyRun);
  const pctBp = (r: Row) => parsePctToBp(r.pct) ?? rules.recoveryPctBp;
  const payOf = (p: Preview) => {
    const r = rows[p.producerUserId];
    return draftPay({ beforeCents: p.balanceBeforeCents, periodCents: p.periodCents }, r?.mode ?? "pay_full", r ? pctBp(r) : rules.recoveryPctBp);
  };
  const totals = chosen.reduce((t, p) => {
    const d = payOf(p);
    return { pay: t.pay + d.payCents, salary: t.salary + p.salaryCents, shares: t.shares + p.earnedCents + p.bonusCents + p.saveFeeCents, back: t.back - p.chargebackCents + d.takenCents + Math.max(Math.max(p.periodCents, 0) - d.payCents - d.takenCents, 0) };
  }, { pay: 0, salary: 0, shares: 0, back: 0 });
  const set = (id: string, patch: Partial<Row>) => setRows((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const paid = chosen.filter((p) => payOf(p).payCents > 0);

  async function correct() {
    if (!fix || !reason.trim()) return;
    setBusy(true);
    setProblem(null);
    const { error: message } = fix.kind === "void"
      ? await sendJson(`/api/app/accounting/producer-runs/${fix.run.id}`, "POST", { action: "void", reason: reason.trim() })
      : await sendJson("/api/app/accounting/producers", "POST", { op: "write_off", producer_user_id: fix.producer.producerUserId, reason: reason.trim() });
    setBusy(false);
    if (message) { setProblem(message); return; }
    notify.done(fix.kind === "void" ? "The run is void. Its amount is back on their balance." : `${fix.producer.displayName}'s negative balance is written off. The agency carries it.`);
    setFix(null);
    setReason("");
    reload();
  }

  async function confirm() {
    setProblem(null);
    setBusy(true);
    const first = paid[0] ? rows[paid[0].producerUserId] : null;
    const { error: message } = await sendJson("/api/app/agency/payouts", "POST", {
      from: period.from, to: period.to, paidOn: first?.paidOn ?? today(), method: first?.method ?? "Bank transfer", reference: null,
      decisions: chosen.map((p) => {
        const r = rows[p.producerUserId];
        const mode = below(p) ? r.mode : "pay_full";
        return {
          producerUserId: p.producerUserId, mode, pctBp: mode === "recover" ? pctBp(r) : null,
          reason: mode === "withhold" ? "Carried: owed from before comes off first" : mode === "recover" ? `Took ${pctOf(pctBp(r))} of what was owed` : mode === "forgive" ? "Let it go" : null,
          method: r.method, reference: r.reference || null, paidOn: r.paidOn,
        };
      }),
    });
    setBusy(false);
    if (message) { setProblem(message); return; }
    notify.done(`${monthLabel(month)} is paid: ${chosen.length} ${chosen.length === 1 ? "person" : "people"}, ${dollars(totals.pay)}. Each has a private statement.`);
    setStep("pick");
    router.push("/app/producer-payouts?tab=runs");
    reload();
  }

  const correction = (
    <ConfirmDialog
      open={fix !== null}
      onOpenChange={(open) => { if (!open) setFix(null); }}
      title={fix?.kind === "void" ? `Void ${names.get(fix.run.producerUserId) ?? "this"}'s run for ${fix.run.periodStart} to ${fix.run.periodEnd}?` : fix?.kind === "write_off" ? `Write off ${fix.producer.displayName}'s balance of ${dollars(fix.producer.balanceCents)}?` : ""}
      description={fix?.kind === "void" ? "Use this when the month was paid wrong. The pay goes back on their balance, their statement shows the run as void, and you can run the month again. It cannot be undone." : "Use this when you will never get the money back. Their balance goes to zero and the agency carries the loss. It cannot be undone."}
      confirmLabel={busy ? "Saving…" : fix?.kind === "void" ? "Void this run" : "Write it off"}
      busy={busy}
      confirmDisabled={!reason.trim()}
      onConfirm={() => void correct()}
      fields={
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1 font-medium">Why? (kept on the record)<input className={toolbarControl} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={fix?.kind === "void" ? "e.g. Paid the wrong month" : "e.g. Left the agency, not recoverable"} /></label>
          {problem && <p role="alert" className="text-[var(--error-ink)]">{problem}</p>}
        </div>
      }
    />
  );

  if (error) return <TableCard><ErrorState detail={error} /></TableCard>;
  if (loading || !data) return <TableCard><SectionLoading rows={5} columns={7} label="Loading the month" /></TableCard>;

  if (tab === "runs") {
    // One row per person per month, like Bank deposits' results: a status chip says where each one stands,
    // chips filter by it, the month sits by Refresh, and the row opens the private statement.
    const runState = (r: Run): RunFilter => (voided(r) ? "void" : r.balanceAfterCents < 0 ? "owes" : r.paidOn ? "paid" : "nothing");
    const runMonths = [...new Set(data.runs.map((r) => r.periodStart.slice(0, 7)))].sort().reverse();
    const needle = runSearch.trim().toLowerCase();
    const visibleRuns = data.runs
      .filter((r) => runMonth === "all" || r.periodStart.slice(0, 7) === runMonth)
      .filter((r) => runFilter === "all" || runState(r) === runFilter)
      .filter((r) => !needle || (names.get(r.producerUserId) ?? "").toLowerCase().includes(needle));
    const shownRuns = paginate(visibleRuns, runPage, runPageSize);
    const count = (f: RunFilter) => data.runs.filter((r) => (runMonth === "all" || r.periodStart.slice(0, 7) === runMonth) && runState(r) === f).length;
    const pickRuns = (f: RunFilter) => { setRunFilter(f); setRunPage(1); };
    const when = (r: Run) => (r.periodStart.slice(0, 7) === r.periodEnd.slice(0, 7) && r.periodStart.endsWith("-01") ? monthLabel(r.periodStart.slice(0, 7)) : `${r.periodStart} – ${r.periodEnd}`);
    const how = (r: Run) => [r.paidMethod === "ach" ? "Bank transfer" : r.paidMethod, r.paymentReference].filter(Boolean).join(" · ");
    return (
      <>
        <TableCard
          toolbar={data.runs.length === 0 ? undefined : (
            <DataToolbar actions={<>
              <select aria-label="Month" className={toolbarControl} value={runMonth} onChange={(e) => { setRunMonth(e.target.value); setRunPage(1); }}>
                <option value="all">All months</option>
                {runMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
              <RefreshButton onClick={reload} refreshing={refreshing} />
            </>}>
              <ToolbarSearch value={runSearch} onChange={(v) => { setRunSearch(v); setRunPage(1); }} placeholder="Search team member" />
              <Segmented label="Run status" value={runFilter} onChange={pickRuns} options={[
                { key: "all", label: "All" },
                { key: "paid", label: "Paid", count: count("paid") || null },
                { key: "owes", label: "Still owes", count: count("owes") || null, tone: "danger" },
                { key: "nothing", label: "Nothing to pay", count: count("nothing") || null },
                { key: "void", label: "Void", count: count("void") || null },
              ]} />
            </DataToolbar>
          )}
          footer={visibleRuns.length > runPageSize ? <Pager page={shownRuns.current} total={visibleRuns.length} noun="runs" pageSize={runPageSize} onPage={setRunPage} /> : undefined}
        >
          {data.runs.length === 0 ? <EmptyState title="No payroll run yet" hint="Each month you confirm appears here, one row per person, with their private statement." action={canCommit ? <Button asChild><Link href="/app/producer-payouts">Run payroll</Link></Button> : undefined} />
            : visibleRuns.length === 0 ? <NoMatches noun="runs" onClear={() => { setRunSearch(""); setRunMonth("all"); pickRuns("all"); }} /> : (
            <Table>
              <TableHeader><TableRow><TableHead className="w-[24%]">Team member</TableHead><TableHead className="w-[16%]">Month</TableHead><TableHead className="w-[14%] text-right">Paid</TableHead><TableHead className="w-[22%]">How</TableHead><TableHead>Status</TableHead><TableHead className="w-12"><span className="sr-only">More</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {shownRuns.rows.map((r) => {
                  const state = runState(r);
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/app/producer-statements/${r.id}`)}>
                      <TableCell><Link className="font-medium hover:underline" href={`/app/producer-statements/${r.id}`} onClick={(e) => e.stopPropagation()}>{names.get(r.producerUserId) ?? "Team member"}</Link>{r.decisionMode && r.decisionMode !== "pay_full" ? <div className="text-xs text-muted-foreground">{DECISION_LABEL[r.decisionMode] ?? ""}</div> : null}</TableCell>
                      <TableCell className="tabular-nums">{when(r)}</TableCell>
                      <TableCell className="text-right"><Money cents={r.netCents} /></TableCell>
                      <TableCell>{r.paidOn && !voided(r) ? <>{how(r) || "Paid"}<div className="text-xs text-muted-foreground tabular-nums">{r.paidOn}</div></> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{state === "void" ? <StatusChip tone="neutral">Void</StatusChip> : state === "owes" ? <StatusChip tone="danger">Still owes {dollars(-r.balanceAfterCents)}</StatusChip> : state === "paid" ? <StatusChip tone="good">Paid</StatusChip> : <StatusChip tone="neutral">Nothing to pay</StatusChip>}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>{moneyActions && !voided(r) ? <MoreMenu row label={`More for ${names.get(r.producerUserId) ?? "this run"}`} items={[{ label: "Open the statement", href: `/app/producer-statements/${r.id}` }, { label: "Void this run", onSelect: () => { setReason(""); setProblem(null); setFix({ kind: "void", run: r }); } }]} /> : null}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TableCard>
        {correction}
      </>
    );
  }

  const model = (p: Preview) => (p.planModel ? PAY_MODEL_LABELS[p.planModel as PayModel] ?? p.planModel : "Contract level");
  const payable = preview.filter((p) => !p.alreadyRun);
  const allChosen = payable.length > 0 && chosen.length === payable.length;
  const owesBefore = (p: Preview) => (p.balanceBeforeCents < 0 ? -p.balanceBeforeCents : 0);
  const progress = (
    <ProgressSteps
      label="Run payroll"
      current={step}
      onSelect={(s) => setStep(s)}
      steps={[{ key: "pick", label: "Choose month & people" }, { key: "draft", label: "Check the draft" }, { key: "confirm", label: "Record how you paid" }]}
    />
  );
  // Back and Next sit with the steps, so the next move is always where the eye already is.
  const nav = canCommit ? (
    <div className="flex shrink-0 items-center gap-2">
      {step !== "pick" ? <Button variant="outline" onClick={() => setStep(step === "confirm" ? "draft" : "pick")} disabled={busy}>Back</Button> : null}
      {step === "pick" ? <Button onClick={() => setStep("draft")} disabled={!chosen.length}>Next: check the draft</Button>
        : step === "draft" ? <Button onClick={() => setStep("confirm")} disabled={!chosen.length}>Next: record how you paid</Button>
        : <Button onClick={() => void confirm()} disabled={busy || !chosen.length}>{busy ? "Saving…" : "Confirm and mark paid"}</Button>}
    </div>
  ) : null;
  const toolbar = (
    <DataToolbar actions={<>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">Month<select aria-label="Month" className={toolbarControl} value={month} onChange={(e) => { setMonth(e.target.value); setStep("pick"); }}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
      <RefreshButton onClick={reload} refreshing={refreshing} />
    </>}>
      <span className="text-sm">
        <span className="font-semibold tabular-nums">{chosen.length}</span> of {payable.length} {payable.length === 1 ? "person" : "people"} chosen
        {chosen.length ? <> · <span className="font-semibold tabular-nums">{dollars(totals.pay)}</span> to pay</> : null}
        {step !== "pick" && totals.back ? <> · <span className="font-semibold tabular-nums text-[var(--error-ink)]">{dollars(totals.back)}</span> taken back</> : null}
      </span>
    </DataToolbar>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">{progress}{nav}</div>

      {step === "pick" ? (
        <TableCard toolbar={toolbar}>
          {preview.length === 0 ? <EmptyState title="No one to pay" hint="Team members appear here once they have joined the agency." /> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-20"><label className="inline-flex items-center gap-2"><CheckBox aria-label="Pay everyone" checked={allChosen} mixed={!allChosen && chosen.length > 0} disabled={!canCommit || !payable.length} onChange={(e) => setRows((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v, include: e.target.checked && !preview.find((p) => p.producerUserId === k)?.alreadyRun }])))} />Pay</label></TableHead>
                <TableHead className="w-[22%]">Team member</TableHead><TableHead className="w-[18%]">Pay plan</TableHead><TableHead className="w-[18%] text-right">Earned in {monthLabel(month)}</TableHead><TableHead className="w-[18%] text-right">Owes from before</TableHead><TableHead className="text-right">Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {preview.map((p) => (
                  <TableRow key={p.producerUserId} className={p.alreadyRun ? "opacity-70" : undefined}>
                    <TableCell><CheckBox aria-label={`Pay ${p.displayName}`} checked={rows[p.producerUserId]?.include ?? false} disabled={p.alreadyRun || !canCommit} onChange={(e) => set(p.producerUserId, { include: e.target.checked })} /></TableCell>
                    <TableCell className="font-medium">{p.displayName}{p.status !== "active" && <StatusChip tone="neutral" className="ml-2">{p.status}</StatusChip>}</TableCell>
                    <TableCell>{p.planModel === "solo_owner" ? <span className="text-muted-foreground">{model(p)} · not on payroll</span> : model(p)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.periodCents === 0 ? <span className="text-muted-foreground">—</span> : dollars(p.periodCents)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${owesBefore(p) ? "text-[var(--error-ink)]" : ""}`}>{owesBefore(p) ? dollars(owesBefore(p)) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">{p.alreadyRun ? <StatusChip tone="good">Already paid</StatusChip> : p.periodCents === 0 && p.balanceCents === 0 ? <span className="text-muted-foreground">Nothing to pay</span> : rows[p.producerUserId]?.include ? <StatusChip tone="info">Will be paid</StatusChip> : <span className="text-muted-foreground">Not this time</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TableCard>
      ) : (
        <>
          {step === "draft" ? (
            <TableCard toolbar={toolbar}>
              <Table>
                <TableHeader><TableRow><TableHead className="w-[22%]">Team member</TableHead><TableHead className="w-[18%] text-right">Earned this month</TableHead><TableHead className="w-[14%] text-right">Owes from before</TableHead><TableHead>What to do with what they owe</TableHead><TableHead className="w-[12%] text-right">Pay</TableHead></TableRow></TableHeader>
                <TableBody>
                  {chosen.map((p) => {
                    const r = rows[p.producerUserId];
                    const d = payOf(p);
                    // The month in one figure, with what made it up underneath.
                    const parts = [
                      p.salaryCents ? `${dollars(p.salaryCents)} base` : null,
                      p.earnedCents ? `${dollars(p.earnedCents)} commission` : null,
                      p.bonusCents + p.saveFeeCents ? `${dollars(p.bonusCents + p.saveFeeCents)} bonuses` : null,
                      p.chargebackCents ? `${dollars(p.chargebackCents)} chargebacks` : null,
                    ].filter(Boolean).join(" · ");
                    const mode = r.mode === "pay_full" ? "withhold" : r.mode;
                    return (
                      <TableRow key={p.producerUserId}>
                        <TableCell><div className="font-medium">{p.displayName}</div><div className="text-xs text-muted-foreground">{model(p)}</div></TableCell>
                        <TableCell className="text-right"><div className="font-medium tabular-nums">{dollars(p.periodCents)}</div>{parts ? <div className="text-xs text-muted-foreground">{parts}</div> : null}{p.absorbedCount ? <div className="text-xs text-muted-foreground">{p.absorbedCount} chargeback{p.absorbedCount === 1 ? "" : "s"} absorbed by the agency</div> : null}</TableCell>
                        <TableCell className={`text-right tabular-nums ${owesBefore(p) ? "text-[var(--error-ink)]" : ""}`}>{owesBefore(p) ? dollars(owesBefore(p)) : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>
                          {below(p) ? (
                            <div className="flex flex-col gap-1.5">
                              <span className="inline-flex flex-nowrap items-center gap-2">
                                <span role="radiogroup" aria-label={`What to do with what ${p.displayName} owes`} className="inline-flex h-8 items-center rounded-lg border border-border bg-[var(--surface-alt)] p-0.5">
                                  {([["withhold", "Take it all back"], ["recover", "Take a share"], ["forgive", "Let it go"]] as const).map(([k, l]) => (
                                    <button key={k} type="button" role="radio" aria-checked={mode === k} disabled={!canCommit} onClick={() => set(p.producerUserId, { mode: k })}
                                      className={`h-7 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
                                  ))}
                                </span>
                                {mode === "recover" ? <label className="inline-flex items-center gap-1 text-sm"><input aria-label="Share to take back" inputMode="decimal" className={`${toolbarControl} w-16`} value={r.pct} onChange={(e) => set(p.producerUserId, { pct: e.target.value })} />%</label> : null}
                                {moneyActions && <MoreMenu row label={`More for ${p.displayName}`} items={[{ label: "Write off everything they owe", onSelect: () => { setReason(""); setProblem(null); setFix({ kind: "write_off", producer: p }); } }]} />}
                              </span>
                              <span className="text-xs text-muted-foreground">{d.takenCents ? `${dollars(d.takenCents)} taken back. ` : ""}{d.afterCents < 0 ? `Still owes ${dollars(-d.afterCents)} after this.` : d.forgivenCents ? `${dollars(d.forgivenCents)} let go.` : "Owes nothing after this."}</span>
                            </div>
                          ) : <span className="text-muted-foreground">Owes nothing</span>}
                        </TableCell>
                        <TableCell className="text-right font-semibold"><Money cents={d.payCents} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableCard>
          ) : (
            <TableCard toolbar={toolbar}>
              <Table>
                <TableHeader><TableRow><TableHead>Team member</TableHead><TableHead className="text-right">Pay</TableHead><TableHead>How did you pay them?</TableHead><TableHead>Reference</TableHead><TableHead>Paid on</TableHead></TableRow></TableHeader>
                <TableBody>
                  {chosen.map((p) => {
                    const r = rows[p.producerUserId];
                    const pay = payOf(p).payCents;
                    return (
                      <TableRow key={p.producerUserId}>
                        <TableCell className="font-medium">{p.displayName}</TableCell>
                        <TableCell className="text-right"><Money cents={pay} /></TableCell>
                        {pay > 0 ? (
                          <>
                            <TableCell><select aria-label={`How ${p.displayName} was paid`} className={toolbarControl} value={r.method} onChange={(e) => set(p.producerUserId, { method: e.target.value })}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></TableCell>
                            <TableCell><input aria-label={`Reference for ${p.displayName}`} className={toolbarControl} placeholder={r.method === "Check" ? "Check number" : r.method === "Zelle" ? "Zelle confirmation" : "Optional"} value={r.reference} maxLength={120} onChange={(e) => set(p.producerUserId, { reference: e.target.value })} /></TableCell>
                            <TableCell><input type="date" aria-label={`Date ${p.displayName} was paid`} className={toolbarControl} value={r.paidOn} onChange={(e) => set(p.producerUserId, { paidOn: e.target.value })} /></TableCell>
                          </>
                        ) : <TableCell colSpan={3} className="text-muted-foreground">Nothing to pay this month. The month still closes for them.</TableCell>}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {problem && <p role="alert" className="px-4 pb-3 text-sm text-[var(--error-ink)]">{problem}</p>}
            </TableCard>
          )}
        </>
      )}
      {correction}
    </>
  );
}
