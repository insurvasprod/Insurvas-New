"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notify } from "@/lib/notify";

import { PageHeader } from "@/components/ui/page-header";
import { ViewTabs } from "@/components/ui/view-tabs";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dollars, dollarsToCents } from "@/lib/agency/constants";
import { BasisChip, Money } from "./money";
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

/**
 * AG-1.7 · the payout run. The preview writes NOTHING. Producers with a negative balance come first, with the
 * policies behind it and a recommended withhold, so the owner decides before he pays — pay in full, withhold
 * against the balance, or pay a stated amount — and that decision is recorded with the run and printed on the
 * statement. Commit pays once per producer and period, on the reported basis. No ACH: it records how you paid.
 */
export function PayoutsBoard({ canCommit }: { canCommit: boolean }) {
  const [tab, setTab] = useState<"run" | "history">("run");
  const [period, setPeriod] = useState(lastMonth);
  const { data, error, loading, refreshing, reload } = useAgencyData<{ preview: Preview[]; runs: Run[] }>(`/api/app/agency/payouts?from=${period.from}&to=${period.to}`);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [confirming, setConfirming] = useState(false);
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("ACH");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the decisions reset to the recommendation each time a preview arrives
    setDecisions(Object.fromEntries(data.preview.map((p) => [p.producerUserId, { include: !p.alreadyRun && (p.periodCents !== 0 || p.balanceCents !== 0), mode: p.recommendedMode, amount: "", reason: p.recommendedMode === "withhold" ? "Withheld against a negative balance" : "" }])));
  }, [data]);

  const preview = useMemo(() => data?.preview ?? [], [data]);
  const negative = preview.filter((p) => p.balanceCents < 0);
  const positive = preview.filter((p) => p.balanceCents >= 0);
  const names = useMemo(() => new Map(preview.map((p) => [p.producerUserId, p.displayName])), [preview]);
  const chosen = preview.filter((p) => decisions[p.producerUserId]?.include);
  const toPay = chosen.reduce((s, p) => s + payFor(p, decisions[p.producerUserId]), 0);
  const withheld = chosen.reduce((s, p) => s + Math.max(Math.max(p.periodCents, 0) - payFor(p, decisions[p.producerUserId]), 0), 0);
  const set = (id: string, patch: Partial<Decision>) => setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  async function commit() {
    setBusy(true);
    setProblem(null);
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
    setTab("history");
    reload();
  }

  const decisionCell = (p: Preview) => {
    const d = decisions[p.producerUserId];
    if (!d) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Decision for ${p.displayName}`} className={`${toolbarControl} h-8`} value={d.mode} disabled={!d.include} onChange={(e) => set(p.producerUserId, { mode: e.target.value as Decision["mode"] })}>
          <option value="pay_full">Pay this period in full</option>
          <option value="withhold">Withhold against the balance</option>
          <option value="amount">Pay a stated amount</option>
        </select>
        {d.mode === "amount" && <input aria-label="Amount" inputMode="decimal" placeholder="$" className={`${toolbarControl} h-8 w-24`} value={d.amount} onChange={(e) => set(p.producerUserId, { amount: e.target.value })} />}
      </div>
    );
  };

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Payout runs" description="Close a period and pay your producers. Nothing is written until you commit." actions={tab === "run" && canCommit ? <Button onClick={() => setConfirming(true)} disabled={!chosen.length}>Commit run</Button> : undefined} />
      <ViewTabs label="Payouts" value={tab} onChange={setTab} tabs={[{ key: "run", label: "New run" }, { key: "history", label: "Runs", count: data?.runs.length ?? null }]} idPrefix="payout-tab" />
      {error ? <ErrorState detail={error} /> : loading || !data ? <SectionLoading rows={5} columns={7} label="Loading the preview" /> : tab === "run" ? (
        <>
          <StatStrip label="This run">
            <StatTile label="To pay · reported" value={dollars(toPay)} />
            <StatTile label="Withheld" value={dollars(withheld)} />
            <StatTile label="Negative balances" value={String(negative.length)} valueTone={negative.length ? "danger" : undefined} />
            <StatTile label="Producers" value={String(chosen.length)} />
          </StatStrip>
          <TableCard toolbar={
            <DataToolbar actions={<RefreshButton onClick={reload} refreshing={refreshing} />}>
              <label className="flex items-center gap-2 text-sm">From<input type="date" className={toolbarControl} value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm">To<input type="date" className={toolbarControl} value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></label>
            </DataToolbar>
          } title={negative.length ? "Negative balances: decide before committing" : undefined}>
            {negative.length === 0 ? null : (
              <Table>
                <TableHeader><TableRow><TableHead /><TableHead>Producer</TableHead><TableHead className="text-right">Opening</TableHead><TableHead className="text-right">This period</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Behind it</TableHead><TableHead>Decision</TableHead></TableRow></TableHeader>
                <TableBody>
                  {negative.map((p) => (
                    <TableRow key={p.producerUserId} className="bg-[var(--error-surface)]">
                      <TableCell><input type="checkbox" aria-label={`Include ${p.displayName}`} checked={decisions[p.producerUserId]?.include ?? false} disabled={p.alreadyRun} onChange={(e) => set(p.producerUserId, { include: e.target.checked })} /></TableCell>
                      <TableCell className="font-medium">{p.displayName}{p.status !== "active" && <StatusChip tone="neutral" className="ml-2">{p.status}</StatusChip>}</TableCell>
                      <TableCell className="text-right"><Money cents={p.balanceBeforeCents} /></TableCell>
                      <TableCell className="text-right"><Money cents={p.periodCents} /></TableCell>
                      <TableCell className="text-right"><Money cents={p.balanceCents} /></TableCell>
                      <TableCell className="text-xs">{p.negativePolicies.slice(-3).map((x) => `${x.policy_number} ${dollars(x.amount_cents)}`).join(" · ") || "—"}</TableCell>
                      <TableCell>{decisionCell(p)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TableCard>
          <TableCard title="Ready to pay">
            {positive.length === 0 ? <EmptyState title="Nothing to pay in this period" hint="Earned commission appears here once carrier statements for the period are posted." /> : (
              <Table>
                <TableHeader><TableRow><TableHead /><TableHead>Producer</TableHead><TableHead className="text-right">Earned <BasisChip basis="reported" /></TableHead><TableHead className="text-right">Charged back</TableHead><TableHead className="text-right">Opening</TableHead><TableHead className="text-right">Payout</TableHead><TableHead>Decision</TableHead></TableRow></TableHeader>
                <TableBody>
                  {positive.map((p) => (
                    <TableRow key={p.producerUserId}>
                      <TableCell><input type="checkbox" aria-label={`Include ${p.displayName}`} checked={decisions[p.producerUserId]?.include ?? false} disabled={p.alreadyRun} onChange={(e) => set(p.producerUserId, { include: e.target.checked })} /></TableCell>
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
        </>
      ) : (
        <TableCard>
          {data.runs.length === 0 ? <EmptyState title="No runs yet" hint="Each committed run appears here, one row per producer, with his statement." /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Producer</TableHead><TableHead>Period</TableHead><TableHead>Decision</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Withheld</TableHead><TableHead>How</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {data.runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{names.get(r.producerUserId) ?? "Producer"}</TableCell>
                    <TableCell className="tabular-nums">{r.periodStart} – {r.periodEnd}</TableCell>
                    <TableCell>{r.decisionMode === "withhold" ? "Withheld" : r.decisionMode === "amount" ? "Stated amount" : r.decisionMode === "pay_full" ? "In full" : "—"}</TableCell>
                    <TableCell className="text-right"><Money cents={r.netCents} /></TableCell>
                    <TableCell className="text-right"><Money cents={r.withheldCents} /></TableCell>
                    <TableCell>{r.paidOn ? `${r.paidMethod ?? ""} ${r.paidOn}` : "Nothing to pay"}</TableCell>
                    <TableCell className="text-right"><Link className="font-medium text-[var(--accent-ink)] hover:underline" href={`/app/producer-statements/${r.id}`}>Statement</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TableCard>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay {chosen.length} producer{chosen.length === 1 ? "" : "s"} {dollars(toPay)}</DialogTitle>
            <DialogDescription>For {period.from} to {period.to}. Each producer gets a statement. A period cannot be paid twice.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <label className="grid gap-1 font-medium">Paid on<input type="date" className={toolbarControl} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
            <label className="grid gap-1 font-medium">How<select className={toolbarControl} value={method} onChange={(e) => setMethod(e.target.value)}><option>ACH</option><option>Check</option><option>Wire</option><option>Other</option></select></label>
            <label className="grid gap-1 font-medium">Reference<input className={toolbarControl} placeholder="e.g. BATCH-2026-10" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
            {withheld > 0 && <p className="text-[var(--muted)]">{dollars(withheld)} is withheld and stays on those producers&apos; balances; the reason prints on their statements.</p>}
            {problem && <p role="alert" className="rounded-md border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-2 text-[var(--error-ink)]">{problem}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button onClick={commit} disabled={busy || !paidOn || !method}>{busy ? "Paying…" : "Commit run"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
