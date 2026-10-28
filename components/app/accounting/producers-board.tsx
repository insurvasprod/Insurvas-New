"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { Sheet } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { PAID_METHODS, PAID_METHOD_LABELS } from "@/lib/accounting/invoicesCore";
import { BASIS_LABELS, NEGATIVE_POLICY_LABELS, PAYS_ON_LABELS, PRODUCER_ENTRY_LABELS, percent, type Basis, type NegativePolicy, type PaysOn, type ProducerEntry, type ProducerRun } from "@/lib/accounting/producersCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";
import { fieldLabel } from "@/components/ui/field";

/**
 * LA-7.5 · what each producer is owed from the commission the agency received — and, when their
 * chargebacks outrun their sales, what they owe back. A negative balance is shown, never hidden or
 * reset; writing it off is an explicit decision with a reason.
 */
type Person = { userId: string; name: string; role: string; balanceCents: number; owedCents: number; clawedBackCents: number; paidCents: number };
type Split = { id: string; producerUserId: string; carrierId: string | null; productCode: string | null; splitPctBp: number; basis: Basis; paysOn: PaysOn; effectiveFrom: string };
type Run = ProducerRun & { producerUserId: string };
type Overview = { people: Person[]; splits: Split[]; runs: Run[]; carriers: { id: string; name: string }[]; settings: { negativePolicy: string; recoveryCapBp: number; defaultSplitBp: number | null; defaultBasis: Basis } };

const money = (c: number) => formatCentsAsCurrency(c);
const TONE: Record<ProducerRun["status"], StatusTone> = { draft: "warning", published: "info", paid: "good", void: "neutral" };
const lastMonth = () => {
  const now = new Date();
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10) };
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}

function SplitDialog({ person, carriers, defaults, onClose, onSaved }: { person: Person; carriers: Overview["carriers"]; defaults: Overview["settings"]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ pct: defaults.defaultSplitBp != null ? String(defaults.defaultSplitBp / 100) : "", carrier: "", product: "", basis: defaults.defaultBasis as Basis, paysOn: "advance_received" as PaysOn, from: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(f.pct.trim());
    const bp = m ? Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2)) : NaN;
    if (!Number.isInteger(bp) || bp < 0 || bp > 10000) { setError("A percentage from 0 to 100."); return; }
    setBusy(true);
    setError(null);
    try {
      await post("/api/app/accounting/producers", { op: "add_split", producer_user_id: person.userId, carrier_id: f.carrier || null, product_code: f.product || null, split_pct_bp: bp, basis: f.basis, pays_on: f.paysOn, effective_from: f.from });
      notify.done("Split saved — from its date forward; past entries keep their rate");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  // The shared stacked label (foundation v3: 13/500 over the control).
  const field = fieldLabel;
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>Split for {person.name}</DialogTitle><DialogDescription>Applies from its date; what was already recorded keeps the rate it was recorded at.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>Share (%)<input className={toolbarControl} required inputMode="decimal" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></label>
            <label className={field}>From<input type="date" className={toolbarControl} required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <label className={field}>Carrier<select className={toolbarControl} value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })}><option value="">All carriers</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className={field}>Product code<input className={toolbarControl} placeholder="All products" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></label>
            <label className={field}>Of<select className={toolbarControl} value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as Basis })}>{(Object.keys(BASIS_LABELS) as Basis[]).map((k) => <option key={k} value={k}>{BASIS_LABELS[k]}</option>)}</select></label>
            <label className={field}>Owed<select className={toolbarControl} value={f.paysOn} onChange={(e) => setF({ ...f, paysOn: e.target.value as PaysOn })}>{(Object.keys(PAYS_ON_LABELS) as PaysOn[]).map((k) => <option key={k} value={k}>{PAYS_ON_LABELS[k]}</option>)}</select></label>
          </div>
          {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save split"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PersonPanel({ person, splits, carriers, readOnly, onClose, onChanged }: { person: Person; splits: Split[]; carriers: Overview["carriers"]; readOnly: boolean; onClose: () => void; onChanged: () => void }) {
  const [entries, setEntries] = useState<ProducerEntry[] | null>(null);
  const [writeOff, setWriteOff] = useState<string | null>(null);
  const [run, setRun] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/app/accounting/producers?producer=${person.userId}`).then(async (res) => { const body = await res.json().catch(() => null); if (live && res.ok) setEntries(body.entries); });
    return () => { live = false; };
  }, [person.userId]);
  const carrier = (id: string | null) => (id ? carriers.find((c) => c.id === id)?.name ?? "Carrier" : "All carriers");
  const act = async (body: unknown, done: string) => {
    setBusy(true);
    try {
      await post("/api/app/accounting/producers", body);
      notify.done(done);
      setWriteOff(null);
      setRun(null);
      onChanged();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={person.name} subtitle={`Balance ${money(person.balanceCents)}${person.balanceCents < 0 ? " — owes the agency" : ""}`} onClose={onClose}
      footer={readOnly ? undefined : <div className="flex flex-wrap gap-2"><Button onClick={() => setRun(lastMonth())}>Draft a run</Button>{person.balanceCents < 0 ? <Button variant="outline" onClick={() => setWriteOff("")}>Write off the balance</Button> : null}</div>}>
      {run ? (
        <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">From<input type="date" className={toolbarControl} value={run.from} onChange={(e) => setRun({ ...run, from: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm">To<input type="date" className={toolbarControl} value={run.to} onChange={(e) => setRun({ ...run, to: e.target.value })} /></label>
          <div className="flex items-end gap-2"><Button disabled={busy} onClick={() => void act({ op: "build_run", producer_user_id: person.userId, period_start: run.from, period_end: run.to }, "Draft run built")}>Build</Button><Button variant="outline" onClick={() => setRun(null)}>Cancel</Button></div>
        </div>
      ) : null}
      {writeOff !== null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <label className="flex flex-col gap-1 text-sm">Why is the agency absorbing {money(-person.balanceCents)}?<input className={toolbarControl} value={writeOff} onChange={(e) => setWriteOff(e.target.value)} autoFocus /></label>
          <p className="text-xs text-muted-foreground">Recorded as an adjustment with your name and this reason. It is not undone by a later run.</p>
          <div className="flex gap-2"><Button disabled={busy || !writeOff.trim()} onClick={() => void act({ op: "write_off", producer_user_id: person.userId, reason: writeOff }, "Written off")}>Write off</Button><Button variant="outline" onClick={() => setWriteOff(null)}>Cancel</Button></div>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Splits</h3>
        {splits.length === 0 ? <p className="text-sm text-[var(--warning-ink)]">No split recorded: nothing is owed until one is.</p> : (
          <ul className="text-sm">{splits.map((s) => <li key={s.id}>From {s.effectiveFrom}: {percent(s.splitPctBp)} — {BASIS_LABELS[s.basis].toLowerCase()}, {carrier(s.carrierId)}{s.productCode ? `, ${s.productCode}` : ""} · {PAYS_ON_LABELS[s.paysOn].toLowerCase()}</li>)}</ul>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Entries</h3>
        {entries === null ? <SectionLoading rows={4} columns={3} /> : entries.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <table className="w-full text-left text-sm"><tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-border"><td className="py-1 whitespace-nowrap">{e.occurredOn}</td><td>{PRODUCER_ENTRY_LABELS[e.entryType] ?? e.entryType}{e.policyNumber ? ` · ${e.policyNumber}` : ""}{e.splitPctBpApplied != null ? <span className="text-xs text-muted-foreground"> · {percent(e.splitPctBpApplied)}</span> : null}{e.reason ? <div className="text-xs text-muted-foreground">{e.reason}</div> : null}</td><td className={`text-right tabular-nums ${e.amountCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(e.amountCents)}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </Sheet>
  );
}

export function ProducersBoard({ data, readOnly }: { data: Overview; readOnly: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<Person | null>(null);
  const [splitFor, setSplitFor] = useState<Person | null>(null);
  const [acting, setActing] = useState<{ run: Run; kind: "paid" | "void"; on: string; method: string; reason: string } | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const name = (id: string) => data.people.find((p) => p.userId === id)?.name ?? "Producer";
  const current = (id: string) => data.splits.find((s) => s.producerUserId === id && !s.carrierId && !s.productCode && s.effectiveFrom <= new Date().toISOString().slice(0, 10));
  const owed = data.people.filter((p) => p.balanceCents > 0).reduce((s, p) => s + p.balanceCents, 0);
  const owing = data.people.filter((p) => p.balanceCents < 0).reduce((s, p) => s + p.balanceCents, 0);
  const runAct = async (run: Run, body: Record<string, unknown>, done: string) => {
    try {
      await post(`/api/app/accounting/producer-runs/${run.id}`, body);
      notify.done(done);
      setActing(null);
      refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    }
  };
  return (
    <>
      <StatStrip label="Producer balances">
        <StatTile label="Owed to producers" value={money(owed)} footnote="positive balances" />
        <StatTile label="Owed by producers" value={money(-owing)} valueTone={owing ? "warning" : undefined} footnote="chargebacks beyond earnings" />
        <StatTile label="Runs to publish" value={String(data.runs.filter((r) => r.status === "draft").length)} footnote="drafts" />
      </StatStrip>
      <p className="text-sm text-muted-foreground">Negative balances: {NEGATIVE_POLICY_LABELS[data.settings.negativePolicy as NegativePolicy] ?? data.settings.negativePolicy}{data.settings.negativePolicy === "cap" ? ` (at most ${percent(data.settings.recoveryCapBp)} of each payout)` : ""}. <Link className="underline" href="/app/accounting-settings">Change</Link></p>
      <TableCard toolbar={<DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}><span className="text-sm font-semibold">Producers</span></DataToolbar>}>
        {data.people.length === 0 ? <EmptyState title="No producers" hint="Producer splits are for agencies: once producers join, record each one's split here." /> : (
          <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
            <thead><tr><th>Producer</th><th className="w-[160px]">Split</th><th className="w-[130px] text-right">Owed to date</th><th className="w-[130px] text-right">Clawed back</th><th className="w-[130px] text-right">Balance</th><th className="w-[200px] text-right" /></tr></thead>
            <tbody>
              {data.people.map((p) => {
                const s = current(p.userId);
                return (
                  <tr key={p.userId}>
                    <td className="font-medium">{p.name}</td>
                    <td>{s ? `${percent(s.splitPctBp)} of ${s.basis === "both" ? "advance + earned" : s.basis}` : <span className="text-muted-foreground">None</span>}</td>
                    <td className="text-right tabular-nums">{money(p.owedCents)}</td>
                    <td className="text-right tabular-nums">{money(p.clawedBackCents)}</td>
                    <td className={`text-right tabular-nums font-medium ${p.balanceCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(p.balanceCents)}</td>
                    <td className="text-right"><span className="inline-flex gap-1">{!readOnly ? <Button size="sm" variant="outline" onClick={() => setSplitFor(p)}>Set split</Button> : null}<Button size="sm" variant="outline" onClick={() => setOpen(p)}>Open</Button></span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
      <TableCard toolbar={<DataToolbar><span className="text-sm font-semibold">Payout runs</span></DataToolbar>}>
        {data.runs.length === 0 ? <EmptyState title="No producer runs yet" hint="Open a producer and draft a run for a period." /> : (
          <table className="portal-lead-table w-full min-w-[920px] text-left text-sm">
            <thead><tr><th>Producer</th><th className="w-[200px]">Period</th><th className="text-right">Earned</th><th className="text-right">Clawed back</th><th className="text-right">Withheld</th><th className="text-right">Net payable</th><th className="w-[150px]">Status</th><th className="w-[220px] text-right" /></tr></thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id}>
                  <td>{name(r.producerUserId)}</td>
                  <td>{r.periodStart} to {r.periodEnd}</td>
                  <td className="text-right tabular-nums">{money(r.earnedCents)}</td>
                  <td className="text-right tabular-nums">{money(r.clawedBackCents)}</td>
                  <td className="text-right tabular-nums">{money(r.withheldCents)}</td>
                  <td className="text-right tabular-nums font-medium">{money(r.netCents)}</td>
                  <td><StatusChip tone={TONE[r.status]}>{r.status}{r.paidOn ? ` ${r.paidOn}` : ""}</StatusChip></td>
                  <td className="text-right">
                    {readOnly ? null : acting?.run.id === r.id ? (
                      <span className="inline-flex gap-1">
                        {acting.kind === "paid" ? <><input aria-label="Paid on" type="date" className={toolbarControl} value={acting.on} onChange={(e) => setActing({ ...acting, on: e.target.value })} /><select aria-label="Method" className={toolbarControl} value={acting.method} onChange={(e) => setActing({ ...acting, method: e.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select><Button size="sm" onClick={() => void runAct(r, { action: "paid", paid_on: acting.on, method: acting.method, reference: null }, "Marked paid")}>Save</Button></>
                          : <><input aria-label="Why" className={`${toolbarControl} w-32`} placeholder="Why?" value={acting.reason} onChange={(e) => setActing({ ...acting, reason: e.target.value })} /><Button size="sm" disabled={!acting.reason.trim()} onClick={() => void runAct(r, { action: "void", reason: acting.reason }, "Voided")}>Void</Button></>}
                        <Button size="sm" variant="ghost" onClick={() => setActing(null)}>×</Button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-1">
                        {r.status === "draft" ? <Button size="sm" onClick={() => void runAct(r, { action: "publish" }, "Published: the cost is booked")}>Publish</Button> : null}
                        {r.status === "published" && r.netCents > 0 ? <Button size="sm" variant="outline" onClick={() => setActing({ run: r, kind: "paid", on: new Date().toISOString().slice(0, 10), method: "ach", reason: "" })}>Mark paid</Button> : null}
                        {r.status !== "void" ? <Button size="sm" variant="outline" onClick={() => setActing({ run: r, kind: "void", on: "", method: "", reason: "" })}>Void</Button> : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {open ? <PersonPanel key={open.userId} person={open} splits={data.splits.filter((s) => s.producerUserId === open.userId)} carriers={data.carriers} readOnly={readOnly} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); refresh(); }} /> : null}
      {splitFor ? <SplitDialog person={splitFor} carriers={data.carriers} defaults={data.settings} onClose={() => setSplitFor(null)} onSaved={() => { setSplitFor(null); refresh(); }} /> : null}
    </>
  );
}
