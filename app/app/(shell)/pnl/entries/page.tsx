import Link from "next/link";
import { Suspense } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { lineKey, namedRange, readableDate, resolvePeriod, statementOrder } from "@/lib/accounting/pnlCore";
import { entriesHref, lineLabel, pnlHref, queryFor } from "@/lib/accounting/pnlLinks";
import { drill, PnlError, reportingSettings, statementRows } from "@/lib/accounting/pnlStore";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { PnlBasisChips } from "@/components/app/accounting/pnl-board";
import { neighboursOf, RecordStepper } from "@/components/app/accounting/record-stepper";
import { Button } from "@/components/ui/button";
import { DataToolbar } from "@/components/ui/data-toolbar";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { StreamSection, TitleShape } from "@/components/ui/stream-section";
import { accountingStepLabel } from "@/lib/accounting/steps";
import { TableCard } from "@/components/ui/table-card";

/**
 * Accounting › Profit & loss › a line (LA-7.7 drill-through; foundation pass 2026-11-03): the entries behind
 * one P&L line, each linked to its source document, as a detail page in the step — it was a side sheet.
 * The same reads and checks as /api/app/accounting/pnl/drill. Owner and bookkeeper only; opening it writes
 * nothing. 200 entries a server page, the shared Pager inside it.
 *
 * Round 7 (owner 2026-11-10, mockups-r7/accounting.html 5·2): the title is the line and the period alone, named
 * from the statement (never from the address); its figures are one strip (This line · Period before · In the bank);
 * ‹ › name the statement's neighbouring lines for the same period and basis; the basis switches in the toolbar;
 * an entry opens its source's own page. A line the statement does not have says so, with the way back.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS = ["in", "held", "acquisition", "overhead", "splits"] as const;
const SOURCES = ["partner", "vendor", "expense_category"] as const;
type Search = { kind?: string; anchor?: string; from?: string; to?: string; basis?: string; section?: string; entry_type?: string; source_type?: string; source_id?: string; category?: string; page?: string };

export default async function PnlEntriesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Profit & loss" description="Money in, money out, and what a lasting policy really cost." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Profit & loss" detail="Only owners and bookkeepers can see the agency's profit and loss." />;
  const q = await searchParams;
  const tenantId = guard.context.tenantId;
  const section = SECTIONS.find((s) => s === q.section);
  const entryType = q.entry_type ?? "";
  const sourceType = SOURCES.find((s) => s === q.source_type) ?? null;
  const sourceId = q.source_id ?? null;
  const category = q.category ?? null;
  const page = Math.max(0, Number(q.page ?? 0) || 0);

  const validLine = Boolean(section) && /^[a-z_]{2,40}$/.test(entryType) && !(sourceId && !UUID.test(sourceId));
  // Frame first (UI-CONSISTENCY §7a): the settings, the statement and the entries are read now; the line's name, its
  // ‹ › and its figures stream in under the trail.
  const read: LineRead = (async () => {
    const settings = await reportingSettings(tenantId);
    const period = resolvePeriod(q, { basis: settings.basis, fyStartMonth: settings.fyStartMonth, today: new Date().toISOString().slice(0, 10) });
    if ("error" in period) return { kind: "invalid", detail: period.error } as const;
    const query = queryFor(period.kind, period.basis, period.range);
    const back = pnlHref(query);
    if (!section || !validLine) return { kind: "missing", label: period.range.label, back } as const;
    // The statement (for the line's name, its neighbours and its figures) and the entries start together.
    const full = statementRows(tenantId, period);
    full.catch(() => {});
    let result: Awaited<ReturnType<typeof drill>> | null = null;
    let problem: string | null = null;
    try {
      result = await drill(tenantId, { range: period.range, basis: period.basis, section, entryType, sourceType, sourceId, category, page });
    } catch (error) {
      if (!(error instanceof PnlError)) throw error;
      problem = error.message;
    }
    let statement: Awaited<typeof full> | null = null;
    try {
      statement = await full;
    } catch (error) {
      if (!(error instanceof PnlError)) throw error;
      problem = error.message;
    }
    if (problem || !statement) return { kind: "invalid", detail: problem ?? "The statement could not be read." } as const;
    const order = statementOrder(statement.rows);
    const key = lineKey({ section, entryType, sourceType, sourceId, sourceName: category });
    const row = order.find((r) => r.key === key);
    if (!row) return { kind: "missing", label: period.range.label, back } as const;
    const { previous, next } = neighboursOf(order, key, (r) => r.key);
    const neighbour = (n: typeof row | null) => (n ? { href: entriesHref(n.line, query), label: lineLabel(n.line) } : null);
    return { kind: "line", settings, period, query, back, statement, row, result, title: `${lineLabel(row.line)} · ${period.range.label}`, previous: neighbour(previous), next: neighbour(next) } as const;
  })();

  return (
    <AccountingPage
      step="pnl"
      title={<Suspense fallback={<TitleShape />}><LineTitle read={read} /></Suspense>}
      stepper={<Suspense fallback={<span aria-hidden="true" className="h-9" />}><LineStepper read={read} /></Suspense>}
    >
      <StreamSection shape="strip+table">
        <LineBody read={read} q={q} page={page} />
      </StreamSection>
    </AccountingPage>
  );
}

type LineRead = Promise<
  | { kind: "invalid"; detail: string }
  | { kind: "missing"; label: string; back: string }
  | {
    kind: "line";
    settings: Awaited<ReturnType<typeof reportingSettings>>;
    period: Exclude<ReturnType<typeof resolvePeriod>, { error: string }>;
    query: ReturnType<typeof queryFor>;
    back: string;
    statement: Awaited<ReturnType<typeof statementRows>>;
    row: ReturnType<typeof statementOrder>[number];
    result: Awaited<ReturnType<typeof drill>> | null;
    title: string;
    previous: { href: string; label: string } | null;
    next: { href: string; label: string } | null;
  }
>;

async function LineTitle({ read }: { read: LineRead }) {
  const line = await read;
  return line.kind === "line" ? line.title : accountingStepLabel("pnl");
}

async function LineStepper({ read }: { read: LineRead }) {
  const line = await read;
  return line.kind === "line" ? <RecordStepper noun="line" previous={line.previous} next={line.next} /> : null;
}

async function LineBody({ read, q, page }: { read: LineRead; q: Search; page: number }) {
  const found = await read;
  if (found.kind === "invalid") return <ErrorState detail={found.detail} />;
  if (found.kind === "missing") {
    return <TableCard><EmptyState title="This line is not on the statement." hint={`Nothing on the ${found.label} statement matches this address.`} action={<Button asChild variant="outline"><Link href={found.back}>Back to the statement</Link></Button>} /></TableCard>;
  }
  const { settings, period, query, back, statement, row, result } = found;
  const line = row.line;
  const prevQuery = queryFor(period.kind, period.basis, statement.previous);
  const cash = period.basis === "cash";
  const basisWord = cash ? "cash basis" : "accrual basis";
  const rows = result?.rows ?? [];
  // Another 200, or the 200 before, keep every filter of the line.
  const pageHref = (to: number) => { const p = new URLSearchParams(q as Record<string, string>); p.set("page", String(to)); return `/app/pnl/entries?${p}`; };
  const money = formatCentsAsCurrency;

  return (
    <>
      <StatStrip label="This line">
        <StatTile label="This line" value={row.cur === null ? "—" : money(row.cur)} footnote={row.cur === null ? `nothing in ${period.range.label}` : `${line.entries} entr${line.entries === 1 ? "y" : "ies"} · ${basisWord}`} />
        <StatTile label={period.kind === "custom" ? "Period before" : `${period.kind[0].toUpperCase()}${period.kind.slice(1)} before`} value={row.prev === null ? "—" : money(row.prev)} footnote={namedRange(period.kind, statement.previous, settings.fyStartMonth)} href={entriesHref(line, prevQuery)} />
        {row.bank.kind === "cents" ? <StatTile label="In the bank" value={money(row.bank.cents)} footnote={cash ? "paid in the period" : `${row.bank.paid} of ${row.bank.of} paid`} /> : null}
      </StatStrip>
      <PagedTableCard
        total={rows.length}
        noun="entries"
        toolbar={<DataToolbar actions={<PnlBasisChips value={period.basis} hrefs={{ accrual: entriesHref(line, { ...query, basis: "accrual" }), cash: entriesHref(line, { ...query, basis: "cash" }) }} />} />}
        suffix={page > 0 || result?.more ? <span className="inline-flex gap-2">{page > 0 && <Link className="underline" href={pageHref(page - 1)}>Earlier 200</Link>}{result?.more && <Link className="underline" href={pageHref(page + 1)}>Next 200</Link>}</span> : undefined}
      >
        {rows.length === 0 ? <EmptyState title="No entries" hint={`Nothing was recorded on this line in ${period.range.label}.`} action={<Button asChild variant="outline"><Link href={back}>Back to the statement</Link></Button>} /> : (
          <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead><tr><th className="w-[140px]">{cash ? "Paid" : "For"}</th><th>Entry</th><th>Source</th><th className="w-[120px]">Kind</th><th className="w-[140px] text-right">Amount</th></tr></thead>
            <PagedBody>
              {rows.map((r) => {
                const date = cash ? r.paidOn : r.incurredOn;
                return (
                  <tr key={r.entryId} className="hover:bg-[var(--surface-alt)]">
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{date ? readableDate(date) : "—"}</td>
                    <td className="whitespace-nowrap">{r.description ?? (r.policyNumber ? `Policy ${r.policyNumber}` : "Entry")}</td>
                    <td className="whitespace-nowrap">{r.source ? <Link className="text-foreground hover:underline" href={r.source.href}>{r.source.label}</Link> : <span className="text-muted-foreground">—</span>}</td>
                    <td>{r.reversesEntryId ? <StatusChip tone="neutral">Reversal</StatusChip> : null}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{money(r.amountCents)}</td>
                  </tr>
                );
              })}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>
    </>
  );
}
