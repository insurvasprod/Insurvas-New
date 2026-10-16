"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import type { PartnerStatement } from "@/lib/accounting/payoutsCore";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.4 · the partner's own statements, in the portal it already logs into: it arrives at the
 * month's conversation already knowing the number, and disputes the one line it disagrees with.
 * Only what partnerStatement() whitelists reaches this screen.
 */
type RunRow = { id: string; periodStart: string; periodEnd: string; status: "published" | "paid"; netCents: number; paidOn: string | null };
const money = (c: number) => formatCentsAsCurrency(c);

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
    <DetailPanel mode="overlay" title={s ? `Statement ${s.periodStart} to ${s.periodEnd}` : "Statement"} subtitle={s ? `Net payable ${money(s.totals.netCents)}` : undefined}
      status={s ? <StatusChip tone={s.status === "paid" ? "good" : "info"}>{s.status === "paid" ? `Paid ${s.paidOn ?? ""}` : "Published"}</StatusChip> : undefined} onClose={onClose}
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
                  <tr key={i.id} className="border-t border-border"><td className="py-1 whitespace-nowrap">{i.occurredOn}</td><td>{i.label}{i.reference ? <span className="text-xs text-muted-foreground"> · ref {i.reference}</span> : null}{i.disputed ? <span className="text-xs text-[var(--warning-ink)]"> · disputed</span> : null}</td><td className="text-right tabular-nums">{money(i.amountCents)}</td><td className="w-[84px] text-right">{!i.disputed && !dispute ? <Button size="sm" variant="ghost" onClick={() => setDispute({ itemId: i.id, reason: "", amount: "" })}>Dispute</Button> : null}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DetailPanel>
  );
}

export function PartnerPayouts() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/partner/payouts").then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) setError(body?.error ?? "Statements could not be loaded");
      else setRuns(body.runs);
    });
    return () => { live = false; };
  }, []);
  return (
    <>
      <TableCard>
        {error ? <EmptyState title="Statements are not available" hint={error} /> : runs === null ? <SectionLoading rows={4} columns={4} /> : runs.length === 0 ? (
          <EmptyState title="No statements yet" hint="When the agency publishes a payout statement for you, it appears here." />
        ) : (
          <table className="portal-lead-table w-full min-w-[600px] text-left text-sm">
            <thead><tr><th>Period</th><th className="w-[160px] text-right">Net payable</th><th className="w-[160px]">Status</th><th className="w-[90px] text-right" /></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}><td>{r.periodStart} to {r.periodEnd}</td><td className="text-right tabular-nums">{money(r.netCents)}</td><td><StatusChip tone={r.status === "paid" ? "good" : "info"}>{r.status === "paid" ? `Paid ${r.paidOn ?? ""}` : "Published"}</StatusChip></td><td className="text-right"><Button size="sm" variant="outline" onClick={() => setOpen(r.id)}>Open</Button></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {open ? <Statement key={open} id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
