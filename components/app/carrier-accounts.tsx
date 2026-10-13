"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { accountTrend, statementProblem, type StatementCheck } from "@/lib/ingestion/carrierAccounts";
import { fileDay } from "@/lib/ingestion/constants";
import { notify } from "@/lib/notify";

type Statement = StatementCheck & { carrierName: string };
type Orphan = { carrierId: string; carrierName: string; policies: number; lines: number; amountCents: number; heldCents: number; oldest: string | null; pastThreshold: number };

const signed = (cents: number) => {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "−" : ""}$${Number(digits.slice(0, -2)).toLocaleString("en-US")}.${digits.slice(-2)}`;
};
/** "1,234.56" / "-430.06" → cents, from the digits. Null if it isn't an amount. */
const toCents = (text: string): number | null => {
  const match = /^\s*(-)?\$?\s*([\d,]+)(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  const value = Number(match[2].replaceAll(",", "")) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -value : value;
};
const select = `${toolbarControl} w-full`;

/**
 * LA-4.14 (Notion sprint) · each carrier's running account with the agent, statement by statement:
 * whether each one adds up, whether one is missing, and which way the balance is moving. A debit
 * balance means the carrier keeps every commission until it clears — not missing money.
 */
export function CarrierAccounts({ statements, orphans, files, carriers, readOnly, today, orphanDays = 60 }: { orphanDays?: number; statements: Statement[]; orphans: Orphan[]; files: Array<{ id: string; carrierId: string; label: string; fileDate: string | null }>; carriers: Array<{ id: string; name: string }>; readOnly: boolean; today: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const set = (key: string, value: string) => setForm((now) => ({ ...now, [key]: value }));

  const byCarrier = useMemo(() => {
    const groups = new Map<string, Statement[]>();
    for (const s of statements) groups.set(s.carrierId, [...(groups.get(s.carrierId) ?? []), s]);
    return [...groups.entries()].map(([carrierId, rows]) => ({ carrierId, carrierName: rows[0].carrierName, ...accountTrend(rows) }));
  }, [statements]);
  const debit = byCarrier.filter((c) => c.latest && c.latest.closingCents < 0);
  const flagged = byCarrier.reduce((sum, c) => sum + c.flagged, 0);
  const gaps = byCarrier.reduce((sum, c) => sum + c.gaps, 0);
  const orphanCents = orphans.reduce((sum, o) => sum + o.amountCents, 0);
  const carrierFiles = files.filter((f) => f.carrierId === form.carrier);
  const [page, setPage] = useState(1);
  const statementRows = byCarrier.flatMap((carrier) => carrier.rows.map((s, index) => ({ carrier, s, index })));
  const shown = paginate(statementRows, page);

  async function save() {
    const opening = toCents(form.opening ?? "");
    const activity = toCents(form.activity ?? "");
    const closing = toCents(form.closing ?? "");
    if (!form.carrier) return notify.block("Choose the carrier.");
    if (opening === null || activity === null || closing === null) return notify.block("Enter the opening balance, the activity and the closing balance as the statement states them.");
    const optional = (key: string) => (form[key]?.trim() ? toCents(form[key]) : null);
    setBusy(true);
    try {
      const response = await fetch("/api/app/carrier-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_statement", carrier_id: form.carrier, statement_date: form.date || today, file_id: form.file || null, opening_cents: opening, activity_cents: activity, closing_cents: closing, amount_paid_cents: optional("paid"), held_cents: optional("held"), minimum_payout_cents: optional("minimum") }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(opening + activity === closing ? "Statement saved." : "Saved, and flagged: opening plus activity isn't the closing balance. Its lines are held out of your totals until it's corrected.");
      setOpen(false);
      setForm({});
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StatStrip label="Carrier accounts">
        <StatTile label="Debit balances" value={debit.length ? signed(debit.reduce((sum, c) => sum + (c.latest?.closingCents ?? 0), 0)) : "None"} valueTone={debit.length ? "danger" : undefined} footnote={debit.length ? `owed to ${debit.length} ${debit.length === 1 ? "carrier" : "carriers"}; paid nothing until cleared` : "no carrier is holding your commission"} />
        <StatTile label="Statements that don't add up" value={flagged.toLocaleString("en-US")} valueTone={flagged ? "warning" : undefined} footnote="their lines are held out of totals" />
        <StatTile label="Missing statements" value={gaps.toLocaleString("en-US")} valueTone={gaps ? "warning" : undefined} footnote="every balance after a gap is unverified" />
        <StatTile label="Unattributed commission" value={orphans.length ? signed(orphanCents) : "None"} footnote={orphans.length ? (() => { const n = orphans.reduce((s, o) => s + o.policies, 0); return `${n} ${n === 1 ? "policy" : "policies"} no policy file has shown yet`; })() : "every line has its policy"} />
      </StatStrip>

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {!readOnly && <Button type="button" onClick={() => { setForm({ date: today }); setOpen(true); }} disabled={!carriers.length} title={carriers.length ? undefined : "Upload a commission file first"}>Add statement totals</Button>}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <span className="text-sm text-muted-foreground">Oldest statement first, per carrier</span>
          </DataToolbar>
        }
        footer={statementRows.length > 10 ? <Pager page={shown.current} total={statementRows.length} noun="statements" onPage={setPage} /> : undefined}
      >
        {byCarrier.length === 0 ? (
          <EmptyState title="No statement totals yet" hint="Each carrier statement starts with its account: opening balance, activity, closing balance. Add those for a commission file to check that it adds up and to follow the balance from one statement to the next." />
        ) : (
          <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr>
                <th>Carrier</th>
                <th className="w-[120px]">Statement</th>
                <th className="w-[110px] text-right">Opening</th>
                <th className="w-[110px] text-right">Activity</th>
                <th className="w-[120px] text-right">Closing</th>
                <th className="w-[110px] text-right" title="Change in the closing balance since the previous statement">Change</th>
                <th className="w-[110px] text-right">Paid / held</th>
                <th className="w-[200px]">Checks</th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.map(({ carrier, s, index }, position) => {
                const problem = statementProblem(s);
                // A carrier's name heads its first statement, and the first row of a page.
                return (
                  <tr key={s.id}>
                    <td className="font-semibold text-foreground">{index === 0 || position === 0 ? carrier.carrierName : ""}{index === 0 && carrier.growingDebit && <span className="block text-xs font-normal text-[var(--error-ink)]">debit growing{carrier.fallingFor > 1 ? ` for ${carrier.fallingFor} statements` : ""}</span>}</td>
                    <td className="tabular-nums">{fileDay(s.statementDate)}</td>
                    <td className="text-right tabular-nums">{signed(s.openingCents)}</td>
                    <td className="text-right tabular-nums" title={s.entriesCents !== null ? `Its ${s.entries} lines add up to ${signed(s.entriesCents)}` : "No commission file attached"}>{signed(s.activityCents)}</td>
                    <td className={`text-right font-semibold tabular-nums ${s.closingCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{signed(s.closingCents)}{s.closingCents < 0 && <span className="block text-xs font-normal">debit</span>}</td>
                    <td className={`text-right tabular-nums ${s.changeCents === null ? "text-muted-foreground" : s.changeCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{s.changeCents === null ? "—" : `${s.changeCents > 0 ? "+" : ""}${signed(s.changeCents)}`}</td>
                    <td className="text-right tabular-nums">{s.amountPaidCents !== null ? signed(s.amountPaidCents) : "—"}{s.heldCents ? <span className="block text-xs text-muted-foreground">{signed(s.heldCents)} held</span> : null}</td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        {problem ? <StatusChip tone="danger">Doesn&apos;t add up</StatusChip> : <StatusChip tone="good">Adds up</StatusChip>}
                        {!s.continuityOk && <StatusChip tone="warning">Statement missing before</StatusChip>}
                      </span>
                      {problem && <span className="mt-0.5 block text-xs text-[var(--error-ink)]">{problem}</span>}
                      {!s.continuityOk && <span className="mt-0.5 block text-xs text-muted-foreground">Opens at {signed(s.openingCents)}; the statement of {fileDay(s.previousStatementDate)} closed differently.</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      {orphans.length > 0 && (
        <PagedTableCard total={orphans.length} noun="carriers" title="Commission for policies not seen yet" description={`Normal while policy files catch up; each line joins its policy the moment the policy arrives. After ${orphanDays} days a line goes to Exceptions.`}>
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Carrier</th><th className="w-[100px] text-right">Policies</th><th className="w-[100px] text-right">Lines</th><th className="w-[140px] text-right">Amount</th><th className="w-[130px]">Oldest</th><th className="w-[140px] text-right">Past {orphanDays} days</th></tr></thead>
            <PagedBody>
              {orphans.map((o) => (
                <tr key={o.carrierId}>
                  <td className="font-semibold text-foreground">{o.carrierName}</td>
                  <td className="text-right tabular-nums">{o.policies}</td>
                  <td className="text-right tabular-nums">{o.lines}</td>
                  <td className="text-right tabular-nums">{signed(o.amountCents)}{o.heldCents ? <span className="block text-xs text-muted-foreground">{signed(o.heldCents)} held</span> : null}</td>
                  <td className="tabular-nums">{fileDay(o.oldest)}</td>
                  <td className={`text-right tabular-nums ${o.pastThreshold ? "text-[var(--warning-ink)]" : "text-muted-foreground"}`}>{o.pastThreshold}</td>
                </tr>
              ))}
            </PagedBody>
          </table>
        </PagedTableCard>
      )}

      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Add statement totals</DialogTitle>
            <DialogDescription>Copy them from the top of the carrier&apos;s statement. A negative balance means you owe the carrier.</DialogDescription>
          </DialogHeader>
          <fieldset disabled={busy} className="grid gap-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1"><Label htmlFor="ca-carrier">Carrier</Label><select id="ca-carrier" className={select} value={form.carrier ?? ""} onChange={(e) => setForm((now) => ({ ...now, carrier: e.target.value, file: "" }))}><option value="">Choose</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="grid gap-1"><Label htmlFor="ca-file">Commission file</Label><select id="ca-file" className={select} value={form.file ?? ""} onChange={(e) => { const file = carrierFiles.find((f) => f.id === e.target.value); setForm((now) => ({ ...now, file: e.target.value, date: file?.fileDate ?? now.date })); }} disabled={!form.carrier}><option value="">None (totals only)</option>{carrierFiles.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></div>
              <div className="grid gap-1"><Label htmlFor="ca-date">Statement date</Label><Input id="ca-date" type="date" className="h-9" value={form.date ?? today} onChange={(e) => set("date", e.target.value)} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1"><Label htmlFor="ca-open">Opening balance</Label><Input id="ca-open" className="h-9" inputMode="decimal" placeholder="-100.00" value={form.opening ?? ""} onChange={(e) => set("opening", e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-act">Activity</Label><Input id="ca-act" className="h-9" inputMode="decimal" placeholder="871.95" value={form.activity ?? ""} onChange={(e) => set("activity", e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-close">Closing balance</Label><Input id="ca-close" className="h-9" inputMode="decimal" placeholder="771.95" value={form.closing ?? ""} onChange={(e) => set("closing", e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-paid">Amount paid (optional)</Label><Input id="ca-paid" className="h-9" inputMode="decimal" value={form.paid ?? ""} onChange={(e) => set("paid", e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-held">Held (optional)</Label><Input id="ca-held" className="h-9" inputMode="decimal" value={form.held ?? ""} onChange={(e) => set("held", e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-min">Minimum payout (optional)</Label><Input id="ca-min" className="h-9" inputMode="decimal" value={form.minimum ?? ""} onChange={(e) => set("minimum", e.target.value)} /></div>
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
