import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { hasFeature } from "@/lib/entitlements/types";
import { DataInPage, RecordName } from "@/components/app/data-in/data-in-page";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RecordLapseSignal } from "@/components/app/record-lapse-signal";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { FactGrid, PolicyLead } from "@/components/app/book/policy/policy-head";
import { PolicyMoreMenu } from "@/components/app/book/policy/policy-islands";
import { Callout } from "@/components/app/settings/primitives";
import { StatusChip } from "@/components/ui/status-chip";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { HAND_POLICY_TABS, POLICY_TABS, policyTabOf } from "@/lib/ingestion/policyPage";
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
 *
 * Round 5 (board 22): the carrier policy's layout — "<policy> · <client>" with the status chip beside it, the
 * muted facts line, one button and More — and only the tabs a hand-entered policy can fill (Overview, Money);
 * History, Client, Pipeline and Files need a carrier file, so they don't show.
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

export default async function PolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." />;
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Round 2: the same frame and tab layout as a carrier policy; only the tabs a hand-entered record can fill.
  const tab = policyTabOf(query.tab, HAND_POLICY_TABS);
  if (!isRecordId(id)) notFound();
  const tenantId = guard.context.tenantId;
  const statementsOn = hasFeature(guard.entitlement, "statement_ingestion") || hasFeature(guard.entitlement, "commission_ledger");
  const seesDiscrepancies = hasFeature(guard.entitlement, "discrepancy_report") && holdsAnyRole(guard.roles, ["owner", "bookkeeper"]);
  // Frame first (UI-CONSISTENCY §7a): the trail, the tabs and the frame draw at once; the policy's name waits behind its
  // shape, and its chip, facts, buttons and money stream in. The reads are today's, only started before the frame.
  // AG-0.5: the role rule (a producer sees his own) AND the session's producer scope — in an agency both must hold.
  const head: Head = (async () => {
    const [row, scope] = await Promise.all([readPolicy(tenantId, id), scopeFor(guard.context)]);
    if (!row) return null;
    const canView = (producerUserId: string | undefined) => roleCanViewCommission(guard.role, guard.context.userId, producerUserId) && rowVisible(scope, producerUserId);
    if (!canView(row.created_by ?? undefined)) return null;
    return row;
  })();
  // Everything below is read for THIS policy only (LA-4.9): its lines, its findings, its source.
  const rest: Rest = head.then(async (row) => {
    if (!row) return null;
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
    return { library, statements, discrepancies, leadSource, discrepanciesFailed };
  });
  const hrefs: Record<string, string> = { overview: `/app/policies/${id}`, commissions: `/app/policies/${id}?tab=commissions` };
  const tabsOf = (open: number) => POLICY_TABS.filter((item) => HAND_POLICY_TABS.includes(item.key)).map((item) => ({
    key: item.key,
    label: item.label,
    count: item.key === "commissions" && open > 0 ? open : null,
    tone: item.key === "commissions" ? ("danger" as const) : undefined,
    href: hrefs[item.key],
  }));

  return (
    <DataInPage
      step="policies"
      title={<RecordName read={head.then((row) => row && `${row.policy_number} · ${row.insured_name}`)} />}
      chip={<Suspense fallback={null}><Chip read={head} /></Suspense>}
      facts={<Suspense fallback={null}><Facts head={head} rest={rest} /></Suspense>}
      tabs={<Suspense fallback={<ViewTabs label="This policy" value={tab} tabs={tabsOf(0)} />}><CountedTabs head={head} rest={rest} tab={tab} tabsOf={tabsOf} /></Suspense>}
      actions={<Suspense fallback={null}><Actions read={head} /></Suspense>}
    >
      <StreamSection shape={tab === "overview" ? "rows" : "strip+table"} rows={9} columns={2}>
        <PolicyBody head={head} rest={rest} tab={tab} seesDiscrepancies={seesDiscrepancies} />
      </StreamSection>
    </DataInPage>
  );
}

type Row = BookPolicyRow & { renewal_date?: string | null };
/** The policy, or null when it is not there or not this person's to see. */
type Head = Promise<Row | null>;
type Rest = Promise<{
  library: Awaited<ReturnType<typeof getCarrierLibrary>>;
  statements: Awaited<ReturnType<typeof getPolicyStatementLines>> | null;
  discrepancies: Awaited<ReturnType<typeof listDiscrepancies>> | null;
  leadSource: Awaited<ReturnType<typeof leadSourceOf>>;
  discrepanciesFailed: boolean;
} | null>;

const statusOf = (row: Row) => STATUS[row.status as keyof typeof STATUS] ?? { label: row.status, tone: "neutral" as const };
const openOf = (row: Row, discrepancies: Awaited<ReturnType<typeof listDiscrepancies>> | null) => (discrepancies?.items ?? []).filter((item) => item.policyId === row.id && (item.status === "open" || item.status === "disputed"));

async function Chip({ read }: { read: Head }) {
  const row = await read;
  if (!row) return null;
  const status = statusOf(row);
  return <StatusChip tone={status.tone}>{status.label}</StatusChip>;
}

async function Facts({ head, rest }: { head: Head; rest: Rest }) {
  const [row, more] = await Promise.all([head, rest]);
  if (!row || !more) return null;
  const { leadSource } = more;
  return <PolicyLead facts={[row.carrier, row.product, row.annual_premium_cents !== null ? `${statementMoney(Math.round(row.annual_premium_cents / 12))}/mo` : null, `lead source ${leadSource}`, "entered by hand"]} />;
}

async function CountedTabs({ head, rest, tab, tabsOf }: { head: Head; rest: Rest; tab: ReturnType<typeof policyTabOf>; tabsOf: (open: number) => Array<{ key: string; label: string; count: number | null; tone?: "danger"; href: string }> }) {
  const [row, more] = await Promise.all([head, rest]);
  return <ViewTabs label="This policy" value={tab} tabs={tabsOf(row && more ? openOf(row, more.discrepancies).length : 0)} />;
}

async function Actions({ read }: { read: Head }) {
  const row = await read;
  if (!row) return null;
  return <><RecordLapseSignal policy={{ id: row.id, status: row.status }} /><PolicyMoreMenu links={[]} policyNumber={row.policy_number} /></>;
}

async function PolicyBody({ head, rest, tab, seesDiscrepancies }: { head: Head; rest: Rest; tab: ReturnType<typeof policyTabOf>; seesDiscrepancies: boolean }) {
  const [row, more] = await Promise.all([head, rest]);
  if (!row) notFound();
  if (!more) notFound();
  const { library, statements, discrepancies, leadSource, discrepanciesFailed } = more;
  const today = new Date().toISOString().slice(0, 10);
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
  const open = openOf(row, discrepancies);
  const status = statusOf(row);

  const expectedTable = (
    <PagedTableCard title="What your contract expects" total={expected.length} noun="entries" suffix="each from a commission schedule row" footer={<span>{expected.length.toLocaleString("en-US")} {expected.length === 1 ? "entry" : "entries"}, each from a commission schedule row</span>}>
      {expected.length === 0 ? (
        <EmptyState title="Nothing expected yet" hint={row.status === "pending" ? "A pending policy has not been issued, so nothing is expected yet." : "Entries appear here as the commission schedule posts them for this policy."} />
      ) : (
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th className="w-[130px]">Date</th><th>Entry</th><th className="w-[120px] text-right">Rate</th><th className="w-[130px] text-right">Amount</th></tr></thead>
          <PagedBody>
            {expected.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap tabular-nums text-muted-foreground">{statementDay(entry.postedOn)}</td>
                <td className="whitespace-nowrap font-medium text-foreground">{entry.kind === "advance" ? "Advance" : entry.kind === "chargeback" ? "Chargeback" : `Commission, year ${entry.policyYear}`}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{entry.rateBp === null ? <span className="text-muted-foreground">—</span> : `${(entry.rateBp / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{statementMoney(entry.amountCents)}</td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
  const reportedTable = statements ? (
    <PagedTableCard title="What the carrier reported" total={lines.length} noun="lines" suffix="accepted, on statements that are not voided" footer={<span>Accepted lines on statements that are not voided</span>}>
      {lines.length === 0 ? (
        <EmptyState title="No statement line yet" hint="No accepted statement line pays this policy yet. Lines appear here once a carrier statement that names it is accepted." />
      ) : (
        <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead><tr><th className="w-[130px]">Posted</th><th>Statement</th><th className="w-[80px] text-right">Row</th><th className="w-[130px]">Kind</th><th className="w-[130px] text-right">Amount</th></tr></thead>
          <PagedBody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="whitespace-nowrap tabular-nums text-muted-foreground">{statementDay(line.postedOn)}</td>
                <td className="whitespace-nowrap font-medium text-foreground"><Link href={`/app/statements/${line.statementId}`} className="underline-offset-2 hover:underline">{line.carrierName} · {statementPeriod(line.periodStart, line.periodEnd)}</Link></td>
                <td className="whitespace-nowrap text-right tabular-nums">{line.lineNumber}</td>
                <td className="whitespace-nowrap">{STATEMENT_KIND_LABELS[line.kind]}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{statementMoney(line.amountCents)}</td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  ) : null;
  const discrepancyTable = (
    <PagedTableCard title="Open discrepancies" total={open.length} noun="discrepancies" suffix={<Link href="/app/discrepancies" className="text-foreground underline-offset-2 hover:underline">Work them in Discrepancies</Link>} footer={<Link href="/app/discrepancies" className="text-foreground underline-offset-2 hover:underline">Work them in Discrepancies</Link>}>
      <table className="portal-lead-table w-full min-w-[600px] text-left text-sm">
        <thead><tr><th className="w-[200px]">Kind</th><th>What happened</th><th className="w-[120px] text-right">Owed</th></tr></thead>
        <PagedBody>
          {open.map((item) => (
            <tr key={item.id}>
              <td className="whitespace-nowrap font-medium text-foreground">{DISCREPANCY_KIND_LABELS[item.kind].label}</td>
              <td className="max-w-[520px] truncate" title={item.detail?.explanation}>{item.detail?.explanation}</td>
              <td className="whitespace-nowrap text-right tabular-nums">{statementMoney(item.owedCents)}</td>
            </tr>
          ))}
        </PagedBody>
      </table>
    </PagedTableCard>
  );

  return (
    <>
    {discrepanciesFailed && (
      <Callout tone="warning" title="This policy’s discrepancies could not be loaded just now, so none are shown. Reload to try again." />
    )}

    {tab === "overview" ? (
      <TableCard title="Overview">
        <FactGrid items={[
          ["Status", status.label],
          ["Carrier", row.carrier],
          ["Product", row.product],
          ["Issued", statementDay(row.effective_date)],
          ["Premium", `${statementMoney(row.annual_premium_cents)} a year`],
          ["Lead source", leadSource],
          ["Renewal", row.renewal_date ? statementDay(row.renewal_date) : "—"],
          ["Chargeback exposure", exposure ? `${statementMoney(exposure.exposureCents)} until ${statementDay(exposure.clawbackEndsOn)}` : row.status === "active" ? "Outside the clawback window" : "Not in force"],
          ["Open discrepancies", seesDiscrepancies ? String(open.length) : "—"],
        ]} />
      </TableCard>
    ) : (
      <>
        {ledger.gaps.length > 0 && (
          <Callout tone="warning" title={`${ledger.gaps[0].reason} Until it is fixed on the Rate card, this policy has no expected commission to compare with.`} />
        )}

        <StatStrip label="This policy's money">
          <StatTile label="Advance received" value={statementMoney(advanceReceived)} footnote={advanceExpected ? `${statementMoney(advanceExpected)} expected` : "no advance on this contract"} />
          <StatTile label="Earned to date" value={statementMoney(earned)} footnote={chargedBack ? `${statementMoney(chargedBack)} charged back` : "what your contract expects so far"} />
          <StatTile label="Carrier paid" value={statementMoney(received)} footnote={lines.length && received < earned - chargedBack - 100 ? <span title={`${lines.length.toLocaleString("en-US")} accepted statement ${lines.length === 1 ? "line" : "lines"}`}><StatusChip tone="warning">{`${statementMoney(earned - chargedBack - received)} short`}</StatusChip></span> : `${lines.length.toLocaleString("en-US")} accepted statement ${lines.length === 1 ? "line" : "lines"}`} />
          <StatTile
            label="Chargeback exposure"
            value={exposure ? statementMoney(exposure.exposureCents) : "$0.00"}
            footnote={exposure ? <span title={exposure.clawbackType}><StatusChip tone="warning">{`Until ${statementDay(exposure.clawbackEndsOn)}`}</StatusChip></span> : row.status === "active" ? "outside the clawback window" : "not in force"}
          />
        </StatStrip>

        {/* Open discrepancies lead when there are any: they are the one thing on this tab to act on. */}
        {open.length > 0 && discrepancyTable}
        {expectedTable}
        {reportedTable}
      </>
    )}
    </>
  );
}
