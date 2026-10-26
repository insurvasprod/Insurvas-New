"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { PAID_METHOD_LABELS, PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { ITEM_LABELS, RUN_STATUS_LABELS, type RunDispute, type RunHeader, type RunItem, type RunStatus, type StatementLine, type PartnerStatement } from "@/lib/accounting/payoutsCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.4 · what each partner is owed, itemised, from the terms on file. The agency reviews a draft —
 * disputing any item it disagrees with — then publishes it, and the partner reads the same statement
 * in its portal. Nothing here moves money: the agency pays as it does today and records it.
 */
type Partner = { id: string; name: string; status: string };
type RunRow = RunHeader & { partnerName: string };
type RunDetail = RunHeader & { partnerName: string; paidMethod: string | null; paymentReference: string | null; voidReason: string | null; terms: { id: string; payout_model: string; rate_cents: number | null; rate_pct_bp: number | null; effective_from: string }[]; lines: StatementLine[]; items: RunItem[]; disputes: RunDispute[]; partnerView: PartnerStatement | null };

const TONE: Record<RunStatus, StatusTone> = { draft: "warning", published: "info", paid: "good", void: "neutral" };
const money = (c: number) => formatCentsAsCurrency(c);
const MODEL: Record<string, string> = { per_transfer: "per transfer", per_lead: "per lead", per_sale: "per sale", per_issued_policy: "per issued policy", revenue_share: "revenue share" };
const lastMonth = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
};

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}

function NewRun({ partners, onClose, onSaved }: { partners: Partner[]; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState(() => ({ partner: partners[0]?.id ?? "", ...lastMonth() }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = await send("/api/app/accounting/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partner_id: f.partner, period_start: f.from, period_end: f.to }) });
      notify.done("Draft run built");
      onSaved(body.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Draft a payout run</DialogTitle>
            <DialogDescription>Priced from the partner&apos;s terms, each item by the rate in force on its own date. Only you see a draft.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">Partner<select className={toolbarControl} required value={f.partner} onChange={(e) => setF({ ...f, partner: e.target.value })}>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">From<input type="date" className={toolbarControl} required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-sm">To<input type="date" className={toolbarControl} required value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          </div>
          {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !f.partner}>{busy ? "Building…" : "Build draft"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RunPanel({ id, readOnly, docked = false, onClose, onChanged }: { id: string; readOnly: boolean; docked?: boolean; onClose: () => void; onChanged: () => void }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showItems, setShowItems] = useState(false);
  const [disputing, setDisputing] = useState<{ itemId: string; reason: string } | null>(null);
  const [resolving, setResolving] = useState<{ id: string; status: "accepted" | "upheld"; note: string } | null>(null);
  const [paying, setPaying] = useState<{ on: string; method: string; reference: string } | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/app/accounting/payouts/${id}`).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) setError(body?.error ?? "Could not open the run");
      else setRun(body.run);
    });
    return () => { live = false; };
  }, [id]);
  const act = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      const body = await send(`/api/app/accounting/payouts/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setRun(body.run);
      setDisputing(null);
      setResolving(null);
      setPaying(null);
      setVoiding(null);
      notify.done(done);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const section = "flex flex-col gap-2 border-t border-border pt-4";
  const disputedItem = (itemId: string) => run?.disputes.find((d) => d.itemId === itemId);
  return (
    <DetailPanel
      mode={docked ? "split" : "overlay"}
      splitFrom="xl"
      title={run ? `${run.partnerName} · ${run.periodStart} to ${run.periodEnd}` : "Payout run"}
      subtitle={run ? `Net payable ${money(run.netCents)}` : undefined}
      status={run ? <StatusChip tone={TONE[run.status]}>{RUN_STATUS_LABELS[run.status]}{run.paidOn ? ` ${run.paidOn}` : ""}</StatusChip> : undefined}
      onClose={onClose}
      footer={run && !readOnly ? (
        <div className="flex flex-wrap gap-2">
          {run.status === "draft" ? <Button disabled={busy} onClick={() => void act({ action: "publish" }, "Published: the partner can now see it, and the cost is booked")}>Publish to the partner</Button> : null}
          {run.status === "published" ? <Button disabled={busy} onClick={() => setPaying({ on: new Date().toISOString().slice(0, 10), method: "ach", reference: "" })}>Mark paid</Button> : null}
          {run.status !== "void" ? <Button variant="outline" disabled={busy} onClick={() => setVoiding("")}>Void</Button> : null}
          {run.status !== "void" ? <a className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm" href={`/api/app/accounting/payouts/${run.id}/statement`}>Download statement</a> : null}
        </div>
      ) : undefined}
    >
      {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
      {!run ? null : (
        <>
          {paying ? (
            <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm">Paid on<input type="date" className={toolbarControl} value={paying.on} onChange={(e) => setPaying({ ...paying, on: e.target.value })} /></label>
              <label className="flex flex-col gap-1 text-sm">Method<select className={toolbarControl} value={paying.method} onChange={(e) => setPaying({ ...paying, method: e.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-sm">Reference<input className={toolbarControl} value={paying.reference} onChange={(e) => setPaying({ ...paying, reference: e.target.value })} /></label>
              <div className="flex gap-2 sm:col-span-3"><Button disabled={busy} onClick={() => void act({ action: "paid", paid_on: paying.on, method: paying.method, reference: paying.reference || null }, "Marked paid")}>Record payment</Button><Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button></div>
            </div>
          ) : null}
          {voiding !== null ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <label className="flex flex-col gap-1 text-sm">Why is it void?<input className={toolbarControl} value={voiding} onChange={(e) => setVoiding(e.target.value)} autoFocus /></label>
              <div className="flex gap-2"><Button disabled={busy || !voiding.trim()} onClick={() => void act({ action: "void", reason: voiding }, "Voided")}>Void run</Button><Button variant="outline" onClick={() => setVoiding(null)}>Cancel</Button></div>
            </div>
          ) : null}
          {run.status === "draft" ? <p className="rounded-md border border-[var(--warning)] bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">A draft. The partner sees nothing until you publish it.</p> : null}

          <div className={section}>
            <h3 className="text-sm font-semibold">Statement</h3>
            <table className="w-full text-left text-sm">
              <tbody>
                {run.lines.filter((l) => l.itemType !== "rejected" && l.itemType !== "credit").map((l) => (
                  <tr key={`${l.itemType}-${l.rateCents}`} className="border-t border-border">
                    <td className="py-1">{l.label}</td>
                    <td className="text-right">{l.itemType === "revenue_share" ? "" : l.count}</td>
                    <td className="text-right text-muted-foreground">{l.rateCents != null ? `@ ${money(l.rateCents)}` : ""}</td>
                    <td className="text-right tabular-nums">{money(l.amountCents)}</td>
                  </tr>
                ))}
                {run.partnerView?.rejectedCount ? <tr className="border-t border-border"><td className="py-1">{ITEM_LABELS.rejected}</td><td className="text-right">{run.partnerView.rejectedCount}</td><td /><td className="text-right text-muted-foreground">—</td></tr> : null}
                {run.partnerView?.credits.count ? <tr className="border-t border-border"><td className="py-1">{ITEM_LABELS.credit} ({run.partnerView.credits.count})</td><td /><td /><td className="text-right tabular-nums">{money(run.partnerView.credits.amountCents)}</td></tr> : null}
                {run.disputes.filter((d) => d.side === "agent").map((d) => (
                  <tr key={d.id} className="border-t border-border"><td className="py-1">Disputed — {d.reason}<span className="text-xs text-muted-foreground"> · {d.status}</span></td><td /><td /><td className="text-right tabular-nums">{money(-d.claimCents)}</td></tr>
                ))}
                <tr className="border-t-2 border-border font-semibold"><td className="pt-2">Net payable</td><td /><td /><td className="pt-2 text-right tabular-nums">{money(run.netCents)}</td></tr>
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">The partner sees transfers rejected at the compliance gate as a count only, and never a commission figure.</p>
          </div>

          <div className={section}>
            <h3 className="text-sm font-semibold">Disputes</h3>
            {run.disputes.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : run.disputes.map((d) => (
              <div key={d.id} className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm">
                <div className="flex justify-between gap-2"><span>{d.side === "partner" ? "Raised by the partner" : "Raised by you"}: {d.reason}</span><span className="tabular-nums">{money(d.claimCents)}</span></div>
                <div className="text-xs text-muted-foreground">{d.status === "open" ? "Open" : `${d.status === "accepted" ? "Accepted — paid on the next run" : d.status === "void" ? "Void — its run was voided; nothing carried" : "Upheld — stays deducted"}: ${d.resolutionNote}`}{d.carriedToRunId ? " · carried" : ""}</div>
                {d.status === "open" && !readOnly && run.status === "draft" ? <div className="text-xs text-muted-foreground">Resolved once the run is published.</div> : null}
                {d.status === "open" && !readOnly && (run.status === "published" || run.status === "paid") ? (resolving?.id === d.id ? (
                  <div className="flex flex-wrap gap-2">
                    <select aria-label="Resolution" className={toolbarControl} value={resolving.status} onChange={(e) => setResolving({ ...resolving, status: e.target.value as "accepted" | "upheld" })}><option value="accepted">Accept</option><option value="upheld">Uphold</option></select>
                    <input aria-label="Why" className={`${toolbarControl} flex-1`} placeholder="Why" value={resolving.note} onChange={(e) => setResolving({ ...resolving, note: e.target.value })} />
                    <Button size="sm" disabled={busy || !resolving.note.trim()} onClick={() => void act({ action: "resolve", dispute_id: d.id, status: resolving.status, note: resolving.note }, "Dispute resolved")}>Save</Button>
                  </div>
                ) : <Button size="sm" variant="outline" className="self-start" onClick={() => setResolving({ id: d.id, status: "accepted", note: "" })}>Resolve</Button>) : null}
              </div>
            ))}
          </div>

          <div className={section}>
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Items ({run.items.length})</h3><Button size="sm" variant="ghost" onClick={() => setShowItems((v) => !v)}>{showItems ? "Hide" : "Show"}</Button></div>
            {showItems ? (
              <table className="w-full text-left text-sm">
                <tbody>
                  {run.items.map((i) => {
                    const d = disputedItem(i.id);
                    const billable = ["transfer", "lead", "sale", "issued_policy", "revenue_share", "adjustment"].includes(i.itemType);
                    return (
                      <tr key={i.id} className="border-t border-border align-top">
                        <td className="py-1 whitespace-nowrap">{i.occurredOn}</td>
                        <td>{ITEM_LABELS[i.itemType]}{i.note ? <span className="text-xs text-muted-foreground"> · {i.note}</span> : null}{d ? <span className="text-xs text-[var(--warning-ink)]"> · disputed</span> : null}
                          {disputing?.itemId === i.id ? (
                            <div className="mt-1 flex gap-1"><input aria-label="Reason" className={`${toolbarControl} flex-1`} placeholder="e.g. wrong number" value={disputing.reason} onChange={(e) => setDisputing({ itemId: i.id, reason: e.target.value })} /><Button size="sm" disabled={busy || !disputing.reason.trim()} onClick={() => void act({ action: "dispute", item_id: i.id, reason: disputing.reason }, "Disputed: withheld from this run")}>Dispute</Button></div>
                          ) : null}
                        </td>
                        <td className="text-right tabular-nums">{money(i.amountCents)}</td>
                        <td className="w-[84px] text-right">{run.status === "draft" && billable && !d && !readOnly && disputing?.itemId !== i.id ? <Button size="sm" variant="ghost" onClick={() => setDisputing({ itemId: i.id, reason: "" })}>Dispute</Button> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </div>

          <div className={section}>
            <h3 className="text-sm font-semibold">Terms applied</h3>
            <ul className="text-sm">{run.terms.map((t) => <li key={t.id}>From {t.effective_from}: {t.payout_model === "revenue_share" ? `${(t.rate_pct_bp ?? 0) / 100}% revenue share` : `${money(t.rate_cents ?? 0)} ${MODEL[t.payout_model] ?? t.payout_model}`}</li>)}</ul>
            <p className="text-xs text-muted-foreground">Frozen when the run was built: changing the partner&apos;s terms later does not change this run.</p>
          </div>
        </>
      )}
    </DetailPanel>
  );
}

/** `partnerFixed`: the Payouts tab of one partner's record (2026-10-25) — its runs only, no partner picker. */
/** `recordLinks`: the partner's name opens its record on the Payouts tab (2026-10-25). */
export function PayoutsBoard({ runs, partners, readOnly, openId, partnerFixed = false, recordLinks = false }: { runs: RunRow[]; partners: Partner[]; readOnly: boolean; openId: string | null; partnerFixed?: boolean; recordLinks?: boolean }) {
  const router = useRouter();
  const [partner, setPartner] = useState(partnerFixed ? partners[0]?.id ?? "" : "");
  const [status, setStatus] = useState<"" | RunStatus>("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(openId);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const visible = useMemo(() => runs.filter((r) => (!partner || r.partnerId === partner) && (!status || r.status === status)), [runs, partner, status]);
  const shown = paginate(visible, page, 15);
  const month = new Date().toISOString().slice(0, 7);
  const drafts = runs.filter((r) => r.status === "draft");
  const owed = runs.filter((r) => r.status === "published");
  const paid = runs.filter((r) => r.status === "paid" && (r.paidOn ?? "").startsWith(month));
  return (
    <>
      {/* Payout runs A5 (2026-10-25): three glass tiles, the run docked beside the table. */}
      <section aria-label="Payout totals" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile className="m-glass rounded-xl border border-border" label="Drafts to review" value={String(drafts.length)} valueTone={drafts.length ? "warning" : undefined} footnote="the partner cannot see these" />
        <StatTile className="m-glass rounded-xl border border-border" label="Published, unpaid" value={money(owed.reduce((s, r) => s + r.netCents, 0))} footnote={`${owed.length} run${owed.length === 1 ? "" : "s"} owed`} />
        <StatTile className="m-glass rounded-xl border border-border" label="Paid this month" value={money(paid.reduce((s, r) => s + r.netCents, 0))} footnote={`${paid.length} run${paid.length === 1 ? "" : "s"}`} />
      </section>
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start">
      <TableCard
        className="min-w-0 flex-1"
        toolbar={
          <DataToolbar actions={<>{!readOnly && partners.length ? <Button onClick={() => setCreating(true)}>Draft a run</Button> : null}<RefreshButton onClick={refresh} refreshing={refreshing} /></>}>
            {!partnerFixed && <select aria-label="Partner" className={toolbarControl} value={partner} onChange={(e) => { setPartner(e.target.value); setPage(1); }}><option value="">All partners</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
            <select aria-label="Status" className={toolbarControl} value={status} onChange={(e) => { setStatus(e.target.value as "" | RunStatus); setPage(1); }}><option value="">Any status</option>{(["draft", "published", "paid", "void"] as RunStatus[]).map((s) => <option key={s} value={s}>{RUN_STATUS_LABELS[s]}</option>)}</select>
          </DataToolbar>
        }
        footer={visible.length > 15 ? <Pager page={shown.current} pageSize={15} total={visible.length} noun="runs" onPage={setPage} /> : undefined}
      >
        {runs.length === 0 ? (
          <EmptyState title="No payout runs yet" hint={partners.length ? "Draft one for a partner and a month: it is priced from the terms on the partner's record." : "Add a partner with payout terms first."} action={!readOnly && partners.length ? <Button onClick={() => setCreating(true)}>Draft a run</Button> : undefined} />
        ) : visible.length === 0 ? (
          <NoMatches noun="runs" onClear={() => { setPartner(""); setStatus(""); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th>Partner</th><th className="w-[220px]">Period</th><th className="w-[140px] text-right">Net payable</th><th className="w-[170px]">Status</th><th className="w-[90px] text-right" /></tr></thead>
            <tbody>
              {shown.rows.map((r) => (
                <tr key={r.id} className={open === r.id ? "bg-[var(--primary-soft)]" : undefined}>
                  <td className="font-medium">{recordLinks && !partnerFixed ? <Link href={`/app/publishers/${r.partnerId}?tab=payouts`} className="text-foreground underline-offset-4 hover:underline">{r.partnerName}</Link> : r.partnerName}</td>
                  <td>{r.periodStart} to {r.periodEnd}</td>
                  <td className="text-right tabular-nums">{money(r.netCents)}</td>
                  <td><StatusChip tone={TONE[r.status]}>{RUN_STATUS_LABELS[r.status]}{r.paidOn ? ` ${r.paidOn}` : ""}</StatusChip></td>
                  <td className="text-right"><Button size="sm" variant="outline" onClick={() => setOpen(r.id)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {open ? <RunPanel key={open} id={open} readOnly={readOnly} docked={!partnerFixed} onClose={() => setOpen(null)} onChanged={refresh} /> : null}
      </div>
      {creating ? <NewRun partners={partners.filter((p) => p.status !== "offboarded")} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); setOpen(id); refresh(); }} /> : null}
    </>
  );
}
