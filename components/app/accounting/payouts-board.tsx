"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Field, control } from "@/components/ui/field";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Segmented } from "@/components/ui/view-tabs";
import { RUN_STATUS_LABELS, type RunHeader, type RunStatus } from "@/lib/accounting/payoutsCore";
import { defaultPayoutPeriod, periodHasTerms } from "@/lib/accounting/payoutPeriod";
import { invoiceRef } from "@/lib/accounting/partnerPayoutCore";
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

/**
 * The step's header: Draft a payout run (the one primary). Once the partner ledger is live (2026-11-06) Run
 * payouts is the primary and this drafts one partner for a period of your choosing (`secondary`).
 */
export function PayoutActions({ partners, readOnly, secondary = false }: { partners: Partner[]; readOnly: boolean; secondary?: boolean }) {
  const [drafting, setDrafting] = useState(false);
  const open = partners.filter((p) => p.status !== "offboarded");
  if (readOnly || open.length === 0) return null;
  return (
    <>
      <Button variant={secondary ? "outline" : undefined} onClick={() => setDrafting(true)}>{secondary ? "Draft one partner" : "Draft a payout run"}</Button>
      {drafting ? <DraftRun partners={open} onClose={() => setDrafting(false)} /> : null}
    </>
  );
}

/*
 * An invoice's own actions (Publish & share, Mark paid, Void, dispute an item, resolve a dispute) moved to
 * components/app/commissions/partner-payouts/invoice-parts.tsx with the invoice page (round 7, 2026-11-10).
 */

/**
 * Where an invoice stands, in the words of what to do next (/ui-taste pass, owner 2026-11-09, "like Bank
 * deposits"): a draft that owes something is To review; a published one with money owed is To pay; a run
 * that nets to nothing says so instead of sitting among the drafts.
 */
type InvoiceState = "review" | "pay" | "paid" | "nothing" | "void";
const STATE_ORDER: InvoiceState[] = ["review", "pay", "paid", "nothing", "void"];
const stateOf = (r: RunHeader): InvoiceState => (r.status === "void" ? "void" : r.status === "paid" ? "paid" : r.netCents === 0 ? "nothing" : r.status === "draft" ? "review" : r.netCents > 0 ? "pay" : "nothing");
const STATE_CHIP: Record<InvoiceState, { tone: StatusTone; label: string }> = {
  review: { tone: "warning", label: "To review" },
  pay: { tone: "info", label: "To pay" },
  paid: { tone: "good", label: "Paid" },
  nothing: { tone: "neutral", label: "Nothing owed" },
  void: { tone: "neutral", label: "Void" },
};
const NEXT_STEP: Record<InvoiceState, string | null> = { review: "Review ›", pay: "Pay ›", paid: null, nothing: null, void: null };
/** The day `n` days before today, as YYYY-MM-DD. */
function daysBefore(n: number): string {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const PERIODS = [{ key: "90", label: "Last 90 days" }, { key: "365", label: "Last 12 months" }, { key: "all", label: "All time" }] as const;
const periodLabel = (start: string, end: string) => {
  const f = (d: string, year: boolean) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  return `${f(start, start.slice(0, 4) !== end.slice(0, 4))} – ${f(end, true)}`;
};

/** `partnerFixed`: one partner's runs on its record — no partner search, Draft a run in the toolbar. `recordLinks`: partner names open the record. */
export function PayoutsBoard({ runs, partners, readOnly, status: initialStatus, partnerFixed = false, recordLinks = false }: { runs: RunRow[]; partners: Partner[]; readOnly: boolean; status?: string; partnerFixed?: boolean; recordLinks?: boolean }) {
  const router = useRouter();
  const legacy: Record<string, InvoiceState> = { draft: "review", published: "pay", paid: "paid", void: "void" };
  const [filter, setFilter] = useState<"all" | InvoiceState>(initialStatus ? (legacy[initialStatus] ?? (STATE_ORDER.includes(initialStatus as InvoiceState) ? (initialStatus as InvoiceState) : "all")) : "all");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("365");
  const [page, setPage] = useState(1);
  const [drafting, setDrafting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const since = period === "all" ? "" : daysBefore(Number(period));
  const inPeriod = useMemo(() => runs.filter((r) => !since || r.periodEnd >= since), [runs, since]);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => inPeriod
    .filter((r) => filter === "all" || stateOf(r) === filter)
    .filter((r) => !needle || r.partnerName.toLowerCase().includes(needle) || (r.invoiceNumber ?? "").toLowerCase().includes(needle))
    .sort((a, b) => STATE_ORDER.indexOf(stateOf(a)) - STATE_ORDER.indexOf(stateOf(b)) || b.periodEnd.localeCompare(a.periodEnd)), [inPeriod, filter, needle]);
  const pageSize = useFittingPageSize(500, 52);
  const shown = paginate(visible, page, pageSize);
  const month = today().slice(0, 7);
  const of = (s: InvoiceState) => inPeriod.filter((r) => stateOf(r) === s);
  const review = of("review");
  const owed = of("pay");
  const paid = runs.filter((r) => r.status === "paid" && (r.paidOn ?? "").startsWith(month));
  const openPartners = partners.filter((p) => p.status !== "offboarded");
  const canDraft = !readOnly && openPartners.length > 0;
  const pick = (f: "all" | InvoiceState) => { setFilter(f); setPage(1); };
  return (
    <>
      {!(partnerFixed && runs.length === 0) && <StatStrip label="Payout totals">
        <StatTile label="To review" value={money(review.reduce((s, r) => s + r.netCents, 0))} footnote={review.length ? <><StatusChip tone="warning">{`${review.length} draft${review.length === 1 ? "" : "s"}`}</StatusChip> the partner cannot see these</> : "Nothing waiting"} href={partnerFixed ? undefined : "/app/payouts?status=review"} />
        <StatTile label="To pay" value={money(owed.reduce((s, r) => s + r.netCents, 0))} footnote={`${owed.length} published invoice${owed.length === 1 ? "" : "s"}`} href={partnerFixed ? undefined : "/app/payouts?status=pay"} />
        <StatTile label="Paid this month" value={money(paid.reduce((s, r) => s + r.netCents, 0))} footnote={`${paid.length} invoice${paid.length === 1 ? "" : "s"}`} href={partnerFixed ? undefined : "/app/payouts?status=paid"} />
      </StatStrip>}
      <TableCard
        // No runs at all: the empty state's one button is the whole page; filters over nothing are noise.
        toolbar={runs.length === 0 ? undefined :
          <DataToolbar actions={<>
            {partnerFixed && canDraft ? <Button variant="outline" onClick={() => setDrafting(true)}>Draft a run</Button> : null}
            <select aria-label="Period" className={toolbarControl} value={period} onChange={(e) => { setPeriod(e.target.value as typeof period); setPage(1); }}>{PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
            <RefreshButton onClick={refresh} refreshing={refreshing} />
          </>}>
            {!partnerFixed && <ToolbarSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search partner or invoice" />}
            <Segmented label="Invoice status" value={filter} onChange={pick} options={[
              { key: "all", label: "All", count: inPeriod.length },
              { key: "review", label: "To review", count: review.length || null },
              { key: "pay", label: "To pay", count: owed.length || null },
              { key: "paid", label: "Paid", count: of("paid").length || null },
              { key: "nothing", label: "Nothing owed", count: of("nothing").length || null },
            ]} />
          </DataToolbar>
        }
        footer={visible.length > pageSize ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="invoices" onPage={setPage} /> : undefined}
      >
        {runs.length === 0 ? (
          <EmptyState title="No invoices yet" hint={openPartners.length ? "Run payouts makes one for every partner whose pay period has ended, priced from their rulebook." : "Add a partner and set its rulebook first."} action={canDraft ? <Button onClick={() => setDrafting(true)}>Draft a run</Button> : undefined} />
        ) : visible.length === 0 ? (
          <NoMatches noun="invoices" onClear={() => { setSearch(""); setPeriod("all"); pick("all"); }} />
        ) : (
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th className="w-[24%]">{partnerFixed ? "Invoice" : "Partner"}</th>{partnerFixed ? null : <th className="w-[16%]">Invoice</th>}<th className="w-[20%]">Pay period</th><th className="w-[12%] text-right">Amount</th><th className="w-[16%]">Status</th><th>Next step</th></tr></thead>
            <tbody>
              {shown.rows.map((r) => {
                const state = stateOf(r);
                const next = readOnly ? null : NEXT_STEP[state];
                // A run that nets below zero says so in its chip; the amount keeps its minus sign, never a colour.
                const owesYou = r.netCents < 0 && state !== "void";
                return (
                  <tr key={r.id} className="cursor-pointer" onClick={() => router.push(`/app/payouts/${r.id}`)}>
                    <td className="whitespace-nowrap font-medium">
                      {partnerFixed ? invoiceRef(r)
                        : recordLinks ? <Link href={`/app/publishers/${r.partnerId}?tab=terms`} className="text-foreground underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>{r.partnerName}</Link>
                        : r.partnerName}
                    </td>
                    {partnerFixed ? null : <td className="whitespace-nowrap">{invoiceRef(r)}</td>}
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{periodLabel(r.periodStart, r.periodEnd)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{money(r.netCents)}</td>
                    <td><StatusChip tone={owesYou ? "warning" : STATE_CHIP[state].tone}>{state === "paid" && r.paidOn ? `Paid ${dateLabel(r.paidOn)}` : owesYou ? "Owes you · next invoice" : STATE_CHIP[state].label}</StatusChip></td>
                    <td className="whitespace-nowrap">{next ?? "Open ›"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
      {drafting ? <DraftRun partners={openPartners} onClose={() => setDrafting(false)} /> : null}
    </>
  );
}
