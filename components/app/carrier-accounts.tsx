"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { Pager, paginate } from "@/components/ui/pager";
import { SelectMenu } from "@/components/ui/select-menu";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
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
  const pageSize = useFittingPageSize(480, 45);
  const shown = paginate(statementRows, page, pageSize);

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
        <StatTile label="Debit balances" value={debit.length ? signed(debit.reduce((sum, c) => sum + (c.latest?.closingCents ?? 0), 0)) : "None"} footnote={debit.length ? <span title="Paid nothing until cleared"><StatusChip tone="danger">{`Owed to ${debit.length} ${debit.length === 1 ? "carrier" : "carriers"}`}</StatusChip></span> : "no carrier is holding your commission"} />
        <StatTile label="Statements that don't add up" value={flagged.toLocaleString("en-US")} footnote={flagged ? <StatusChip tone="warning">Lines held out of totals</StatusChip> : "their lines are held out of totals"} />
        <StatTile label="Missing statements" value={gaps.toLocaleString("en-US")} footnote={gaps ? <span title="Every balance after a gap is unverified"><StatusChip tone="warning">Balances unverified</StatusChip></span> : "every balance after a gap is unverified"} />
        <StatTile label="Unattributed commission" value={orphans.length ? signed(orphanCents) : "None"} footnote={orphans.length ? (() => { const n = orphans.reduce((s, o) => s + o.policies, 0); return `${n} ${n === 1 ? "policy" : "policies"} no policy file has shown yet`; })() : "every line has its policy"} />
      </StatStrip>

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {!readOnly && <Button type="button" onClick={() => { setForm({ date: today }); setOpen(true); }} disabled={!carriers.length} title={carriers.length ? undefined : "Upload a commission file first"}>Add statement totals</Button>}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <span className="text-sm text-foreground">Oldest statement first, per carrier</span>
          </DataToolbar>
        }
        footer={statementRows.length ? <Pager page={shown.current} total={statementRows.length} noun="statements" pageSize={pageSize} onPage={setPage} /> : undefined}
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
                    {/* Owner 2026-11-11: one line, one colour. "Debit growing" is the carrier's tooltip, held the Paid's, and
                        what is wrong with a statement its chip's; a debit reads by its minus sign. */}
                    <td className="whitespace-nowrap font-medium text-foreground" title={index === 0 && carrier.growingDebit ? `Debit growing${carrier.fallingFor > 1 ? ` for ${carrier.fallingFor} statements` : ""}` : undefined}>{index === 0 || position === 0 ? carrier.carrierName : ""}</td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(s.statementDate)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{signed(s.openingCents)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums" title={s.entriesCents !== null ? `Its ${s.entries} lines add up to ${signed(s.entriesCents)}` : "No commission file attached"}>{signed(s.activityCents)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums" title={s.closingCents < 0 ? "A debit: you owe the carrier" : undefined}>{signed(s.closingCents)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{s.changeCents === null ? <span className="text-muted-foreground">—</span> : `${s.changeCents > 0 ? "+" : ""}${signed(s.changeCents)}`}</td>
                    <td className="whitespace-nowrap text-right tabular-nums" title={s.heldCents ? `${signed(s.heldCents)} held` : undefined}>{s.amountPaidCents !== null ? signed(s.amountPaidCents) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap" title={[problem, !s.continuityOk ? `Statement missing before: opens at ${signed(s.openingCents)}; the statement of ${fileDay(s.previousStatementDate)} closed differently.` : null].filter(Boolean).join(" · ") || undefined}>
                      {problem ? <StatusChip tone="danger">Doesn&apos;t add up</StatusChip> : !s.continuityOk ? <StatusChip tone="warning">Statement missing before</StatusChip> : <StatusChip tone="good">Adds up</StatusChip>}
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
                  <td className="whitespace-nowrap font-medium text-foreground">{o.carrierName}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{o.policies}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{o.lines}</td>
                  <td className="whitespace-nowrap text-right tabular-nums" title={o.heldCents ? `${signed(o.heldCents)} held` : undefined}>{signed(o.amountCents)}</td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(o.oldest)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{o.pastThreshold ? <StatusChip tone="warning">{`${o.pastThreshold} past ${orphanDays} days`}</StatusChip> : <span className="text-muted-foreground">0</span>}</td>
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
              <div className="grid gap-1"><Label htmlFor="ca-carrier">Carrier</Label><SelectMenu id="ca-carrier" label="Carrier" className="w-full" matchTriggerWidth disabled={busy} value={form.carrier ?? ""} options={[{ value: "", label: "Choose" }, ...carriers.map((c) => ({ value: c.id, label: c.name }))]} onChange={(value) => setForm((now) => ({ ...now, carrier: value, file: "" }))} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-file">Commission file</Label><SelectMenu id="ca-file" label="Commission file" className="w-full" matchTriggerWidth disabled={busy || !form.carrier} value={form.file ?? ""} options={[{ value: "", label: "None (totals only)" }, ...carrierFiles.map((f) => ({ value: f.id, label: f.label }))]} onChange={(value) => { const file = carrierFiles.find((f) => f.id === value); setForm((now) => ({ ...now, file: value, date: file?.fileDate ?? now.date })); }} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-date">Statement date</Label><Input id="ca-date" type="date" value={form.date ?? today} onChange={(e) => set("date", e.target.value)} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1"><Label htmlFor="ca-open">Opening balance</Label><Input id="ca-open" inputMode="decimal" placeholder="-100.00" value={form.opening ?? ""} onChange={(e) => set("opening", e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-act">Activity</Label><Input id="ca-act" inputMode="decimal" placeholder="871.95" value={form.activity ?? ""} onChange={(e) => set("activity", e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-close">Closing balance</Label><Input id="ca-close" inputMode="decimal" placeholder="771.95" value={form.closing ?? ""} onChange={(e) => set("closing", e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-paid">Amount paid (optional)</Label><Input id="ca-paid" inputMode="decimal" value={form.paid ?? ""} onChange={(e) => set("paid", e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-held">Held (optional)</Label><Input id="ca-held" inputMode="decimal" value={form.held ?? ""} onChange={(e) => set("held", e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="ca-min">Minimum payout (optional)</Label><Input id="ca-min" inputMode="decimal" value={form.minimum ?? ""} onChange={(e) => set("minimum", e.target.value)} /></div>
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
