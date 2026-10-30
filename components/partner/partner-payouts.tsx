"use client";

import { useCallback, useEffect, useState } from "react";

import { CheckCircle2, Clock3, WalletCards } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { StatusChip } from "@/components/ui/status-chip";
import { Pager, paginate } from "@/components/ui/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { PartnerStatement } from "@/lib/accounting/payoutsCore";
import { dayMonth, dayMonthYear } from "@/lib/format/dates";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.4 · the partner's own statements, in the portal it already logs into: it arrives at the
 * month's conversation already knowing the number, and disputes the one line it disagrees with.
 * Only what partnerStatement() whitelists reaches this screen.
 */
type RunRow = { id: string; periodStart: string; periodEnd: string; status: "published" | "paid"; netCents: number; paidOn: string | null };
const money = (c: number) => formatCentsAsCurrency(c);

/**
 * "1 Sep – 30 Sep 2026". The period came through as the two raw day strings the database stores;
 * a partner's statement is a month, and should read like one (lib/format/dates, §14).
 */
const period = (start: string, end: string) => `${dayMonth(start)} – ${dayMonthYear(end)}`;

function Statement({ id, onClose }: { id: string; onClose: () => void }) {
  const [s, setS] = useState<PartnerStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispute, setDispute] = useState<{ itemId: string | null; reason: string; amount: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/partner/payouts/${id}`).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) setError(body?.error ?? "Could not open the statement");
      else setS(body.statement);
    });
    return () => { live = false; };
  }, [id]);
  const raise = async () => {
    if (!dispute) return;
    const cents = dispute.amount.trim() ? parseDollarsToCents(dispute.amount) : 0;
    if (cents === null || cents < 0) { setError("Enter the amount in dollars and cents."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partner/payouts/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_id: dispute.itemId, reason: dispute.reason, claim_cents: cents }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "That didn't send");
      setS(body.statement);
      setDispute(null);
      notify.done("Dispute sent to the agency");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't send");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={s ? `Statement · ${period(s.periodStart, s.periodEnd)}` : "Statement"} subtitle={s ? `Net payable ${money(s.totals.netCents)}` : undefined}
      status={s ? <StatusChip tone={s.status === "paid" ? "good" : "info"}>{s.status === "paid" ? `Paid ${s.paidOn ? dayMonthYear(s.paidOn) : ""}`.trim() : "Published"}</StatusChip> : undefined} onClose={onClose}
      footer={s && !dispute ? <Button variant="outline" onClick={() => setDispute({ itemId: null, reason: "", amount: "" })}>Dispute this statement</Button> : undefined}>
      {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
      {!s ? null : (
        <>
          {dispute ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <label className="flex flex-col gap-1 text-sm">What is wrong{dispute.itemId ? " with this line" : ""}?<input className={toolbarControl} value={dispute.reason} onChange={(e) => setDispute({ ...dispute, reason: e.target.value })} autoFocus /></label>
              <label className="flex flex-col gap-1 text-sm">Amount you believe is owed ($)<input className={toolbarControl} inputMode="decimal" value={dispute.amount} onChange={(e) => setDispute({ ...dispute, amount: e.target.value })} /></label>
              <div className="flex gap-2"><Button disabled={busy || !dispute.reason.trim()} onClick={() => void raise()}>Send to the agency</Button><Button variant="outline" onClick={() => setDispute(null)}>Cancel</Button></div>
            </div>
          ) : null}
          {s.from?.name ? (
            <div className="text-sm">
              <p className="m-0 font-semibold">From {s.from.name}</p>
              {s.from.addressLines.map((line) => <p key={line} className="m-0 text-muted-foreground">{line}</p>)}
            </div>
          ) : null}
          <table className="w-full text-left text-sm">
            <tbody>
              {s.lines.map((l) => (
                <tr key={`${l.label}-${l.rateCents}`} className="border-t border-border"><td className="py-1">{l.label}</td><td className="text-right">{l.count}</td><td className="text-right text-muted-foreground">{l.rateCents != null ? `@ ${money(l.rateCents)}` : ""}</td><td className="text-right tabular-nums">{money(l.amountCents)}</td></tr>
              ))}
              {s.revenueShare ? <tr className="border-t border-border"><td className="py-1">Revenue share</td><td /><td /><td className="text-right tabular-nums">{money(s.revenueShare.amountCents)}</td></tr> : null}
              {s.rejectedCount ? <tr className="border-t border-border"><td className="py-1">Rejected — compliance</td><td className="text-right">{s.rejectedCount}</td><td /><td className="text-right text-muted-foreground">—</td></tr> : null}
              {s.credits.count ? <tr className="border-t border-border"><td className="py-1">Credits accepted ({s.credits.count})</td><td /><td /><td className="text-right tabular-nums">{money(s.credits.amountCents)}</td></tr> : null}
              {s.totals.disputedCents ? <tr className="border-t border-border"><td className="py-1">Disputed, withheld</td><td /><td /><td className="text-right tabular-nums">{money(-s.totals.disputedCents)}</td></tr> : null}
              <tr className="border-t-2 border-border font-semibold"><td className="pt-2">Net payable</td><td /><td /><td className="pt-2 text-right tabular-nums">{money(s.totals.netCents)}</td></tr>
            </tbody>
          </table>
          {s.rejectedCount ? <p className="text-xs text-muted-foreground">Transfers rejected at the agency&apos;s compliance check are not billable. The count tells you there is a source to look at.</p> : null}
          {s.footer ? <p className="text-xs text-muted-foreground">{s.footer}</p> : null}
          {s.disputes.length ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">Disputes</h3>
              {s.disputes.map((d) => <div key={d.id} className="text-sm">Raised by {d.raisedBy}: {d.reason} · {money(d.amountCents)} · <span className="text-muted-foreground">{d.status === "open" ? "open" : `${d.status}: ${d.resolutionNote ?? ""}`}</span></div>)}
            </div>
          ) : null}
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Every line</h3>
            <table className="w-full text-left text-sm">
              <tbody>
                {s.items.map((i) => (
                  <tr key={i.id} className="border-t border-border"><td className="py-1 whitespace-nowrap">{dayMonth(i.occurredOn)}</td><td>{i.label}{i.reference ? <span className="text-xs text-muted-foreground"> · ref {i.reference}</span> : null}{i.disputed ? <span className="text-xs text-[var(--warning-ink)]"> · disputed</span> : null}</td><td className="text-right tabular-nums">{money(i.amountCents)}</td><td className="w-[84px] text-right">{!i.disputed && !dispute ? <Button size="sm" variant="ghost" onClick={() => setDispute({ itemId: i.id, reason: "", amount: "" })}>Dispute</Button> : null}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** Sample statements for `/design/organization`; a partner's own page never passes them. */
export function PartnerPayouts({ sample }: { sample?: RunRow[] }) {
  const [runs, setRuns] = useState<RunRow[] | null>(sample ?? null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(!sample);
  const [page, setPage] = useState(1);
  // main's rule (30 Oct): the pager takes as many rows as the window has room for.
  const pageSize = useFittingPageSize(380, 45);
  const paged = paginate(runs ?? [], page, pageSize);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/partner/payouts", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Statements could not be loaded");
      setRuns(body.runs as RunRow[]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Statements could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  // Deferred by a tick: the read sets "loading" synchronously, and an effect body should not.
  useEffect(() => { if (sample) return; const kickoff = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(kickoff); }, [load, sample]);

  const total = (rows: RunRow[]) => rows.reduce((sum, run) => sum + run.netCents, 0);
  const paid = runs?.filter((run) => run.status === "paid") ?? [];
  const awaiting = runs?.filter((run) => run.status !== "paid") ?? [];
  const latest = runs?.[0] ?? null;
  const count = (rows: RunRow[]) => `${rows.length} statement${rows.length === 1 ? "" : "s"}`;

  return (
    <>
      <StatRow label="Statement totals" className="mb-4">
        <StatCard
          icon={WalletCards}
          label="Latest statement"
          value={runs === null ? "—" : latest ? money(latest.netCents) : "—"}
          fact={{ label: latest ? period(latest.periodStart, latest.periodEnd) : runs === null ? "Reading" : "None published yet" }}
        />
        <StatCard
          icon={CheckCircle2}
          label="Paid to date"
          value={runs === null ? "—" : money(total(paid))}
          fact={{ label: runs === null ? "Reading" : count(paid) }}
        />
        <StatCard
          icon={Clock3}
          label="Awaiting payment"
          value={runs === null ? "—" : money(total(awaiting))}
          tone={awaiting.length ? "warn" : "default"}
          fact={{ label: runs === null ? "Reading" : count(awaiting) }}
        />
      </StatRow>

      <TableCard
        toolbar={<DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={loading} />} />}
        footer={runs?.length ? <Pager page={paged.current} total={runs.length} noun={runs.length === 1 ? "statement" : "statements"} pageSize={pageSize} onPage={setPage} /> : undefined}
      >
        {error ? <EmptyState title="Statements are not available" hint={error} /> : runs === null ? <SectionLoading rows={4} columns={4} /> : runs.length === 0 ? (
          <EmptyState title="No statements yet" hint="When the agency publishes a payout statement for you, it appears here." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="w-[160px] text-right">Net payable</TableHead>
                <TableHead className="w-[170px]">Status</TableHead>
                <TableHead className="w-[90px] text-right"><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-foreground">{period(r.periodStart, r.periodEnd)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.netCents)}</TableCell>
                  <TableCell><StatusChip tone={r.status === "paid" ? "good" : "info"}>{r.status === "paid" ? `Paid ${r.paidOn ? dayMonth(r.paidOn) : ""}`.trim() : "Published"}</StatusChip></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setOpen(r.id)}>Open</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {open ? <Statement key={open} id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
