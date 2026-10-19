import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { guardPage } from "@/lib/entitlements/guardPage";
import { hasFeature } from "@/lib/entitlements/types";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RecordLapseSignal } from "@/components/app/record-lapse-signal";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState } from "@/components/ui/page-states";
import { TabbedSections } from "@/components/app/book-views";
import { getCarrierLibrary } from "@/lib/carriers/service";
import { DISCREPANCY_KIND_LABELS } from "@/lib/discrepancies/compute";
import { listDiscrepancies } from "@/lib/discrepancies/service";
import { computeLedger } from "@/lib/ledger/compute";
import { statusChangedAt, type BookPolicyRow } from "@/lib/ledger/service";
import { STATEMENT_KIND_LABELS, isRecordId, statementDay, statementMoney, statementPeriod } from "@/lib/ledger/statementConstants";
import { getPolicyStatementLines } from "@/lib/ledger/statementService";
import { leadSourceOf } from "@/lib/persistency/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { rowVisible, scopeFor } from "@/lib/agency/visibility";
import { roleCanViewCommission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › one policy (LA-4.9): everything about its money on one page.
 *
 *   · what the contract expects — the ledger's entries for it, each from a schedule row;
 *   · what the carrier reported — its accepted statement lines;
 *   · the chargeback exposure still running, and the day the clawback window closes;
 *   · where it came from (the lead source), and any open discrepancy on it (owner and bookkeeper,
 *     as the Discrepancies page).
 *
 * Owner, producer and bookkeeper, as the Policies page. A producer opens only a policy they
 * recorded, the same scoping the ledger applies; another workspace's id is simply not found.
 *
 * Every read is this policy's own (getPolicyStatementLines, listDiscrepancies({ policyId }),
 * leadSourceOf), so the page costs the same in a book of 100 policies or 10,000. The figures are
 * computeLedger([this policy]), the same function and library the ledger page applies per policy.
 */
type Loose = { from(table: string): { select(columns: string): { eq(column: string, value: unknown): { eq(column: string, value: unknown): { maybeSingle(): PromiseLike<{ data: BookPolicyRow | null; error: { message: string; code?: string } | null }> } } } } };

async function readPolicy(tenantId: string, id: string): Promise<(BookPolicyRow & { renewal_date?: string | null }) | null> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const base = "id, policy_number, insured_name, carrier, product, effective_date, annual_premium_cents, status, updated_at, created_by, renewal_date";
  let result = await db.from("tenant_policies").select(`${base}, status_changed_at`).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (result.error && isSchemaGap(result.error)) result = await db.from("tenant_policies").select(base).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (result.error) throw new Error(`Could not load the policy: ${result.error.message}`);
  return result.data;
}

const STATUS = { active: { label: "Active", tone: "good" }, pending: { label: "Pending", tone: "warning" }, lapsed: { label: "Lapsed", tone: "danger" }, cancelled: { label: "Cancelled", tone: "neutral" } } as const;

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." />;
  const { id } = await params;
  if (!isRecordId(id)) notFound();
  const tenantId = guard.context.tenantId;
  const row = await readPolicy(tenantId, id);
  if (!row) notFound();
  // AG-0.5: the role rule (a producer sees his own) AND the session's producer scope — in an agency both must hold.
  const scope = await scopeFor(guard.context);
  const canView = (producerUserId: string | undefined) => roleCanViewCommission(guard.role, guard.context.userId, producerUserId) && rowVisible(scope, producerUserId);
  if (!canView(row.created_by ?? undefined)) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const statementsOn = hasFeature(guard.entitlement, "statement_ingestion") || hasFeature(guard.entitlement, "commission_ledger");
  const seesDiscrepancies = hasFeature(guard.entitlement, "discrepancy_report") && ["owner", "bookkeeper"].includes(guard.role);
  // Everything below is read for THIS policy only (LA-4.9): its lines, its findings, its source.
  let discrepanciesFailed = false;
  const [library, statements, discrepancies, leadSource] = await Promise.all([
    getCarrierLibrary(tenantId),
    statementsOn ? getPolicyStatementLines(tenantId, row) : Promise.resolve(null),
    seesDiscrepancies
      ? listDiscrepancies(tenantId, { policyId: row.id }).catch((error) => {
        // A failed read is said on the page, never shown as "no discrepancy".
        console.error("[policy] discrepancies", error);
        discrepanciesFailed = true;
        return null;
      })
      : Promise.resolve(null),
    leadSourceOf(tenantId, row.policy_number),
  ]);
  const ledger = computeLedger([{
    id: row.id, policyNumber: row.policy_number, insuredName: row.insured_name, carrier: row.carrier, product: row.product,
    effectiveDate: row.effective_date, annualPremiumCents: row.annual_premium_cents, status: row.status, statusChangedAt: statusChangedAt(row), createdBy: row.created_by,
  }], library, today);

  const expected = ledger.entries;
  const earned = expected.filter((entry) => entry.kind !== "chargeback").reduce((sum, entry) => sum + entry.amountCents, 0);
  const chargedBack = -expected.filter((entry) => entry.kind === "chargeback").reduce((sum, entry) => sum + entry.amountCents, 0);
  const advanceExpected = expected.filter((entry) => entry.kind === "advance").reduce((sum, entry) => sum + entry.amountCents, 0);
  const exposure = ledger.exposure[0] ?? null;
  const lines = (statements?.entries ?? []).filter((entry) => entry.policyId === row.id);
  const received = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const advanceReceived = lines.filter((line) => line.kind === "advance").reduce((sum, line) => sum + line.amountCents, 0);
  const open = (discrepancies?.items ?? []).filter((item) => item.policyId === row.id && (item.status === "open" || item.status === "disputed"));
  const status = STATUS[row.status as keyof typeof STATUS] ?? { label: row.status, tone: "neutral" as const };
  const back = (
    <Link href="/app/policies?source=hand" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden="true" />
      Policies
    </Link>
  );

  // Each section fills the viewport under the header, strip and tab row (2026-10-06 redesign).
  const fill = "flex min-h-[calc(100dvh-var(--top-bar-h)-380px)] flex-col [&>*:first-child]:flex-1";
  const expectedTable = (
    <PagedTableCard total={expected.length} noun="entries" suffix="each from a commission schedule row" className={fill} footer={<span>{expected.length.toLocaleString("en-US")} {expected.length === 1 ? "entry" : "entries"}, each from a commission schedule row</span>}>
      {expected.length === 0 ? (
        <EmptyState title="Nothing expected yet" hint={row.status === "pending" ? "A pending policy has not been issued, so nothing is expected yet." : "Entries appear here as the commission schedule posts them for this policy."} />
      ) : (
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th className="w-[130px]">Date</th><th>Entry</th><th className="w-[120px] text-right">Rate</th><th className="w-[130px] text-right">Amount</th></tr></thead>
          <PagedBody>
            {expected.map((entry) => (
              <tr key={entry.id}>
                <td className="tabular-nums">{statementDay(entry.postedOn)}</td>
                <td>{entry.kind === "advance" ? "Advance" : entry.kind === "chargeback" ? "Chargeback" : `Commission, year ${entry.policyYear}`}</td>
                <td className="text-right tabular-nums">{entry.rateBp === null ? "—" : `${(entry.rateBp / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}</td>
                <td className={`text-right font-semibold tabular-nums ${entry.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{statementMoney(entry.amountCents)}</td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
  const reportedTable = statements ? (
    <PagedTableCard total={lines.length} noun="lines" suffix="accepted, on statements that are not voided" className={fill} footer={<span>Accepted lines on statements that are not voided</span>}>
      {lines.length === 0 ? (
        <EmptyState title="No statement line yet" hint="No accepted statement line pays this policy yet. Lines appear here once a carrier statement that names it is accepted." />
      ) : (
        <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead><tr><th className="w-[130px]">Posted</th><th>Statement</th><th className="w-[80px] text-right">Row</th><th className="w-[130px]">Kind</th><th className="w-[130px] text-right">Amount</th></tr></thead>
          <PagedBody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="tabular-nums">{statementDay(line.postedOn)}</td>
                <td className="max-w-[360px] truncate"><Link href={`/app/statements/${line.statementId}`} title={`${line.carrierName} · ${statementPeriod(line.periodStart, line.periodEnd)}`} className="font-semibold text-foreground underline-offset-2 hover:underline">{line.carrierName} · {statementPeriod(line.periodStart, line.periodEnd)}</Link></td>
                <td className="text-right tabular-nums">{line.lineNumber}</td>
                <td>{STATEMENT_KIND_LABELS[line.kind]}</td>
                <td className={`text-right font-semibold tabular-nums ${line.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{statementMoney(line.amountCents)}</td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  ) : null;
  const discrepancyTable = (
    <PagedTableCard total={open.length} noun="discrepancies" suffix={<Link href="/app/discrepancies" className="font-semibold underline-offset-2 hover:underline">Work them in Discrepancies</Link>} className={fill} footer={<Link href="/app/discrepancies" className="font-semibold underline-offset-2 hover:underline">Work them in Discrepancies</Link>}>
      <table className="portal-lead-table w-full min-w-[600px] text-left text-sm">
        <thead><tr><th className="w-[200px]">Kind</th><th>What happened</th><th className="w-[120px] text-right">Owed</th></tr></thead>
        <PagedBody>
          {open.map((item) => (
            <tr key={item.id}>
              <td className="font-semibold text-foreground">{DISCREPANCY_KIND_LABELS[item.kind].label}</td>
              <td className="max-w-[520px] truncate" title={item.detail?.explanation}>{item.detail?.explanation}</td>
              <td className="text-right font-semibold tabular-nums">{statementMoney(item.owedCents)}</td>
            </tr>
          ))}
        </PagedBody>
      </table>
    </PagedTableCard>
  );
  // Open discrepancies lead when there are any: they are the one thing on this page to act on.
  const sections = [
    ...(open.length > 0 ? [{ key: "discrepancies", label: "Open discrepancies", count: open.length, content: discrepancyTable }] : []),
    { key: "expected", label: "What your contract expects", count: expected.length, content: expectedTable },
    ...(reportedTable ? [{ key: "reported", label: "What the carrier reported", count: lines.length, content: reportedTable }] : []),
  ];

  return (
    <div className="m-stagger flex flex-col gap-6">
      {back}
      <PageHeader
        title={`${row.insured_name} · ${row.policy_number}`}
        description={`${row.carrier} · ${row.product} · ${statementMoney(row.annual_premium_cents)} a year · issued ${statementDay(row.effective_date)} · lead source ${leadSource}`}
        actions={<><StatusChip tone={status.tone}>{status.label}</StatusChip><RecordLapseSignal policy={{ id: row.id, status: row.status }} /></>}
      />

      {discrepanciesFailed && (
        <p role="status" className="m-0 rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">This policy&rsquo;s discrepancies could not be loaded just now, so none are shown. Reload to try again.</p>
      )}

      {ledger.gaps.length > 0 && (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">
          {ledger.gaps[0].reason} Until it is fixed on the Rate card, this policy has no expected commission to compare with.
        </div>
      )}

      <StatStrip label="This policy's money">
        <StatTile label="Advance received" value={statementMoney(advanceReceived)} footnote={advanceExpected ? `${statementMoney(advanceExpected)} expected` : "no advance on this contract"} />
        <StatTile label="Earned to date" value={statementMoney(earned)} footnote={chargedBack ? `${statementMoney(chargedBack)} charged back` : "what your contract expects so far"} />
        <StatTile label="Carrier paid" value={statementMoney(received)} valueTone={lines.length && received < earned - chargedBack - 100 ? "warning" : undefined} footnote={`${lines.length.toLocaleString("en-US")} accepted statement ${lines.length === 1 ? "line" : "lines"}`} />
        <StatTile
          label="Chargeback exposure"
          value={exposure ? statementMoney(exposure.exposureCents) : "$0.00"}
          valueTone={exposure ? "warning" : undefined}
          footnote={exposure ? `until ${statementDay(exposure.clawbackEndsOn)} · ${exposure.clawbackType}` : row.status === "active" ? "outside the clawback window" : "not in force"}
        />
      </StatStrip>

      {/* The ledger, the carrier's lines and any open discrepancy: one at a time, as tabs. */}
      <TabbedSections label="This policy's records" sections={sections} />
    </div>
  );
}
