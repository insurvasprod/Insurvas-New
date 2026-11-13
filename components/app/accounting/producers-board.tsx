"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { percent, type Basis, type NegativePolicy, type PaysOn, type ProducerRun } from "@/lib/accounting/producersCore";
import { OF_LABELS, OWED_LABELS, currentSplit, dateLabel, dayLabel, daysAgo, monthLabel, periodLabel, splitText, today, type Split } from "@/lib/accounting/producerLabels";
import { PAID_METHODS, PAID_METHOD_LABELS } from "@/lib/accounting/invoicesCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.5 · what each producer is owed from the commission the agency received — and, when their
 * chargebacks outrun their sales, what they owe back. A negative balance is shown, never hidden or
 * reset; writing it off is an explicit decision with a reason.
 *
 * Round 7, 4·A "Tidy in place" (owner 2026-11-10, docs/la4/mockups-r7/accounting.html §4): nothing is decided
 * inside a row. A producer row opens the producer's page; a run row opens the run dialog (a draft: Publish
 * and next or Void; published: Paid on and Reference, Mark paid; paid: read-only). The "Next step" column
 * says the next step in words. Add a split is a button and a dialog, a split row opens its read-only facts,
 * and "Publish N drafts one by one" steps through every draft in the one run dialog.
 */
export type Person = { userId: string; name: string; role: string; balanceCents: number; owedCents: number; clawedBackCents: number; paidCents: number };
export type { Split };
export type Run = ProducerRun & { producerUserId: string };
/** What a run dialog needs: the agency's run, or the producer's own published statement. */
export type RunFacts = Pick<ProducerRun, "id" | "periodStart" | "periodEnd" | "status" | "earnedCents" | "clawedBackCents" | "withheldCents" | "netCents" | "balanceAfterCents" | "paidOn"> & { producerUserId?: string };
export type Overview = { people: Person[]; splits: Split[]; runs: Run[]; carriers: { id: string; name: string }[]; settings: { negativePolicy: string; recoveryCapBp: number; defaultSplitBp: number | null; defaultBasis: Basis } };
export type ProducersView = "producers" | "runs";
export type ProducerFilter = "all" | "owes" | "nosplit";
/** One ledger line, shaped on the server: what it is, the policy it came from and where that opens. */
export type EntryRow = { id: string; occurredOn: string; what: string; reason: string | null; policyNumber: string | null; href: string | null; split: string | null; amountCents: number; kind: EntryKind };
export type EntryKind = "share" | "chargeback" | "other";
export type EntryFilter = "all" | "shares" | "chargebacks";

const money = (c: number) => formatCentsAsCurrency(c);
/** A deduction, drawn as one: "−$190.10" (zero stays "$0.00"). */
const less = (c: number) => (c ? money(-Math.abs(c)) : money(0));

const READ_ONLY_REASON = "Read-only: your plan can see producer splits but not change them.";
// One chip per row, its tone the meaning: a draft waits to be published, a published run waits to be paid.
const RUN_TONE: Record<ProducerRun["status"], StatusTone> = { draft: "warning", published: "warning", paid: "good", void: "neutral" };
const RUN_STATUS: Record<ProducerRun["status"], string> = { draft: "Draft", published: "Published", paid: "Paid", void: "Void" };
const runStatus = (r: Pick<RunFacts, "status" | "paidOn">) => (r.status === "paid" && r.paidOn ? `Paid ${dayLabel(r.paidOn)}` : RUN_STATUS[r.status]);
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

/** A button the plan does not allow: off, with the reason on hover (4·5). */
function Gated({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return readOnly ? <span title={READ_ONLY_REASON} className="inline-flex">{children}</span> : <>{children}</>;
}

const Chevron = () => <td className="w-8 text-right text-muted-foreground"><ChevronRight className="inline size-4" aria-hidden="true" /></td>;
/** A row that opens something: the whole row by mouse, Enter or Space by keyboard. */
const opens = (go: () => void) => ({
  className: "cursor-pointer",
  tabIndex: 0,
  onClick: (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("a, button")) go(); },
  onKeyDown: (e: KeyboardEvent) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); go(); } },
});
const stop = (e: MouseEvent) => e.stopPropagation();

/* ── The run dialog (4·3): one run, or every draft one by one ─────────────── */

function RunDialog({ queue, names, readOnly, mine = false, onClose }: { queue: RunFacts[]; names?: Record<string, string>; readOnly: boolean; mine?: boolean; onClose: () => void }) {
  const router = useRouter();
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState({ on: today(), method: "ach", reference: "" });
  const [voiding, setVoiding] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const run = queue[at];
  if (!run) return null;
  const stepping = queue.length > 1;
  const last = at >= queue.length - 1;
  const canAct = !readOnly && !mine;
  const who = run.producerUserId && names ? names[run.producerUserId] ?? "Producer" : null;
  const close = (didChange = changed) => { onClose(); if (didChange) router.refresh(); };
  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await post(`/api/app/accounting/producer-runs/${run.id}`, body);
      notify.done(done);
      setVoiding(null);
      setChanged(true);
      if (stepping && !last) { setAt(at + 1); setAsking({ on: today(), method: "ach", reference: "" }); } else close(true);
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const figures = run.status === "published"
    ? `net payable ${money(run.netCents)} · the cost is booked`
    : `Earned ${money(run.earnedCents)} · clawed back ${less(run.clawedBackCents)}${run.withheldCents ? ` · withheld ${less(run.withheldCents)}` : ""} · ${mine ? "paid to you" : "net payable"} ${money(run.netCents)}`;
  if (voiding !== null) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(next) => { if (!next) setVoiding(null); }}
        busy={busy}
        title={`Void the run for ${periodLabel(run.periodStart, run.periodEnd)}?`}
        description="Its entries are reversed; the run stays on record."
        confirmLabel="Void run"
        cancelLabel="Keep it"
        confirmDisabled={!voiding.trim()}
        onConfirm={() => void act({ action: "void", reason: voiding }, "Voided")}
        fields={<Field label="Why?" htmlFor="run-why"><input id="run-why" className={control} autoFocus maxLength={500} value={voiding} onChange={(e) => setVoiding(e.target.value)} /></Field>}
      />
    );
  }
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) close(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{who ? `${who} · ` : ""}{periodLabel(run.periodStart, run.periodEnd)}{stepping ? <span className="ml-2 text-xs font-normal text-muted-foreground">{at + 1} of {queue.length}</span> : null}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 text-[var(--body)]">
            <StatusChip tone={RUN_TONE[run.status]}>{runStatus(run)}</StatusChip>
            <span>{figures}</span>
          </DialogDescription>
          {mine ? <p className="text-sm text-muted-foreground">Your balance after this run: {money(run.balanceAfterCents)}</p> : null}
        </DialogHeader>
        {canAct && run.status === "published" && run.netCents > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid on" htmlFor="run-paid-on"><input id="run-paid-on" type="date" className={control} value={asking.on} onChange={(e) => setAsking({ ...asking, on: e.target.value })} /></Field>
            <Field label="Method" htmlFor="run-method"><select id="run-method" className={control} value={asking.method} onChange={(e) => setAsking({ ...asking, method: e.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></Field>
            <Field label="Reference" htmlFor="run-ref"><input id="run-ref" className={control} maxLength={200} placeholder="Check number, Zelle reference" value={asking.reference} onChange={(e) => setAsking({ ...asking, reference: e.target.value })} /></Field>
          </div>
        ) : null}
        <DialogFooter>
          {canAct && run.status !== "paid" && run.status !== "void" ? <Button type="button" variant="outline" className="sm:mr-auto" disabled={busy} onClick={() => setVoiding("")}>Void the run</Button> : null}
          <Button type="button" variant="outline" disabled={busy} onClick={() => close()}>Close</Button>
          {canAct && run.status === "draft" ? (
            <Button type="button" disabled={busy} onClick={() => void act({ action: "publish" }, "Published: the cost is booked")}>{stepping && !last ? <>Publish and next<ChevronRight aria-hidden="true" /></> : "Publish"}</Button>
          ) : canAct && run.status === "published" && run.netCents > 0 ? (
            <Button type="button" disabled={busy || !asking.on} onClick={() => void act({ action: "paid", paid_on: asking.on, method: asking.method, reference: asking.reference.trim() || null }, "Marked paid")}>Mark {money(run.netCents)} paid</Button>
          ) : stepping && !last ? (
            <Button type="button" disabled={busy} onClick={() => setAt(at + 1)}>Next<ChevronRight aria-hidden="true" /></Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Title-line primary on Producer splits: every draft, one by one, in the run dialog. */
export function PublishDrafts({ drafts, names, readOnly }: { drafts: Run[]; names: Record<string, string>; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<Run[]>([]);
  if (drafts.length === 0) return null;
  return (
    <>
      <Gated readOnly={readOnly}>
        <Button disabled={readOnly} onClick={() => { setQueue(drafts); setOpen(true); }}>{drafts.length === 1 ? "Publish 1 draft" : `Publish ${drafts.length} drafts one by one`}</Button>
      </Gated>
      {open ? <RunDialog queue={queue} names={names} readOnly={readOnly} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The runs table: the list's Payout runs tab, a producer's Payout runs tab, and My balance's (mine: read-only statements). */
export function RunsTable({ runs, names, readOnly, mine = false, openRunId }: { runs: RunFacts[]; names?: Record<string, string>; readOnly: boolean; mine?: boolean; openRunId?: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const pageSize = useFittingPageSize(480, 45);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<RunFacts | null>(() => runs.find((r) => r.id === openRunId) ?? null);
  const shown = paginate(runs, page, pageSize);
  return (
    <>
      <TableCard
        toolbar={runs.length && !mine ? <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />} /> : undefined}
        footer={runs.length > pageSize ? <Pager page={shown.current} total={runs.length} noun="runs" pageSize={pageSize} onPage={setPage} /> : undefined}
      >
        {runs.length === 0 ? (mine ? <EmptyState title="No payout runs yet" hint="A run shows here once the agency publishes it to you." /> : <EmptyState title="No producer runs yet" hint="Open a producer and draft a run for a period." />) : (
          <table className="portal-lead-table w-full min-w-[920px] text-left text-sm">
            {/* Six columns at most: with a Producer column, Withheld moves into the net's hover. */}
            <thead><tr>{names ? <th>Producer</th> : null}<th className="w-[200px]">Period</th><th className="text-right">Earned</th><th className="text-right">Clawed back</th>{names ? null : <th className="text-right">Withheld</th>}<th className="text-right">{mine ? "Paid to you" : "Net payable"}</th><th className="w-[150px]">Status</th><th className="w-8"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {shown.rows.map((r) => (
                <tr key={r.id} {...opens(() => setOpen(r))} aria-label={`Open the run for ${periodLabel(r.periodStart, r.periodEnd)}`}>
                  {names ? <td className="whitespace-nowrap font-medium text-foreground">{r.producerUserId ? <Link className="hover:underline" href={`/app/producer-splits/${r.producerUserId}`} onClick={stop}>{names[r.producerUserId] ?? "Producer"}</Link> : "Producer"}</td> : null}
                  <td className={`whitespace-nowrap tabular-nums ${names ? "text-muted-foreground" : "font-medium text-foreground"}`}>{periodLabel(r.periodStart, r.periodEnd)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(r.earnedCents)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{less(r.clawedBackCents)}</td>
                  {names ? null : <td className="whitespace-nowrap text-right tabular-nums">{less(r.withheldCents)}</td>}
                  <td className="whitespace-nowrap text-right tabular-nums" title={names && r.withheldCents ? `Withheld ${less(r.withheldCents)}` : undefined}>{money(r.netCents)}</td>
                  <td><StatusChip tone={RUN_TONE[r.status]}>{runStatus(r)}</StatusChip></td>
                  <Chevron />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {open ? <RunDialog queue={[open]} names={names} readOnly={readOnly} mine={mine} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/* ── The list (4·A) ───────────────────────────────────────────────────────── */

/** The row's next step: a short verb, the sentence on hover; the step itself is taken on the producer's page or in the run dialog. */
function nextStep(p: Person, runs: Run[], hasSplit: boolean, policy: string): { text: string; title: string } {
  const mine = runs.filter((r) => r.producerUserId === p.userId);
  const drafts = mine.filter((r) => r.status === "draft");
  if (drafts.length === 1) return { text: "Publish", title: `Publish the ${monthLabel(drafts[0].periodStart)} draft` };
  if (drafts.length > 1) return { text: "Publish", title: `Publish ${drafts.length} drafts` };
  const unpaid = mine.find((r) => r.status === "published" && r.netCents > 0);
  if (unpaid) return { text: "Mark paid", title: `Mark the ${monthLabel(unpaid.periodStart)} run paid` };
  if (p.balanceCents < 0) {
    const how = policy as NegativePolicy;
    return how === "write_off" ? { text: "Write off", title: "Write off the balance" } : { text: "Open", title: how === "cap" ? "Recovered from the next runs" : "Carried to the next run" };
  }
  if (!hasSplit) return { text: "Add split", title: "Add a split" };
  if (p.balanceCents > 0) return { text: "Draft run", title: "Draft a run" };
  return { text: "Open", title: "Nothing to do" };
}

export function ProducersBoard({ data, view, show = "all", readOnly }: { data: Overview; view: ProducersView; show?: ProducerFilter; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ProducerFilter>(show);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  const refresh = () => startRefresh(() => router.refresh());
  const needle = q.trim().toLowerCase();
  const split = (p: Person) => currentSplit(data.splits, p.userId);
  const owes = data.people.filter((p) => p.balanceCents < 0);
  const noSplit = data.people.filter((p) => !split(p));
  const people = (filter === "owes" ? owes : filter === "nosplit" ? noSplit : data.people).filter((p) => !needle || p.name.toLowerCase().includes(needle));
  const shown = paginate(people, page, pageSize);
  const owedTo = data.people.filter((p) => p.balanceCents > 0);
  const drafts = data.runs.filter((r) => r.status === "draft");
  const names = Object.fromEntries(data.people.map((p) => [p.userId, p.name]));
  const pick = (f: ProducerFilter) => { setFilter(f); setPage(1); };
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const carried = data.settings.negativePolicy === "cap" ? "recovered from the next runs" : data.settings.negativePolicy === "write_off" ? "to write off" : "carried to the next run";
  return (
    <>
      <StatStrip label="Producer balances">
        <StatTile label="Owed to producers" value={money(owedTo.reduce((s, p) => s + p.balanceCents, 0))} footnote={plural(owedTo.length, "producer")} href="/app/producer-splits" />
        <StatTile label="Owed by producers" value={money(-owes.reduce((s, p) => s + p.balanceCents, 0))} footnote={owes.length ? <><StatusChip tone="danger">{plural(owes.length, "producer")}</StatusChip> {carried}</> : "nobody owes the agency"} href="/app/producer-splits?show=owes" />
        <StatTile label="Runs to publish" value={String(drafts.length)} footnote={drafts.length ? <StatusChip tone="warning">drafts · {money(drafts.reduce((s, r) => s + r.netCents, 0))}</StatusChip> : `drafts · ${money(0)}`} href="/app/producer-splits?view=runs" />
      </StatStrip>
      {view === "runs" ? <RunsTable runs={data.runs} names={names} readOnly={readOnly} /> : (
        <TableCard
          toolbar={<DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search producers" />
            <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-2">
              <ToggleChip role="radio" selected={filter === "all"} count={data.people.length} onClick={() => pick("all")}>All</ToggleChip>
              <ToggleChip role="radio" selected={filter === "owes"} count={owes.length} countTone={owes.length ? "danger" : undefined} onClick={() => pick("owes")}>Owes the agency</ToggleChip>
              <ToggleChip role="radio" selected={filter === "nosplit"} count={noSplit.length} countTone={noSplit.length ? "warning" : undefined} onClick={() => pick("nosplit")}>No split</ToggleChip>
            </div>
          </DataToolbar>}
          footer={people.length > pageSize ? <Pager page={shown.current} total={people.length} noun="producers" pageSize={pageSize} onPage={setPage} /> : undefined}
        >
          {data.people.length === 0 ? <EmptyState title="No producers" hint="Producer splits are for agencies: once producers join, record each one's split here." />
            : people.length === 0 ? <NoMatches noun="producers" onClear={() => { setQ(""); pick("all"); }} /> : (
            <table className="portal-lead-table w-full min-w-[920px] text-left text-sm">
              <thead><tr><th>Producer</th><th className="w-[200px]">Split</th><th className="w-[130px] text-right">Owed to date</th><th className="w-[130px] text-right">Clawed back</th><th className="w-[130px] text-right">Balance</th><th className="w-[220px]">Next step</th><th className="w-8"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {shown.rows.map((p) => {
                  const s = split(p);
                  const base = `/app/producer-splits/${p.userId}`;
                  const next = nextStep(p, data.runs, Boolean(s), data.settings.negativePolicy);
                  const figure = "tabular-nums hover:underline";
                  return (
                    <tr key={p.userId} {...opens(() => router.push(base))}>
                      <td className="whitespace-nowrap font-medium text-foreground"><Link className="hover:underline" href={base}>{p.name}</Link></td>
                      <td className="whitespace-nowrap">{s ? <Link className="hover:underline" href={`${base}?tab=splits`}>{splitText(s)}</Link> : <span className="text-muted-foreground" title="No split: nothing is owed until one is">—</span>}</td>
                      <td className="whitespace-nowrap text-right"><Link className={figure} href={`${base}?show=shares`}>{money(p.owedCents)}</Link></td>
                      <td className="whitespace-nowrap text-right"><Link className={figure} href={`${base}?show=chargebacks`}>{money(p.clawedBackCents)}</Link></td>
                      {/* A negative balance is said in the row's one chip; a balance owed to them stays a plain amount. */}
                      <td className="whitespace-nowrap text-right">{p.balanceCents < 0 ? <StatusChip tone="danger">{money(-p.balanceCents)} owed back</StatusChip> : <Link className={figure} href={base}>{money(p.balanceCents)}</Link>}</td>
                      <td className="whitespace-nowrap" title={next.title}>{next.text} ›</td>
                      <Chevron />
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

/* ── A producer's page (4·1, 4·2) ─────────────────────────────────────────── */

/** A producer's title line: ⋯ › Write off the balance (only while they owe) and the one primary, Draft a run. */
export function ProducerActions({ person, readOnly }: { person: Person; readOnly: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState<{ kind: "run"; from: string; to: string } | { kind: "write_off"; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const first = person.name.split(" ")[0] || person.name;
  const act = async (body: unknown, done: string, open?: (id: string) => string) => {
    setBusy(true);
    try {
      const json = await post("/api/app/accounting/producers", body);
      const id = typeof json?.id === "string" ? json.id : null;
      notify.done(done, id && open ? { action: { label: "Open", onClick: () => router.push(open(id)) } } : undefined);
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
      {!readOnly ? <MoreMenu items={[person.balanceCents < 0 && { label: "Write off the balance", onSelect: () => setAsking({ kind: "write_off", reason: "" }) }]} /> : null}
      <Gated readOnly={readOnly}><Button disabled={readOnly} onClick={() => setAsking({ kind: "run", ...lastMonth() })}>Draft a run</Button></Gated>
      {asking?.kind === "run" ? (
        <ConfirmDialog
          open onOpenChange={(next) => { if (!next) setAsking(null); }} busy={busy} destructive={false}
          title={`Draft a run for ${person.name}?`}
          description="A draft books nothing; publishing it does."
          confirmLabel="Draft run" cancelLabel="Not now"
          confirmDisabled={!asking.from || !asking.to || asking.to < asking.from}
          onConfirm={() => void act({ op: "build_run", producer_user_id: person.userId, period_start: asking.from, period_end: asking.to }, "Draft run built", (id) => `/app/producer-splits/${person.userId}?tab=runs&run=${id}`)}
          fields={<div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="run-from"><input id="run-from" type="date" className={control} value={asking.from} onChange={(e) => setAsking({ ...asking, from: e.target.value })} /></Field>
            <Field label="To" htmlFor="run-to" error={asking.to && asking.from && asking.to < asking.from ? "The end comes after the start." : undefined}><input id="run-to" type="date" className={control} value={asking.to} onChange={(e) => setAsking({ ...asking, to: e.target.value })} /></Field>
          </div>}
        />
      ) : asking?.kind === "write_off" ? (
        <ConfirmDialog
          open onOpenChange={(next) => { if (!next) setAsking(null); }} busy={busy}
          title={`Write off ${money(-person.balanceCents)}?`}
          description={`The agency absorbs it, and ${first}'s balance goes to ${money(0)}. It is recorded with your name and this reason.`}
          confirmLabel="Write off" cancelLabel="Keep the balance"
          confirmDisabled={!asking.reason.trim()}
          onConfirm={() => void act({ op: "write_off", producer_user_id: person.userId, reason: asking.reason }, "Written off")}
          fields={<Field label="Why is the agency absorbing it?" htmlFor="write-off-why"><input id="write-off-why" className={control} autoFocus maxLength={500} placeholder="For example: chargeback on a policy we wrote wrong" value={asking.reason} onChange={(e) => setAsking({ ...asking, reason: e.target.value })} /></Field>}
        />
      ) : null}
    </>
  );
}

/** Splits tab's title-line primary: Add a split, in a dialog, from its date forward (what was recorded keeps its rate). */
export function AddSplitForm({ person, carriers, defaults, readOnly }: { person: Person; carriers: { id: string; name: string }[]; defaults: Overview["settings"]; readOnly: boolean }) {
  const router = useRouter();
  const blank = { pct: defaults.defaultSplitBp != null ? String(defaults.defaultSplitBp / 100) : "", carrier: "", product: "", basis: defaults.defaultBasis as Basis, paysOn: "advance_received" as PaysOn, from: today() };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLDivElement>(null);
  const dirty = open && JSON.stringify(f) !== JSON.stringify(blank);
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(f.pct.trim());
  const bp = m ? Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2)) : NaN;
  const pctOk = Number.isInteger(bp) && bp >= 0 && bp <= 10000;
  const pctError = f.pct.trim() && !pctOk ? "A percentage from 0 to 100." : undefined;
  const discard = () => { setF(blank); setError(null); setOpen(false); };
  const save = async (): Promise<boolean> => {
    if (!pctOk) { setError("A percentage from 0 to 100."); return false; }
    setBusy(true);
    setError(null);
    try {
      await post("/api/app/accounting/producers", { op: "add_split", producer_user_id: person.userId, carrier_id: f.carrier || null, product_code: f.product || null, split_pct_bp: bp, basis: f.basis, pays_on: f.paysOn, effective_from: f.from });
      notify.done("Split saved — from its date forward; past entries keep their rate");
      setF(blank);
      setOpen(false);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Gated readOnly={readOnly}><Button disabled={readOnly} onClick={() => setOpen(true)}>Add a split</Button></Gated>
      <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) discard(); }}>
        <DialogContent size="md">
          <div ref={scope} className="contents">
            <DialogHeader>
              <DialogTitle>Add a split for {person.name}</DialogTitle>
              <DialogDescription className="sr-only">A split counts from its date forward.</DialogDescription>
            </DialogHeader>
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Share (%)" htmlFor="split-pct" required error={pctError}><input id="split-pct" className={control} required inputMode="decimal" autoFocus aria-invalid={pctError ? true : undefined} value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></Field>
                <Field label="From" htmlFor="split-from" required><input id="split-from" type="date" className={control} required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
                <Field label="Carrier" htmlFor="split-carrier"><select id="split-carrier" className={control} value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })}><option value="">All carriers</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="Product code" htmlFor="split-product"><input id="split-product" className={control} maxLength={100} placeholder="All products" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></Field>
                <Field label="Of" htmlFor="split-basis"><select id="split-basis" className={control} value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as Basis })}>{(Object.keys(OF_LABELS) as Basis[]).map((k) => <option key={k} value={k}>{OF_LABELS[k]}</option>)}</select></Field>
                <Field label="Owed" htmlFor="split-pays"><select id="split-pays" className={control} value={f.paysOn} onChange={(e) => setF({ ...f, paysOn: e.target.value as PaysOn })}>{(Object.keys(OWED_LABELS) as PaysOn[]).map((k) => <option key={k} value={k}>{OWED_LABELS[k]}</option>)}</select></Field>
              </div>
              <p className="text-xs text-muted-foreground">What was already recorded keeps the rate it was recorded at.</p>
              {error && error !== pctError ? <p role="alert" className="text-xs text-[var(--error-ink)]">{error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={discard}>Discard</Button>
                <Button type="submit" disabled={busy || !pctOk || !f.from}>{busy ? "Saving…" : "Save split"}</Button>
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>
      <LeaveGuard dirty={dirty && !busy} scope={scope} onSave={save} onDiscard={discard} what={`the split for ${person.name}`} />
    </>
  );
}

/** Splits tab: the effective-dated rules; a row opens its facts, read-only (a change is a new split). */
export function SplitsTable({ splits, carriers }: { splits: Split[]; carriers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState<Split | null>(null);
  const carrier = (id: string | null) => (id ? carriers.find((c) => c.id === id)?.name ?? "Carrier" : "All carriers");
  const facts = (s: Split): Array<[string, string]> => [["From", dateLabel(s.effectiveFrom)], ["Share", percent(s.splitPctBp)], ["Of", OF_LABELS[s.basis]], ["Carrier", carrier(s.carrierId)], ["Product", s.productCode ?? "All products"], ["Owed", OWED_LABELS[s.paysOn]]];
  return (
    <>
      <TableCard footer={splits.length ? "What was already recorded keeps the rate it was recorded at." : undefined}>
        {splits.length === 0 ? <EmptyState title="No split recorded" hint="Nothing is owed to this producer until one is." /> : (
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th className="w-[140px]">From</th><th className="w-[100px]">Share</th><th>Of</th><th>Carrier</th><th>Product</th><th>Owed</th><th className="w-8"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>{splits.map((s) => (
              <tr key={s.id} {...opens(() => setOpen(s))} aria-label={`Open the split from ${dateLabel(s.effectiveFrom)}`}>
                <td className="whitespace-nowrap tabular-nums font-medium text-foreground">{dateLabel(s.effectiveFrom)}</td><td className="whitespace-nowrap tabular-nums">{percent(s.splitPctBp)}</td><td className="whitespace-nowrap">{OF_LABELS[s.basis]}</td><td className="whitespace-nowrap">{carrier(s.carrierId)}</td><td className="whitespace-nowrap">{s.productCode ?? "All products"}</td><td className="whitespace-nowrap">{OWED_LABELS[s.paysOn]}</td><Chevron />
              </tr>
            ))}</tbody>
          </table>
        )}
      </TableCard>
      <Dialog open={open !== null} onOpenChange={(next) => { if (!next) setOpen(null); }}>
        {open ? (
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>{percent(open.splitPctBp)} of {OF_LABELS[open.basis].toLowerCase()}</DialogTitle>
              <DialogDescription>A split is never edited: to change it, add a new one from the date it starts.</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-sm">
              {facts(open).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>)}
            </dl>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(null)}>Close</Button></DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

/* ── Entries: a producer's Entries tab (4·1) and My balance (4·4) ─────────── */

const PERIODS = [
  { key: "all", label: "All dates", days: null },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "year", label: "This year", days: null },
] as const;

/**
 * Every share and chargeback, newest first. A row opens the policy it came from (the agency: the policy's
 * Commissions tab; a producer: their own policy page) when there is one to open; otherwise it is read-only.
 */
export function EntriesTable({ rows, show = "all", mine = false }: { rows: EntryRow[]; show?: EntryFilter; mine?: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<EntryFilter>(show);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  const needle = q.trim().toLowerCase();
  const span = PERIODS.find((p) => p.key === period)!;
  const since = span.key === "year" ? `${today().slice(0, 4)}-01-01` : span.days ? daysAgo(span.days) : null;
  const inScope = rows.filter((e) => (!since || e.occurredOn >= since) && (!needle || `${e.policyNumber ?? ""} ${e.what} ${e.reason ?? ""}`.toLowerCase().includes(needle)));
  const shares = inScope.filter((e) => e.kind === "share");
  const chargebacks = inScope.filter((e) => e.kind === "chargeback");
  const visible = filter === "shares" ? shares : filter === "chargebacks" ? chargebacks : inScope;
  const shown = paginate(visible, page, pageSize);
  const pick = (f: EntryFilter) => { setFilter(f); setPage(1); };
  const noun = "entries";
  return (
    <TableCard
      toolbar={rows.length ? <DataToolbar actions={mine ? undefined : <>
        <select aria-label="Period" className={toolbarControl} value={period} onChange={(e) => { setPeriod(e.target.value as typeof period); setPage(1); }}>{PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
      </>}>
        {!mine ? <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search policy" /> : null}
        <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-2">
          <ToggleChip role="radio" selected={filter === "all"} count={inScope.length} onClick={() => pick("all")}>All</ToggleChip>
          <ToggleChip role="radio" selected={filter === "shares"} count={shares.length} onClick={() => pick("shares")}>Shares</ToggleChip>
          <ToggleChip role="radio" selected={filter === "chargebacks"} count={chargebacks.length} countTone={chargebacks.length ? "danger" : undefined} onClick={() => pick("chargebacks")}>Chargebacks</ToggleChip>
        </div>
      </DataToolbar> : undefined}
      footer={visible.length > pageSize ? <Pager page={shown.current} total={visible.length} noun={noun} pageSize={pageSize} onPage={setPage} /> : visible.length ? `${visible.length} ${visible.length === 1 ? "entry" : noun}` : undefined}
    >
      {rows.length === 0 ? <EmptyState title="Nothing yet" hint={mine ? "Your share appears here as the carriers' commission arrives." : "Shares appear here as the carriers' commission arrives."} />
        : visible.length === 0 ? <NoMatches noun={noun} onClear={() => { setQ(""); setPeriod("all"); pick("all"); }} /> : (
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead><tr><th className="w-[130px]">Date</th><th>What</th><th className="w-[200px]">Policy</th>{mine ? null : <th className="w-[160px]">Split</th>}<th className="w-[140px] text-right">{mine ? "Your share" : "Amount"}</th><th className="w-8"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {shown.rows.map((e) => {
              const go = e.href;
              return (
                <tr key={e.id} {...(go ? opens(() => router.push(go)) : {})}>
                  <td className="whitespace-nowrap tabular-nums font-medium text-foreground">{dateLabel(e.occurredOn)}</td>
                  {/* One line: the entry's reason, once a grey line under it, is said on hover. */}
                  <td className="whitespace-nowrap" title={e.reason ?? undefined}>{e.what}</td>
                  {/* LA-7.5: an entry opens what caused it, the commission on its policy. */}
                  <td className="whitespace-nowrap tabular-nums">{e.policyNumber && go ? <Link className="hover:underline" href={go}>{e.policyNumber}</Link> : e.policyNumber ?? <span className="text-muted-foreground">—</span>}</td>
                  {mine ? null : <td className="whitespace-nowrap">{e.split ?? <span className="text-muted-foreground">—</span>}</td>}
                  <td className="whitespace-nowrap text-right tabular-nums">{money(e.amountCents)}</td>
                  {go ? <Chevron /> : <td className="w-8" />}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
