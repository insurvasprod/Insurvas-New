"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Field, control } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { PAID_METHODS, PAID_METHOD_LABELS } from "@/lib/accounting/invoicesCore";
import { BASIS_LABELS, PAYS_ON_LABELS, percent, type Basis, type PaysOn, type ProducerRun } from "@/lib/accounting/producersCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.5 · what each producer is owed from the commission the agency received — and, when their
 * chargebacks outrun their sales, what they owe back. A negative balance is shown, never hidden or
 * reset; writing it off is an explicit decision with a reason.
 *
 * Foundation pass (2026-11-03): Producers · Payout runs are the step's tabs on the title line (`?view=runs`);
 * a producer opens as a detail page (/app/producer-splits/[userId], Entries · Splits · Payout runs), never a
 * side sheet; drafting a run, writing off, marking paid and voiding are confirm pop-ups.
 */
export type Person = { userId: string; name: string; role: string; balanceCents: number; owedCents: number; clawedBackCents: number; paidCents: number };
export type Split = { id: string; producerUserId: string; carrierId: string | null; productCode: string | null; splitPctBp: number; basis: Basis; paysOn: PaysOn; effectiveFrom: string };
export type Run = ProducerRun & { producerUserId: string };
type Overview = { people: Person[]; splits: Split[]; runs: Run[]; carriers: { id: string; name: string }[]; settings: { negativePolicy: string; recoveryCapBp: number; defaultSplitBp: number | null; defaultBasis: Basis } };
export type ProducersView = "producers" | "runs";

const money = (c: number) => formatCentsAsCurrency(c);
const today = () => new Date().toISOString().slice(0, 10);
const RUN_TONE: Record<ProducerRun["status"], StatusTone> = { draft: "warning", published: "info", paid: "good", void: "neutral" };
const RUN_STATUS: Record<ProducerRun["status"], string> = { draft: "Draft", published: "Published", paid: "Paid", void: "Void" };
const lastMonth = () => {
  const now = new Date();
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10) };
};
/** The producer's split on every carrier and product, in force today. */
const currentSplit = (splits: Split[], userId: string) => splits.find((s) => s.producerUserId === userId && !s.carrierId && !s.productCode && s.effectiveFrom <= today());
const splitText = (s: Split | undefined) => (s ? `${percent(s.splitPctBp)} of ${s.basis === "both" ? "advance + earned" : s.basis}` : "No split");

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}

/** A run's own action in its row: Publish a draft at once; Mark paid and Void ask first. */
export function RunActions({ run, readOnly }: { run: Run; readOnly: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState<{ kind: "paid" | "void"; on: string; method: string; reference: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (readOnly) return null;
  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await post(`/api/app/accounting/producer-runs/${run.id}`, body);
      notify.done(done);
      setAsking(null);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {run.status === "draft" ? <Button size="sm" disabled={busy} onClick={() => void act({ action: "publish" }, "Published: the cost is booked")}>Publish</Button> : null}
      {run.status === "published" && run.netCents > 0 ? <Button size="sm" variant="outline" onClick={() => setAsking({ kind: "paid", on: today(), method: "ach", reference: "", reason: "" })}>Mark paid</Button> : null}
      <MoreMenu row label="More for this run" items={[run.status !== "void" && { label: "Void the run", onSelect: () => setAsking({ kind: "void", on: "", method: "", reference: "", reason: "" }) }]} />
      {asking ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => { if (!next) setAsking(null); }}
          busy={busy}
          destructive={asking.kind === "void"}
          title={asking.kind === "void" ? `Void the run for ${run.periodStart} to ${run.periodEnd}?` : `Mark ${money(run.netCents)} paid?`}
          description={asking.kind === "void" ? "Its entries are reversed; the run stays on record." : "Records when the money moved. Nothing is paid from here."}
          confirmLabel={asking.kind === "void" ? "Void run" : "Mark paid"}
          cancelLabel="Keep it"
          confirmDisabled={asking.kind === "void" ? !asking.reason.trim() : !asking.on}
          onConfirm={() => void act(asking.kind === "void" ? { action: "void", reason: asking.reason } : { action: "paid", paid_on: asking.on, method: asking.method, reference: asking.reference.trim() || null }, asking.kind === "void" ? "Voided" : "Marked paid")}
          fields={asking.kind === "void" ? (
            <Field label="Why?" htmlFor="run-why"><input id="run-why" className={control} autoFocus value={asking.reason} onChange={(e) => setAsking({ ...asking, reason: e.target.value })} /></Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid on" htmlFor="run-paid-on"><input id="run-paid-on" type="date" className={control} value={asking.on} onChange={(e) => setAsking({ ...asking, on: e.target.value })} /></Field>
              <Field label="Method" htmlFor="run-method"><select id="run-method" className={control} value={asking.method} onChange={(e) => setAsking({ ...asking, method: e.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></Field>
              <Field label="Reference (optional)" htmlFor="run-ref" className="col-span-2"><input id="run-ref" className={control} maxLength={200} value={asking.reference} onChange={(e) => setAsking({ ...asking, reference: e.target.value })} /></Field>
            </div>
          )}
        />
      ) : null}
    </span>
  );
}

/** The runs table, on the list's Payout runs tab and on a producer's page. */
export function RunsTable({ runs, names, readOnly }: { runs: Run[]; names?: Record<string, string>; readOnly: boolean }) {
  const pageSize = useFittingPageSize(480, 45);
  const [page, setPage] = useState(1);
  const shown = paginate(runs, page, pageSize);
  return (
    <TableCard footer={runs.length > pageSize ? <Pager page={shown.current} total={runs.length} noun="runs" pageSize={pageSize} onPage={setPage} /> : undefined}>
      {runs.length === 0 ? <EmptyState title="No producer runs yet" hint="Open a producer and draft a run for a period." /> : (
        <table className="portal-lead-table w-full min-w-[920px] text-left text-sm">
          <thead><tr>{names ? <th>Producer</th> : null}<th className="w-[200px]">Period</th><th className="text-right">Earned</th><th className="text-right">Clawed back</th><th className="text-right">Withheld</th><th className="text-right">Net payable</th><th className="w-[150px]">Status</th><th className="w-[170px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {shown.rows.map((r) => (
              <tr key={r.id}>
                {names ? <td><Link className="font-medium hover:underline" href={`/app/producer-splits/${r.producerUserId}`}>{names[r.producerUserId] ?? "Producer"}</Link></td> : null}
                <td>{r.periodStart} to {r.periodEnd}</td>
                <td className="text-right tabular-nums">{money(r.earnedCents)}</td>
                <td className="text-right tabular-nums">{money(r.clawedBackCents)}</td>
                <td className="text-right tabular-nums">{money(r.withheldCents)}</td>
                <td className="text-right tabular-nums font-medium">{money(r.netCents)}</td>
                <td><StatusChip tone={RUN_TONE[r.status]}>{RUN_STATUS[r.status]}{r.paidOn ? ` ${r.paidOn}` : ""}</StatusChip></td>
                <td className="text-right"><RunActions run={r} readOnly={readOnly} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

export function ProducersBoard({ data, view, readOnly }: { data: Overview; view: ProducersView; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  const refresh = () => startRefresh(() => router.refresh());
  const needle = q.trim().toLowerCase();
  const people = data.people.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  const shown = paginate(people, page, pageSize);
  const owed = data.people.filter((p) => p.balanceCents > 0).reduce((s, p) => s + p.balanceCents, 0);
  const owing = data.people.filter((p) => p.balanceCents < 0).reduce((s, p) => s + p.balanceCents, 0);
  const drafts = data.runs.filter((r) => r.status === "draft").length;
  const names = Object.fromEntries(data.people.map((p) => [p.userId, p.name]));
  return (
    <>
      <StatStrip label="Producer balances">
        <StatTile label="Owed to producers" value={money(owed)} footnote="positive balances" href="/app/producer-splits" />
        <StatTile label="Owed by producers" value={money(-owing)} valueTone={owing ? "warning" : undefined} footnote="chargebacks beyond earnings" href="/app/producer-splits" />
        <StatTile label="Runs to publish" value={String(drafts)} footnote="drafts" href="/app/producer-splits?view=runs" />
      </StatStrip>
      {view === "runs" ? <RunsTable runs={data.runs} names={names} readOnly={readOnly} /> : (
        <TableCard
          toolbar={<DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}><ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search producers" /></DataToolbar>}
          footer={people.length > pageSize ? <Pager page={shown.current} total={people.length} noun="producers" pageSize={pageSize} onPage={setPage} /> : undefined}
        >
          {data.people.length === 0 ? <EmptyState title="No producers" hint="Producer splits are for agencies: once producers join, record each one's split here." />
            : people.length === 0 ? <NoMatches noun="producers" onClear={() => setQ("")} /> : (
            <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
              <thead><tr><th>Producer</th><th className="w-[180px]">Split</th><th className="w-[130px] text-right">Owed to date</th><th className="w-[130px] text-right">Clawed back</th><th className="w-[130px] text-right">Balance</th><th className="w-[90px] text-right"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {shown.rows.map((p) => {
                  const s = currentSplit(data.splits, p.userId);
                  return (
                    <tr key={p.userId}>
                      <td><Link className="font-medium hover:underline" href={`/app/producer-splits/${p.userId}`}>{p.name}</Link></td>
                      <td>{s ? splitText(s) : <span className="text-muted-foreground">None</span>}</td>
                      <td className="text-right tabular-nums">{money(p.owedCents)}</td>
                      <td className="text-right tabular-nums">{money(p.clawedBackCents)}</td>
                      <td className={`text-right tabular-nums font-medium ${p.balanceCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(p.balanceCents)}</td>
                      <td className="text-right"><Button size="sm" variant="outline" asChild><Link href={`/app/producer-splits/${p.userId}`}>Open</Link></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </TableCard>
      )}
    </>
  );
}

/** A producer page's header: Draft a run (the one primary) and, on a negative balance, More › Write off. */
export function ProducerActions({ person, readOnly }: { person: Person; readOnly: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState<{ kind: "run"; from: string; to: string } | { kind: "write_off"; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (readOnly) return null;
  const act = async (body: unknown, done: string) => {
    setBusy(true);
    try {
      await post("/api/app/accounting/producers", body);
      notify.done(done);
      setAsking(null);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <MoreMenu items={[person.balanceCents < 0 && { label: "Write off the balance", onSelect: () => setAsking({ kind: "write_off", reason: "" }) }]} />
      <Button onClick={() => setAsking({ kind: "run", ...lastMonth() })}>Draft a run</Button>
      {asking?.kind === "run" ? (
        <ConfirmDialog
          open onOpenChange={(next) => { if (!next) setAsking(null); }} busy={busy} destructive={false}
          title={`Draft a run for ${person.name}?`}
          description="A draft books nothing; publishing it does."
          confirmLabel="Draft run" cancelLabel="Not now"
          confirmDisabled={!asking.from || !asking.to || asking.to < asking.from}
          onConfirm={() => void act({ op: "build_run", producer_user_id: person.userId, period_start: asking.from, period_end: asking.to }, "Draft run built")}
          fields={<div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="run-from"><input id="run-from" type="date" className={control} value={asking.from} onChange={(e) => setAsking({ ...asking, from: e.target.value })} /></Field>
            <Field label="To" htmlFor="run-to"><input id="run-to" type="date" className={control} value={asking.to} onChange={(e) => setAsking({ ...asking, to: e.target.value })} /></Field>
          </div>}
        />
      ) : asking?.kind === "write_off" ? (
        <ConfirmDialog
          open onOpenChange={(next) => { if (!next) setAsking(null); }} busy={busy}
          title={`Write off ${money(-person.balanceCents)}?`}
          description="The agency absorbs it. It is recorded as an adjustment with your name and this reason, and a later run does not undo it."
          confirmLabel="Write off" cancelLabel="Keep the balance"
          confirmDisabled={!asking.reason.trim()}
          onConfirm={() => void act({ op: "write_off", producer_user_id: person.userId, reason: asking.reason }, "Written off")}
          fields={<Field label="Why is the agency absorbing it?" htmlFor="write-off-why"><input id="write-off-why" className={control} autoFocus value={asking.reason} onChange={(e) => setAsking({ ...asking, reason: e.target.value })} /></Field>}
        />
      ) : null}
    </>
  );
}

/** Splits tab: add a split, from its date forward (what was recorded keeps its rate). */
export function AddSplitForm({ person, carriers, defaults }: { person: Person; carriers: { id: string; name: string }[]; defaults: Overview["settings"] }) {
  const router = useRouter();
  const blank = { pct: defaults.defaultSplitBp != null ? String(defaults.defaultSplitBp / 100) : "", carrier: "", product: "", basis: defaults.defaultBasis as Basis, paysOn: "advance_received" as PaysOn, from: today() };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(blank);
  const save = async (): Promise<boolean> => {
    const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(f.pct.trim());
    const bp = m ? Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2)) : NaN;
    if (!Number.isInteger(bp) || bp < 0 || bp > 10000) { setError("A percentage from 0 to 100."); return false; }
    setBusy(true);
    setError(null);
    try {
      await post("/api/app/accounting/producers", { op: "add_split", producer_user_id: person.userId, carrier_id: f.carrier || null, product_code: f.product || null, split_pct_bp: bp, basis: f.basis, pays_on: f.paysOn, effective_from: f.from });
      notify.done("Split saved — from its date forward; past entries keep their rate");
      setF(blank);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void save(); };
  return (
    <form ref={scope} onSubmit={submit} className={`${cardSurface} flex flex-col gap-4 p-5`}>
      <h2 className="text-card-title">Add a split</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Share (%)" htmlFor="split-pct" required><input id="split-pct" className={control} required inputMode="decimal" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></Field>
        <Field label="From" htmlFor="split-from" required hint="What was already recorded keeps the rate it was recorded at."><input id="split-from" type="date" className={control} required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="Carrier" htmlFor="split-carrier"><select id="split-carrier" className={control} value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })}><option value="">All carriers</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Product code" htmlFor="split-product"><input id="split-product" className={control} placeholder="All products" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></Field>
        <Field label="Of" htmlFor="split-basis"><select id="split-basis" className={control} value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as Basis })}>{(Object.keys(BASIS_LABELS) as Basis[]).map((k) => <option key={k} value={k}>{BASIS_LABELS[k]}</option>)}</select></Field>
        <Field label="Owed" htmlFor="split-pays"><select id="split-pays" className={control} value={f.paysOn} onChange={(e) => setF({ ...f, paysOn: e.target.value as PaysOn })}>{(Object.keys(PAYS_ON_LABELS) as PaysOn[]).map((k) => <option key={k} value={k}>{PAYS_ON_LABELS[k]}</option>)}</select></Field>
      </div>
      {error ? <Callout tone="error" title={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={!dirty || busy} onClick={() => setF(blank)}>Discard</Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save split"}</Button>
      </div>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={() => setF(blank)} what={`the split for ${person.name}`} />
    </form>
  );
}
