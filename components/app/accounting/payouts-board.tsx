"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { Field, control } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { PAID_METHOD_LABELS, PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { RUN_STATUS_LABELS, type RunDispute, type RunHeader, type RunStatus } from "@/lib/accounting/payoutsCore";
import { defaultPayoutPeriod, periodHasTerms } from "@/lib/accounting/payoutPeriod";
import { formatCentsAsCurrency } from "@/lib/money";

import { notify } from "@/lib/notify";

/**
 * LA-7.4 · what each partner is owed, itemised, from the terms on file. The agency reviews a draft —
 * disputing any item it disagrees with — then publishes it, and the partner reads the same statement
 * in its portal. Nothing here moves money: the agency pays as it does today and records it.
 *
 * Foundation pass (2026-11-03): Partner payouts is a step of Accounting (it is LA-7.4, Module 7). A run is its
 * own page (/app/payouts/[id]: Statement · Items · Disputes · Terms used), never a 960px pop-up; drafting,
 * marking paid, voiding, disputing an item and resolving a dispute are confirm pop-ups with their fields.
 * The board also draws one partner's runs on the partner record (`partnerFixed`).
 */
type Partner = { id: string; name: string; status: string; firstTermDate: string | null };
type RunRow = RunHeader & { partnerName: string };

const TONE: Record<RunStatus, StatusTone> = { draft: "warning", published: "info", paid: "good", void: "neutral" };
const money = (c: number) => formatCentsAsCurrency(c);
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const today = () => new Date().toISOString().slice(0, 10);

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "That didn't save");
  return body;
}
const post = (id: string, payload: Record<string, unknown>) => send(`/api/app/accounting/payouts/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

export function RunStatusChip({ status, paidOn }: { status: RunStatus; paidOn?: string | null }) {
  return <StatusChip tone={TONE[status]}>{RUN_STATUS_LABELS[status]}{paidOn ? ` ${paidOn}` : ""}</StatusChip>;
}

/** Draft a run: a partner and a period, priced from the partner's terms. Opens the new run's page. */
function DraftRun({ partners, onClose }: { partners: Partner[]; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState(() => ({ partner: partners[0]?.id ?? "", ...defaultPayoutPeriod(partners[0]?.firstTermDate ?? null) }));
  const [busy, setBusy] = useState(false);
  const selected = partners.find((partner) => partner.id === f.partner);
  const priced = periodHasTerms(selected?.firstTermDate ?? null, f.from, f.to);
  const hint = !selected?.firstTermDate
    ? "Add payout terms on this partner before creating a draft."
    : !priced
      ? `Start the period on or after ${dateLabel(selected.firstTermDate)} so every item can use a saved rate.`
      : `Each item is priced by the rate in force on its date. This partner's first rate began ${dateLabel(selected.firstTermDate)}.`;
  const build = async () => {
    setBusy(true);
    try {
      const body = await send("/api/app/accounting/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partner_id: f.partner, period_start: f.from, period_end: f.to }) });
      notify.done("Draft run built");
      router.push(`/app/payouts/${body.id}`);
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      open onOpenChange={(next) => { if (!next) onClose(); }} busy={busy} destructive={false}
      title="Draft a payout run?"
      description="Only you see a draft; it books nothing until you publish it."
      confirmLabel="Build draft" cancelLabel="Not now"
      confirmDisabled={!f.partner || !priced}
      onConfirm={() => void build()}
      fields={<>
        <Field label="Partner" htmlFor="run-partner"><select id="run-partner" className={control} value={f.partner} onChange={(e) => { const next = partners.find((p) => p.id === e.target.value); setF({ partner: e.target.value, ...defaultPayoutPeriod(next?.firstTermDate ?? null) }); }}>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="run-from"><input id="run-from" type="date" className={control} min={selected?.firstTermDate ?? undefined} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to })} /></Field>
          <Field label="To" htmlFor="run-to"><input id="run-to" type="date" className={control} min={f.from} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
        <p className={priced ? "text-xs text-muted-foreground" : "text-xs text-[var(--warning-ink)]"}>{hint}</p>
      </>}
    />
  );
}

/** The step's header: Draft a payout run (the one primary). */
export function PayoutActions({ partners, readOnly }: { partners: Partner[]; readOnly: boolean }) {
  const [drafting, setDrafting] = useState(false);
  const open = partners.filter((p) => p.status !== "offboarded");
  if (readOnly || open.length === 0) return null;
  return (
    <>
      <Button onClick={() => setDrafting(true)}>Draft a payout run</Button>
      {drafting ? <DraftRun partners={open} onClose={() => setDrafting(false)} /> : null}
    </>
  );
}

type Asking = { kind: "paid"; on: string; method: string; reference: string } | { kind: "void"; reason: string };

/**
 * A run page's header: Publish (a draft) or Mark paid (published), then More (the statement, Void). A publish
 * the business identity blocks says what to add, in the bell, with its links.
 */
export function RunActions({ run, readOnly }: { run: Pick<RunHeader, "id" | "status" | "netCents"> & { partnerName: string }; readOnly: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const act = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    setBlocked(null);
    try {
      await post(run.id, payload);
      notify.done(done);
      setAsking(null);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "That didn't save";
      if (/trading name|business address/i.test(message)) setBlocked(message);
      else notify.fail(message);
    } finally {
      setBusy(false);
    }
  };
  const statement = { label: "Download the statement", href: `/api/app/accounting/payouts/${run.id}/statement` };
  if (readOnly) return <MoreMenu items={[statement]} />;
  return (
    <>
      {blocked ? (
        <Callout tone="warning" title="Add your business details before publishing.">
          The partner statement shows who sent it. {/trading name/i.test(blocked) ? <Link className="underline" href="/app/settings#business-identity/identity-trading-name">Add the trading name</Link> : null}{/trading name/i.test(blocked) && /business address/i.test(blocked) ? " and " : null}{/business address/i.test(blocked) ? <Link className="underline" href="/app/settings#business-identity/identity-address-line1">add the business address</Link> : null}.
        </Callout>
      ) : null}
      <MoreMenu items={[statement, run.status !== "void" && { label: "Void the run", onSelect: () => setAsking({ kind: "void", reason: "" }) }]} />
      {run.status === "draft" ? <Button disabled={busy} onClick={() => void act({ action: "publish" }, "Published: the partner can now see it, and the cost is booked")}>Publish to partner</Button> : null}
      {run.status === "published" && run.netCents > 0 ? <Button disabled={busy} onClick={() => setAsking({ kind: "paid", on: today(), method: "ach", reference: "" })}>Mark paid</Button> : null}
      {asking ? (
        <ConfirmDialog
          open onOpenChange={(next) => { if (!next) setAsking(null); }} busy={busy} destructive={asking.kind === "void"}
          title={asking.kind === "paid" ? `Mark ${money(run.netCents)} to ${run.partnerName} paid?` : `Void this run for ${run.partnerName}?`}
          description={asking.kind === "paid" ? "Records when the money moved. Nothing is paid from here." : "Its cost is reversed and its open disputes are closed; the run stays on record."}
          confirmLabel={asking.kind === "paid" ? "Record payment" : "Void run"} cancelLabel="Keep it"
          confirmDisabled={asking.kind === "void" ? !asking.reason.trim() : !asking.on}
          onConfirm={() => void (asking.kind === "paid" ? act({ action: "paid", paid_on: asking.on, method: asking.method, reference: asking.reference || null }, "Marked paid") : act({ action: "void", reason: asking.reason }, "Voided"))}
          fields={asking.kind === "paid" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Paid on" htmlFor="payout-paid-on"><input id="payout-paid-on" type="date" className={control} value={asking.on} onChange={(e) => setAsking({ ...asking, on: e.target.value })} /></Field>
                <Field label="Method" htmlFor="payout-method"><select id="payout-method" className={control} value={asking.method} onChange={(e) => setAsking({ ...asking, method: e.target.value })}>{PAID_METHODS.map((m) => <option key={m} value={m}>{PAID_METHOD_LABELS[m]}</option>)}</select></Field>
              </div>
              <Field label="Reference" htmlFor="payout-ref"><input id="payout-ref" className={control} value={asking.reference} onChange={(e) => setAsking({ ...asking, reference: e.target.value })} /></Field>
            </>
          ) : <Field label="Why is it void?" htmlFor="payout-void"><input id="payout-void" className={control} autoFocus value={asking.reason} onChange={(e) => setAsking({ ...asking, reason: e.target.value })} /></Field>}
        />
      ) : null}
    </>
  );
}

/** Items tab, one draft item: dispute it, with a reason; it is withheld from this run. */
export function DisputeItem({ runId, itemId, label }: { runId: string; itemId: string; label: string }) {
  const router = useRouter();
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post(runId, { action: "dispute", item_id: itemId, reason });
      notify.done("Disputed: withheld from this run");
      setReason(null);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setReason("")}>Dispute</Button>
      {reason !== null ? (
        <ConfirmDialog open onOpenChange={(next) => { if (!next) setReason(null); }} busy={busy} destructive={false}
          title={`Dispute ${label}?`} description="It is withheld from this run, and the partner sees why once the run is published."
          confirmLabel="Dispute item" cancelLabel="Keep it" confirmDisabled={!reason.trim()} onConfirm={() => void save()}
          fields={<Field label="Reason" htmlFor="item-why"><input id="item-why" className={control} autoFocus placeholder="e.g. wrong number" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>} />
      ) : null}
    </>
  );
}

/** Disputes tab, an open dispute on a published run: accept it (paid on the next run) or uphold it. */
export function ResolveDispute({ runId, dispute }: { runId: string; dispute: Pick<RunDispute, "id" | "reason" | "claimCents"> }) {
  const router = useRouter();
  const [asking, setAsking] = useState<{ status: "accepted" | "upheld"; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      await post(runId, { action: "resolve", dispute_id: dispute.id, status: asking.status, note: asking.note });
      notify.done("Dispute resolved");
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
      <Button size="sm" variant="outline" onClick={() => setAsking({ status: "accepted", note: "" })}>Resolve</Button>
      {asking ? (
        <ConfirmDialog open onOpenChange={(next) => { if (!next) setAsking(null); }} busy={busy} destructive={false}
          title={`Resolve the ${money(dispute.claimCents)} dispute?`} description={dispute.reason}
          confirmLabel="Save" cancelLabel="Not now" confirmDisabled={!asking.note.trim()} onConfirm={() => void save()}
          fields={<>
            <Field label="Outcome" htmlFor="dispute-outcome"><select id="dispute-outcome" className={control} value={asking.status} onChange={(e) => setAsking({ ...asking, status: e.target.value as "accepted" | "upheld" })}><option value="accepted">Accept: paid on the next run</option><option value="upheld">Uphold: stays deducted</option></select></Field>
            <Field label="Why" htmlFor="dispute-note"><input id="dispute-note" className={control} value={asking.note} onChange={(e) => setAsking({ ...asking, note: e.target.value })} /></Field>
          </>} />
      ) : null}
    </>
  );
}

/** `partnerFixed`: one partner's runs on its record — no partner picker, Draft a run in the toolbar. `recordLinks`: partner names open the record. */
export function PayoutsBoard({ runs, partners, readOnly, status: initialStatus, partnerFixed = false, recordLinks = false }: { runs: RunRow[]; partners: Partner[]; readOnly: boolean; status?: string; partnerFixed?: boolean; recordLinks?: boolean }) {
  const router = useRouter();
  const [partner, setPartner] = useState(partnerFixed ? partners[0]?.id ?? "" : "");
  const [status, setStatus] = useState<"" | RunStatus>(initialStatus && initialStatus in RUN_STATUS_LABELS ? (initialStatus as RunStatus) : "");
  const [page, setPage] = useState(1);
  const [drafting, setDrafting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const visible = useMemo(() => runs.filter((r) => (!partner || r.partnerId === partner) && (!status || r.status === status)), [runs, partner, status]);
  const pageSize = useFittingPageSize(500, 45);
  const shown = paginate(visible, page, pageSize);
  const month = today().slice(0, 7);
  const drafts = runs.filter((r) => r.status === "draft");
  const owed = runs.filter((r) => r.status === "published");
  const paid = runs.filter((r) => r.status === "paid" && (r.paidOn ?? "").startsWith(month));
  const openPartners = partners.filter((p) => p.status !== "offboarded");
  const canDraft = !readOnly && openPartners.length > 0;
  return (
    <>
      <StatStrip label="Payout totals">
        <StatTile label="Drafts to review" value={String(drafts.length)} valueTone={drafts.length ? "warning" : undefined} footnote="the partner cannot see these" href={partnerFixed ? undefined : "/app/payouts?status=draft"} />
        <StatTile label="Published, unpaid" value={money(owed.reduce((s, r) => s + r.netCents, 0))} footnote={`${owed.length} run${owed.length === 1 ? "" : "s"} owed`} href={partnerFixed ? undefined : "/app/payouts?status=published"} />
        <StatTile label="Paid this month" value={money(paid.reduce((s, r) => s + r.netCents, 0))} footnote={`${paid.length} run${paid.length === 1 ? "" : "s"}`} href={partnerFixed ? undefined : "/app/payouts?status=paid"} />
      </StatStrip>
      <TableCard
        // No runs at all: the empty state's one button is the whole page; filters over nothing are noise.
        toolbar={runs.length === 0 ? undefined :
          <DataToolbar actions={<>{partnerFixed && canDraft ? <Button onClick={() => setDrafting(true)}>Draft a run</Button> : null}<RefreshButton onClick={refresh} refreshing={refreshing} /></>}>
            {!partnerFixed && <select aria-label="Partner" className={toolbarControl} value={partner} onChange={(e) => { setPartner(e.target.value); setPage(1); }}><option value="">All partners</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
            <select aria-label="Status" className={toolbarControl} value={status} onChange={(e) => { setStatus(e.target.value as "" | RunStatus); setPage(1); }}><option value="">Any status</option>{(["draft", "published", "paid", "void"] as RunStatus[]).map((s) => <option key={s} value={s}>{RUN_STATUS_LABELS[s]}</option>)}</select>
          </DataToolbar>
        }
        footer={visible.length > pageSize ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="runs" onPage={setPage} /> : undefined}
      >
        {runs.length === 0 ? (
          <EmptyState title="No payout runs yet" hint={openPartners.length ? "Draft one for a partner and a month: it is priced from the terms on the partner's record." : "Add a partner with payout terms first."} action={canDraft ? <Button onClick={() => setDrafting(true)}>Draft a run</Button> : undefined} />
        ) : visible.length === 0 ? (
          <NoMatches noun="runs" onClear={() => { setPartner(partnerFixed ? partner : ""); setStatus(""); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead><tr><th>Partner</th><th>Period</th><th className="text-right">Net payable</th><th>Status</th><th className="text-right"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {shown.rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{recordLinks && !partnerFixed ? <Link href={`/app/publishers/${r.partnerId}?tab=payouts`} className="text-foreground underline-offset-4 hover:underline">{r.partnerName}</Link> : r.partnerName}</td>
                  <td className="tabular-nums">{r.periodStart} to {r.periodEnd}</td>
                  <td className="text-right tabular-nums">{money(r.netCents)}</td>
                  <td><RunStatusChip status={r.status} paidOn={r.paidOn} /></td>
                  <td className="text-right"><Button size="sm" variant="outline" asChild><Link href={`/app/payouts/${r.id}`}>Open</Link></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {drafting ? <DraftRun partners={openPartners} onClose={() => setDrafting(false)} /> : null}
    </>
  );
}
