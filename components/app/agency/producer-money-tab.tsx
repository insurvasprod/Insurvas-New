"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, toolbarControl } from "@/components/ui/data-toolbar";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { dollars } from "@/lib/agency/constants";
import { PAY_MODEL_LABELS, planSummary } from "@/lib/agency/payPlanCore";
import { fileDay } from "@/lib/ingestion/constants";
import { entryLabel, isPaid, moneyFigures, moneyLists, monthLabel, type Entry, type MoneyData, type MoneyView, type StatementRow } from "@/components/app/commissions/producer-pay/money-core";
import { BasisChip } from "./money";
import { useAgencyData } from "./use-agency-data";

const policyHref = (carrierId: string, policyNumber: string) => `/app/policies/carrier/${carrierId}/${encodeURIComponent(policyNumber)}?tab=commissions`;
const VIEW_LABEL: Record<MoneyView, string> = { ledger: "Ledger", statements: "Statements", chargebacks: "Chargebacks" };
const MUTED_DASH = <span className="text-muted-foreground">—</span>;

/** A figure in a row: plain, one colour (the strip above carries the red for a negative balance). */
function Plain({ cents }: { cents: number | null | undefined }) {
  if (cents === null || cents === undefined) return MUTED_DASH;
  return <span className="tabular-nums">{dollars(cents)}</span>;
}

/**
 * AG-1.5 / AG-1.8 · a producer's money, round 7 (owner 2026-11-10, docs/la4/mockups-r7/commissions.html 4·1 and 5·A):
 * the strip, then one table: the ledger (newest first), the months as statements, or the chargebacks. A negative
 * balance is normal and shown in red, never clamped. Every row opens what it came from: a ledger line its policy's
 * commissions (or, paid out, its statement), a month its producer statement.
 *
 *   The owner's view (the producer page's Money tab): Ledger · Statements · Chargebacks are chips over the table
 *   (the tab is Money; a second bar isn't allowed), with a month select; the words are the owner's ("Paid to Marcus").
 *   My pay (the producer himself): the page's own tabs and year pick the table; the words are his ("Paid to you").
 */
export function ProducerMoneyTab({ url, data: given, audience = "owner", name, view: fixedView, initialView = "ledger", selection: fixedSelection, initialSelection = "all", months = [] }: {
  /** Read in the browser (the producer page). */
  url?: string;
  /** Read by the page (My pay). */
  data?: MoneyData;
  audience?: "owner" | "self";
  /** The producer's name, for the owner's words. */
  name?: string;
  /** My pay: the page's tab. */
  view?: MoneyView;
  initialView?: MoneyView;
  /** My pay: the page's year ("2026"). */
  selection?: string;
  /** The owner's month select: "all" or "YYYY-MM". */
  initialSelection?: string;
  /** The owner's month select options, newest first. */
  months?: ReadonlyArray<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const fetched = useAgencyData<MoneyData>(given ? null : url ?? null);
  const data = given ?? fetched.data;
  const [chip, setChip] = useState<MoneyView>(initialView);
  const [month, setMonth] = useState(initialSelection);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 45);
  if (!given && fetched.error) return <ErrorState detail={fetched.error} />;
  if (!data) return <SectionLoading rows={6} columns={5} label="Loading pay" />;

  const self = audience === "self";
  const first = name?.split(" ")[0] ?? null;
  const view = fixedView ?? chip;
  const selection = fixedSelection ?? month;
  const lists = moneyLists(data, selection);
  const figures = moneyFigures(data, selection);
  const yearOf = /^\d{4}/.exec(selection)?.[0] ?? new Date().toISOString().slice(0, 4);
  const paidYear = moneyFigures(data, yearOf);
  const span = selection === "all" ? "all time" : /^\d{4}$/.test(selection) ? selection : monthLabel(selection).split(" ")[0];
  const owed = figures.owed;
  const plan = data.plan ?? null;

  const strip = (
    <StatStrip label={self ? "Your pay" : `${name ?? "The producer"}'s pay`}>
      <StatTile label={self ? "Owed to you" : "Owed · reported"} value={dollars(owed?.balanceCents ?? 0)}
        footnote={owed && owed.balanceCents < 0 ? <StatusChip tone="danger">{self ? "You owe the agency" : "Owes the agency"}</StatusChip> : self ? "reported · now" : "now, after payouts"} />
      <StatTile label={self ? `Earned in ${span}` : `Earned · ${span}`} value={dollars(figures.earnedCents)} footnote={`${figures.policies} ${figures.policies === 1 ? "policy" : "policies"}`} />
      <StatTile label={self ? `Charged back in ${span}` : "Charged back"} value={dollars(figures.chargedBackCents)} footnote={figures.chargedBackCents < 0 ? <StatusChip tone="danger">{`${figures.chargebacks} ${figures.chargebacks === 1 ? "chargeback" : "chargebacks"}`}</StatusChip> : `${figures.chargebacks} ${figures.chargebacks === 1 ? "chargeback" : "chargebacks"}`} />
      <StatTile label={self ? `Paid to you in ${yearOf}` : `Paid out · ${yearOf}`} value={dollars(paidYear.paidCents)} footnote={`${paidYear.statements} ${paidYear.statements === 1 ? "statement" : "statements"}`} />
      <StatTile label={self ? "Your pay plan" : "Pay plan"} valueSize="text" value={plan ? PAY_MODEL_LABELS[plan.model] : "Contract level"} footnote={plan ? planSummary(plan) : "paid by contract level"} />
    </StatStrip>
  );

  const counts: Record<MoneyView, number> = { ledger: lists.ledger.length, statements: lists.statements.filter((s) => s.runId).length, chargebacks: lists.chargebacks.length };
  const toolbar = fixedView ? undefined : (
    <DataToolbar actions={<span className="text-sm text-muted-foreground">Newest first</span>}>
      <span role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
        {(["ledger", "statements", "chargebacks"] as MoneyView[]).map((key) => (
          <ToggleChip key={key} role="radio" selected={view === key} count={counts[key]} onClick={() => { setChip(key); setPage(1); }}>{VIEW_LABEL[key]}</ToggleChip>
        ))}
      </span>
      {months.length > 0 && (
        <label className="inline-flex">
          <span className="sr-only">Month</span>
          <select className={toolbarControl} value={month} onChange={(event) => { setMonth(event.target.value); setPage(1); }}>
            <option value="all">Every month</option>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      )}
    </DataToolbar>
  );

  const go = (href: string | null) => (event: MouseEvent<HTMLElement>) => {
    if (!href || (event.target as HTMLElement).closest("a, button")) return;
    router.push(href);
  };
  const entryHref = (e: Entry) => (isPaid(e) && e.payoutRunId ? `/app/producer-statements/${e.payoutRunId}` : e.carrierId && e.policyNumber ? policyHref(e.carrierId, e.policyNumber) : e.payoutRunId ? `/app/producer-statements/${e.payoutRunId}` : null);
  const policyCell = (e: Entry) => (
    !e.policyNumber ? MUTED_DASH
      : e.carrierId ? <Link href={policyHref(e.carrierId, e.policyNumber)} className="hover:underline">{e.policyNumber}</Link>
      : e.policyNumber
  );

  let body;
  let total = 0;
  let current = 1;
  let noun = "entries";
  let note = "Newest first · a correction is a new entry, never an edit";
  if (view === "statements") {
    const shown = paginate(lists.statements, page, pageSize);
    total = lists.statements.length; current = shown.current; noun = "months"; note = "Each month opens its statement, line by line";
    const statusOf = (s: StatementRow) => (s.status === "paid" ? <StatusChip tone="good">Paid {fileDay(s.paidOn)}</StatusChip> : s.status === "published" ? <StatusChip tone="info">Published</StatusChip> : <StatusChip tone="neutral">Not paid yet</StatusChip>);
    body = lists.statements.length === 0 ? <EmptyState title="No statements yet" hint="A statement appears here each time the agency pays the month." /> : (
      <Table>
        <TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Earned</TableHead><TableHead className="text-right">Taken back</TableHead><TableHead className="text-right">{self ? "Paid to you" : first ? `Paid to ${first}` : "Paid"}</TableHead><TableHead>How</TableHead></TableRow></TableHeader>
        <TableBody>
          {shown.rows.map((s) => {
            const href = s.runId ? `/app/producer-statements/${s.runId}` : null;
            return (
              <TableRow key={s.key} className={href ? "cursor-pointer" : undefined} onClick={go(href)}>
                <TableCell className="font-medium">{href ? <Link href={href} className="hover:underline">{monthLabel(s.month)}</Link> : monthLabel(s.month)}</TableCell>
                <TableCell>{statusOf(s)}</TableCell>
                <TableCell className="text-right"><Plain cents={s.earnedCents} /></TableCell>
                <TableCell className="text-right"><Plain cents={s.takenBackCents} /></TableCell>
                <TableCell className="text-right"><Plain cents={s.paidCents} /></TableCell>
                <TableCell className="whitespace-nowrap">{s.how || MUTED_DASH}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  } else {
    const rows = view === "chargebacks" ? lists.chargebacks : lists.ledger;
    const shown = paginate(rows, page, pageSize);
    total = rows.length; current = shown.current; noun = view === "chargebacks" ? "chargebacks" : "entries";
    if (view === "chargebacks") note = "Newest first · each opens its policy";
    body = rows.length === 0 ? (
      <EmptyState title={view === "chargebacks" ? "No chargebacks" : "No entries yet"} hint={view === "chargebacks" ? "Nothing came back in this period." : "Entries appear as carrier statements are posted."} />
    ) : (
      <Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Entry</TableHead><TableHead>Client</TableHead><TableHead>Policy</TableHead><TableHead>Carrier</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>
          {shown.rows.map((e) => {
            const href = entryHref(e);
            return (
              <TableRow key={e.id} className={href ? "cursor-pointer" : undefined} onClick={go(href)}>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(e.occurredOn)}</TableCell>
                <TableCell className="whitespace-nowrap" title={e.reason ?? undefined}>
                  <span className="inline-flex items-center gap-2">{entryLabel(e.entryType, self ? null : first)}<BasisChip basis={e.basis} /></span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{e.clientName ?? MUTED_DASH}</TableCell>
                <TableCell className="whitespace-nowrap">{policyCell(e)}</TableCell>
                <TableCell className="whitespace-nowrap">{e.carrierName ?? MUTED_DASH}</TableCell>
                <TableCell className="text-right">{href ? <Link href={href} className="tabular-nums hover:underline">{dollars(e.amountCents)}</Link> : <Plain cents={e.amountCents} />}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="flex min-h-0 flex-grow flex-col gap-4">
      {strip}
      <TableCard toolbar={toolbar} footer={total ? <Pager page={current} total={total} noun={noun} pageSize={pageSize} onPage={setPage} suffix={note} /> : undefined}>
        {body}
      </TableCard>
    </div>
  );
}
