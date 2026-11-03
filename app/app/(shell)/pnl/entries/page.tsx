import Link from "next/link";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { resolvePeriod } from "@/lib/accounting/pnlCore";
import { pnlHref } from "@/lib/accounting/pnlLinks";
import { drill, PnlError, reportingSettings } from "@/lib/accounting/pnlStore";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { Button } from "@/components/ui/button";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState, ErrorState } from "@/components/ui/page-states";

/**
 * Accounting › Profit & loss › a line (LA-7.7 drill-through; foundation pass 2026-11-03): the entries behind
 * one P&L line, each linked to its source document, as a detail page in the step — it was a side sheet.
 * The same reads and checks as /api/app/accounting/pnl/drill. Owner and bookkeeper only; opening it writes
 * nothing. 200 entries a server page, the shared Pager inside it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTIONS = ["in", "held", "acquisition", "overhead", "splits"] as const;
const SOURCES = ["partner", "vendor", "expense_category"] as const;
type Search = { kind?: string; anchor?: string; from?: string; to?: string; basis?: string; section?: string; entry_type?: string; source_type?: string; source_id?: string; category?: string; label?: string; page?: string };

export default async function PnlEntriesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Profit & loss" description="Money in, money out, and what a lasting policy really cost." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Profit & loss" detail="Only owners and bookkeepers can see the agency's profit and loss." />;
  const q = await searchParams;
  const tenantId = guard.context.tenantId;
  const title = (q.label ?? "").trim().slice(0, 120) || "Entries";
  const section = SECTIONS.find((s) => s === q.section);
  const entryType = q.entry_type ?? "";
  const sourceType = SOURCES.find((s) => s === q.source_type) ?? null;
  const sourceId = q.source_id ?? null;
  const page = Math.max(0, Number(q.page ?? 0) || 0);

  const settings = await reportingSettings(tenantId);
  const period = resolvePeriod(q, { basis: settings.basis, fyStartMonth: settings.fyStartMonth, today: new Date().toISOString().slice(0, 10) });
  if (!section || !/^[a-z_]{2,40}$/.test(entryType) || (sourceId && !UUID.test(sourceId)) || "error" in period) {
    return <AccountingPage step="pnl" title={title}><ErrorState detail={"error" in period ? period.error : "This line is not on the statement."} /></AccountingPage>;
  }
  let result: Awaited<ReturnType<typeof drill>> | null = null;
  let problem: string | null = null;
  try {
    result = await drill(tenantId, { range: period.range, basis: period.basis, section, entryType, sourceType, sourceId, category: q.category ?? null, page });
  } catch (error) {
    if (!(error instanceof PnlError)) throw error;
    problem = error.message;
  }
  const back = pnlHref({ kind: period.kind, anchor: period.range.from.slice(0, 7), from: q.from ?? "", to: q.to ?? "", basis: period.basis });
  const rows = result?.rows ?? [];
  const sum = rows.reduce((total, r) => total + r.amountCents, 0);
  const cash = period.basis === "cash";
  // Another 200, or the 200 before, keep every filter of the line.
  const pageHref = (to: number) => { const p = new URLSearchParams(q as Record<string, string>); p.set("page", String(to)); return `/app/pnl/entries?${p}`; };
  const facts = [period.range.label, cash ? "Cash basis" : "Accrual basis", `${rows.length}${result?.more ? "+" : ""} entr${rows.length === 1 ? "y" : "ies"}`, ...(result?.more || page ? [] : [formatCentsAsCurrency(sum)])].join(" · ");

  return (
    <AccountingPage
      step="pnl"
      title={title}
      facts={facts}
    >
      {problem ? <ErrorState detail={problem} /> : (
        <PagedTableCard
          total={rows.length}
          noun="entries"
          suffix={page > 0 || result?.more ? <span className="inline-flex gap-2">{page > 0 && <Link className="underline" href={pageHref(page - 1)}>Earlier 200</Link>}{result?.more && <Link className="underline" href={pageHref(page + 1)}>Next 200</Link>}</span> : undefined}
        >
          {rows.length === 0 ? <EmptyState title="No entries" hint="Nothing was recorded on this line in the period." action={<Button asChild variant="outline"><Link href={back}>Back to the statement</Link></Button>} /> : (
            <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
              <thead><tr><th className="w-[120px]">{cash ? "Paid" : "For"}</th><th>Entry</th><th className="w-[160px]">Source</th><th className="w-[140px] text-right">Amount</th></tr></thead>
              <PagedBody>
                {rows.map((r) => (
                  <tr key={r.entryId}>
                    <td className="whitespace-nowrap tabular-nums">{(cash ? r.paidOn : r.incurredOn) ?? "—"}</td>
                    <td>{r.description ?? (r.policyNumber ? `Policy ${r.policyNumber}` : "Entry")}{r.reversesEntryId ? <span className="text-xs text-muted-foreground"> · reversal</span> : null}</td>
                    <td>{r.source ? <Link className="font-semibold text-[var(--accent-ink)] hover:underline" href={r.source.href}>{r.source.label}</Link> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="text-right tabular-nums">{formatCentsAsCurrency(r.amountCents)}</td>
                  </tr>
                ))}
              </PagedBody>
            </table>
          )}
        </PagedTableCard>
      )}
    </AccountingPage>
  );
}
