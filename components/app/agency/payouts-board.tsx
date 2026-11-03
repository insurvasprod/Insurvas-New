"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MoreMenu } from "@/components/ui/more-menu";
import { StepSlot } from "@/components/app/step-frame/step-slot";
import { dollars, dollarsToCents } from "@/lib/agency/constants";
import { BasisChip, Money } from "./money";
import { PRODUCER_PAYOUTS_SLOT } from "./slots";
import { sendJson, useAgencyData } from "./use-agency-data";

type Preview = {
  producerUserId: string; displayName: string; status: string; balanceBeforeCents: number; earnedCents: number; chargebackCents: number; periodCents: number;
  balanceCents: number; recommendedMode: "pay_full" | "withhold"; recommendedPayCents: number; recommendedWithholdCents: number;
  negativePolicies: Array<{ policy_number: string; amount_cents: number; occurred_on: string }>; alreadyRun: boolean;
};
type Run = { id: string; producerUserId: string; periodStart: string; periodEnd: string; status: string; netCents: number; withheldCents: number; decisionMode: string | null; paidOn: string | null; paidMethod: string | null };
type Decision = { include: boolean; mode: "pay_full" | "withhold" | "amount"; amount: string; reason: string };

function lastMonth() {
  const now = new Date();
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10),
  };
}

const payFor = (p: Preview, d: Decision) => {
  if (d.mode === "pay_full") return Math.max(p.periodCents, 0);
  if (d.mode === "withhold") return Math.max(p.balanceCents, 0);
  return dollarsToCents(d.amount) ?? 0;
};

const DECISION_LABEL: Record<string, string> = { withhold: "Withheld", amount: "Stated amount", pay_full: "In full" };
const voided = (r: Run) => r.status === "void" || r.status === "voided";

/**
 * AG-1.7 · the payout run, Accounting › Producer payouts (moved from Team 2026-11-03). Two tabs on the title line:
 * New run and Runs. The preview writes NOTHING. Producers with a negative balance come first, with the policies
 * behind it and a recommended withhold, so the owner decides before he pays — pay in full, withhold against the
 * balance, or pay a stated amount — and that decision is recorded with the run and printed on the statement.
 * Commit (on the title line) asks for the date, method and reference, and pays once per producer and period, on
 * the reported basis. No ACH: it records how you paid. A run's row opens its statement.
 *
 * One producer-pay system (owner 2026-11-03, with the Accounting pass): LA-7.5's two corrections live here too, on
 * its own routes and the same ledger — Void a published or paid run (Runs, the row's More) and Write off a negative
 * balance (New run, the row's More). Both ask once, with the reason the ledger keeps. `moneyActions`: the plan has
 * Profit & loss and this person keeps the books (those routes' gate).
 */
export function PayoutsBoard({ tab, canCommit, moneyActions = false }: { tab: "run" | "runs"; canCommit: boolean; moneyActions?: boolean }) {
  const router = useRouter();
  const [period, setPeriod] = useState(lastMonth);
  const { data, error, loading, refreshing, reload } = useAgencyData<{ preview: Preview[]; runs: Run[] }>(`/api/app/agency/payouts?from=${period.from}&to=${period.to}`);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [confirming, setConfirming] = useState(false);
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("ACH");
  const [reference, setReference] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A correction waiting for its reason: void a run, or write off a producer's negative balance.
  const [fix, setFix] = useState<null | { kind: "void"; run: Run } | { kind: "write_off"; producer: Preview }>(null);
  const [reason, setReason] = useState("");

  async function correct() {
    if (!fix || !reason.trim()) return;
    setBusy(true);
    setProblem(null);
    const { error: message } = fix.kind === "void"
      ? await sendJson(`/api/app/accounting/producer-runs/${fix.run.id}`, "POST", { action: "void", reason: reason.trim() })
      : await sendJson("/api/app/accounting/producers", "POST", { op: "write_off", producer_user_id: fix.producer.producerUserId, reason: reason.trim() });
    setBusy(false);
    if (message) { setProblem(message); return; }
    notify.done(fix.kind === "void" ? `The run is void. Its amount is back on the producer's balance.` : `${fix.producer.displayName}'s negative balance is written off. The agency carries it.`);
    setFix(null);
    setReason("");
    reload();
  }

  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the decisions reset to the recommendation each time a preview arrives
    setDecisions(Object.fromEntries(data.preview.map((p) => [p.producerUserId, { include: !p.alreadyRun && (p.periodCents !== 0 || p.balanceCents !== 0), mode: p.recommendedMode, amount: "", reason: p.recommendedMode === "withhold" ? "Withheld against a negative balance" : "" }])));
  }, [data]);

  const preview = useMemo(() => data?.preview ?? [], [data]);
  const negative = preview.filter((p) => p.balanceCents < 0);
  const positive = preview.filter((p) => p.balanceCents >= 0);
  const names = useMemo(() => new Map(preview.map((p) => [p.producerUserId, p.displayName])), [preview]);
  const [runPage, setRunPage] = useState(1);
  const runPageSize = useFittingPageSize(320, 45);
  const runs = paginate(data?.runs ?? [], runPage, runPageSize);
  const chosen = preview.filter((p) => decisions[p.producerUserId]?.include);
  const toPay = chosen.reduce((s, p) => s + payFor(p, decisions[p.producerUserId]), 0);
  const withheld = chosen.reduce((s, p) => s + Math.max(Math.max(p.periodCents, 0) - payFor(p, decisions[p.producerUserId]), 0), 0);
  const set = (id: string, patch: Partial<Decision>) => setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  async function commit() {
    setProblem(null);
    setBusy(true);
    const { error: message } = await sendJson("/api/app/agency/payouts", "POST", {
      from: period.from, to: period.to, paidOn, method, reference: reference || null,
      decisions: chosen.map((p) => {
        const d = decisions[p.producerUserId];
        return { producerUserId: p.producerUserId, mode: d.mode, amountCents: d.mode === "amount" ? dollarsToCents(d.amount) : null, reason: d.reason || null };
      }),
    });
    setBusy(false);
    if (message) { setProblem(message); return; }
    notify.done(`Paid ${chosen.length} producer${chosen.length === 1 ? "" : "s"} ${dollars(toPay)} for ${period.from} to ${period.to}. Each has a statement.`);
    setConfirming(false);
    router.push("/app/producer-payouts?tab=runs");
    reload();
  }

  const decisionCell = (p: Preview) => {
    const d = decisions[p.producerUserId];
    if (!d) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Decision for ${p.displayName}`} className={toolbarControl} value={d.mode} disabled={!d.include} onChange={(e) => set(p.producerUserId, { mode: e.target.value as Decision["mode"] })}>
          <option value="pay_full">Pay this period in full</option>
          <option value="withhold">Withhold against the balance</option>
          <option value="amount">Pay a stated amount</option>
        </select>
        {d.mode === "amount" && <input aria-label="Amount" inputMode="decimal" placeholder="$" className={`${toolbarControl} w-24`} value={d.amount} onChange={(e) => set(p.producerUserId, { amount: e.target.value })} />}
      </div>
    );
  };

  const include = (p: Preview) => <input type="checkbox" aria-label={`Include ${p.displayName}`} checked={decisions[p.producerUserId]?.include ?? false} disabled={p.alreadyRun} onChange={(e) => set(p.producerUserId, { include: e.target.checked })} />;
  // The period and Refresh sit on the first card, whichever that is.
  const toolbar = (
    <DataToolbar actions={<RefreshButton onClick={reload} refreshing={refreshing} />}>
      <label className="flex items-center gap-2 text-sm">From<input type="date" className={toolbarControl} value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm">To<input type="date" className={toolbarControl} value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></label>
    </DataToolbar>
  );

  const correction = (
    <ConfirmDialog
      open={fix !== null}
      onOpenChange={(open) => { if (!open) setFix(null); }}
      title={fix?.kind === "void" ? `Void ${names.get(fix.run.producerUserId) ?? "this"}'s run for ${fix.run.periodStart} to ${fix.run.periodEnd}?` : fix?.kind === "write_off" ? `Write off ${fix.producer.displayName}'s balance of ${dollars(fix.producer.balanceCents)}?` : ""}
      description={fix?.kind === "void" ? "Its amount goes back on the producer's balance and the statement shows the run as void. It cannot be un-voided; pay the period again instead." : "The agency stops recovering it: the balance goes to zero with a write-off entry in the ledger. It cannot be undone."}
      confirmLabel={busy ? "Saving…" : fix?.kind === "void" ? "Void run" : "Write it off"}
      busy={busy}
      confirmDisabled={!reason.trim()}
      onConfirm={() => void correct()}
      fields={
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1 font-medium">Reason<input className={toolbarControl} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={fix?.kind === "void" ? "e.g. Paid the wrong period" : "e.g. Left the agency, not recoverable"} /></label>
          {problem && <p role="alert" className="text-[var(--error-ink)]">{problem}</p>}
        </div>
      }
    />
  );

  if (error) return <TableCard><ErrorState detail={error} /></TableCard>;
  if (loading || !data) return <TableCard><SectionLoading rows={5} columns={7} label="Loading the preview" /></TableCard>;

  if (tab === "runs") {
    return (
      <>
      <TableCard toolbar={<DataToolbar actions={<RefreshButton onClick={reload} refreshing={refreshing} />} />} footer={data.runs.length ? <Pager page={runs.current} total={data.runs.length} noun="runs" pageSize={runPageSize} onPage={setRunPage} /> : undefined}>
        {data.runs.length === 0 ? <EmptyState title="No runs yet" hint="Each committed run appears here, one row per producer, with their statement." action={canCommit ? <Button asChild><Link href="/app/producer-payouts">New run</Link></Button> : undefined} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Producer</TableHead><TableHead>Period</TableHead><TableHead>Decision</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Withheld</TableHead><TableHead>How</TableHead><TableHead className="text-right"><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {runs.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium"><Link className="hover:underline" href={`/app/producer-statements/${r.id}`}>{names.get(r.producerUserId) ?? "Producer"}</Link></TableCell>
                  <TableCell className="tabular-nums">{r.periodStart} – {r.periodEnd}</TableCell>
                  <TableCell>{(r.decisionMode && DECISION_LABEL[r.decisionMode]) ?? "—"}</TableCell>
                  <TableCell className="text-right"><Money cents={r.netCents} /></TableCell>
                  <TableCell className="text-right"><Money cents={r.withheldCents} /></TableCell>
                  <TableCell>{voided(r) ? <StatusChip tone="neutral">Void</StatusChip> : r.paidOn ? `${r.paidMethod ?? ""} ${r.paidOn}` : "Nothing to pay"}</TableCell>
                  <TableCell className="text-right"><span className="inline-flex items-center gap-1"><Button asChild size="sm" variant="outline"><Link href={`/app/producer-statements/${r.id}`}>Statement</Link></Button>{moneyActions && !voided(r) && <MoreMenu row label={`More for ${names.get(r.producerUserId) ?? "this run"}`} items={[{ label: "Void run", onSelect: () => { setReason(""); setProblem(null); setFix({ kind: "void", run: r }); } }]} />}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {correction}
      </>
    );
  }

  return (
    <>
      {canCommit && <StepSlot id={PRODUCER_PAYOUTS_SLOT}><Button onClick={() => { setProblem(null); setConfirming(true); }} disabled={!chosen.length}>Commit run</Button></StepSlot>}
      <StatStrip label="This run">
        <StatTile label="To pay · reported" value={dollars(toPay)} />
        <StatTile label="Withheld" value={dollars(withheld)} />
        <StatTile label="Negative balances" value={String(negative.length)} valueTone={negative.length ? "danger" : undefined} />
        <StatTile label="Producers" value={String(chosen.length)} footnote={`of ${preview.length}`} />
      </StatStrip>
      {negative.length > 0 && (
        <TableCard toolbar={toolbar} title="Negative balances: decide before committing">
          <Table>
            <TableHeader><TableRow><TableHead><span className="sr-only">Include</span></TableHead><TableHead>Producer</TableHead><TableHead className="text-right">Opening</TableHead><TableHead className="text-right">This period</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Behind it</TableHead><TableHead>Decision</TableHead></TableRow></TableHeader>
            <TableBody>
              {negative.map((p) => (
                <TableRow key={p.producerUserId} className="bg-[var(--error-surface)]">
                  <TableCell>{include(p)}</TableCell>
                  <TableCell className="font-medium">{p.displayName}{p.status !== "active" && <StatusChip tone="neutral" className="ml-2">{p.status}</StatusChip>}</TableCell>
                  <TableCell className="text-right"><Money cents={p.balanceBeforeCents} /></TableCell>
                  <TableCell className="text-right"><Money cents={p.periodCents} /></TableCell>
                  <TableCell className="text-right"><Money cents={p.balanceCents} /></TableCell>
                  <TableCell className="text-xs">{p.negativePolicies.slice(-3).map((x) => `${x.policy_number} ${dollars(x.amount_cents)}`).join(" · ") || "—"}</TableCell>
                  <TableCell><span className="inline-flex items-center gap-1">{decisionCell(p)}{moneyActions && <MoreMenu row label={`More for ${p.displayName}`} items={[{ label: "Write off the balance", onSelect: () => { setReason(""); setProblem(null); setFix({ kind: "write_off", producer: p }); } }]} />}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
      <TableCard title="Ready to pay" toolbar={negative.length ? undefined : toolbar}>
        {positive.length === 0 ? <EmptyState title="Nothing to pay in this period" hint="Earned commission appears here once carrier statements for the period are posted." /> : (
          <Table>
            <TableHeader><TableRow><TableHead><span className="sr-only">Include</span></TableHead><TableHead>Producer</TableHead><TableHead className="text-right">Earned <BasisChip basis="reported" /></TableHead><TableHead className="text-right">Charged back</TableHead><TableHead className="text-right">Opening</TableHead><TableHead className="text-right">Payout</TableHead><TableHead>Decision</TableHead></TableRow></TableHeader>
            <TableBody>
              {positive.map((p) => (
                <TableRow key={p.producerUserId}>
                  <TableCell>{include(p)}</TableCell>
                  <TableCell className="font-medium">{p.displayName}{p.alreadyRun && <StatusChip tone="good" className="ml-2">Already paid for this period</StatusChip>}</TableCell>
                  <TableCell className="text-right"><Money cents={p.earnedCents} /></TableCell>
                  <TableCell className="text-right"><Money cents={p.chargebackCents} /></TableCell>
                  <TableCell className="text-right"><Money cents={p.balanceBeforeCents} /></TableCell>
                  <TableCell className="text-right"><Money cents={decisions[p.producerUserId] ? payFor(p, decisions[p.producerUserId]) : 0} /></TableCell>
                  <TableCell>{decisionCell(p)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Pay ${chosen.length} producer${chosen.length === 1 ? "" : "s"} ${dollars(toPay)}`}
        description={`For ${period.from} to ${period.to}. Each producer gets a statement. A period cannot be paid twice.${withheld > 0 ? ` ${dollars(withheld)} is withheld and stays on those balances; the reason prints on their statements.` : ""}`}
        confirmLabel={busy ? "Paying…" : "Commit run"}
        destructive={false}
        busy={busy}
        confirmDisabled={!paidOn || !method}
        onConfirm={() => void commit()}
        fields={
          <div className="grid gap-3 text-sm">
            <label className="grid gap-1 font-medium">Paid on<input type="date" className={toolbarControl} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
            <label className="grid gap-1 font-medium">How<select className={toolbarControl} value={method} onChange={(e) => setMethod(e.target.value)}><option>ACH</option><option>Check</option><option>Wire</option><option>Other</option></select></label>
            <label className="grid gap-1 font-medium">Reference<input className={toolbarControl} placeholder="e.g. BATCH-2026-10" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
            {problem && <p role="alert" className="text-[var(--error-ink)]">{problem}</p>}
          </div>
        }
      />
      {correction}
    </>
  );
}
