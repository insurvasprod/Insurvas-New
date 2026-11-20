import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { hasFeature } from "@/lib/entitlements/types";
import { DataInPage, RecordName } from "@/components/app/data-in/data-in-page";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RecordLapseSignal } from "@/components/app/record-lapse-signal";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PolicyLead } from "@/components/app/book/policy/policy-head";
import { PolicyMoreMenu } from "@/components/app/book/policy/policy-islands";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/page-states";
import { RowAction, RowActionCell } from "@/components/ui/row-action";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { getCarrierLibrary } from "@/lib/carriers/service";
import { listDiscrepancies } from "@/lib/discrepancies/service";
import { computeLedger } from "@/lib/ledger/compute";
import { pairPolicyMoney, type MoneyRow } from "@/lib/ledger/policyMoney";
import { statusChangedAt, type BookPolicyRow } from "@/lib/ledger/service";
import { STATEMENT_KIND_LABELS, isRecordId, statementDay, statementMoney, statementPeriod } from "@/lib/ledger/statementConstants";
import { getPolicyStatementLines } from "@/lib/ledger/statementService";
import { leadSourceOf } from "@/lib/persistency/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { rowVisible, scopeFor } from "@/lib/agency/visibility";
import { roleCanViewCommission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › one hand-entered policy (LA-4.9; owner 2026-11-19, board ledger-r1 1·A): one page that opens
 * on the answer an agent opens a policy for — is my money right on this one?
 *
 *   · the strip: premium, what the contract expects, what the carrier paid, the difference, chargeback exposure;
 *   · Expected vs Paid: every line the contract expects (computeLedger, each from a schedule row) beside the
 *     accepted statement line that paid it (pairPolicyMoney), with where each side came from, and a short row's
 *     gap in orange with its pay issue;
 *   · a narrow side card of the policy's facts, and its recent money and status events.
 *
 * Owner, producer and bookkeeper, as the Policies page. A producer opens only a policy they recorded, the same
 * scoping the ledger applies; another workspace's id is simply not found. Old `?tab=` links land here too.
 *
 * Every read is this policy's own (getPolicyStatementLines, listDiscrepancies({ policyId }), leadSourceOf), so the
 * page costs the same in a book of 100 policies or 10,000.
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

/** The carrier policy page a statement mirror stands for, or null for a policy entered by hand. */
async function carrierPageOfMirror(tenantId: string, id: string): Promise<string | null> {
  const db = getSupabaseServiceClient();
  const { data } = await db.from("tenant_policies").select("carrier, policy_number, source").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  const row = data as { carrier: string; policy_number: string; source: string } | null;
  if (!row || row.source !== "carrier_file") return null;
  const carrier = await db.from("carriers").select("id").ilike("name", row.carrier).limit(1).maybeSingle();
  const carrierId = (carrier.data as { id: string } | null)?.id;
  return carrierId ? `/app/policies/carrier/${carrierId}/${encodeURIComponent(row.policy_number)}?tab=commissions` : null;
}

const STATUS = { active: { label: "Active", tone: "good" }, pending: { label: "Pending", tone: "warning" }, lapsed: { label: "Lapsed", tone: "danger" }, cancelled: { label: "Cancelled", tone: "neutral" } } as const;
const pct = (bp: number) => `${(bp / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." />;
  const { id } = await params;
  if (!isRecordId(id)) notFound();
  const tenantId = guard.context.tenantId;
  // A carrier-file policy's statement mirror (lib/ledger/statementMirror.ts) is that policy: open its own page.
  const mirror = await carrierPageOfMirror(tenantId, id);
  if (mirror) redirect(mirror);
  const statementsOn = hasFeature(guard.entitlement, "statement_ingestion") || hasFeature(guard.entitlement, "commission_ledger");
  const seesDiscrepancies = hasFeature(guard.entitlement, "discrepancy_report") && holdsAnyRole(guard.roles, ["owner", "bookkeeper"]);
  // Frame first (UI-CONSISTENCY §7a): the trail and the frame draw at once; the policy's name waits behind its
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

  return (
    <DataInPage
      step="policies"
      title={<RecordName read={head.then((row) => row && `${row.insured_name} · ${row.policy_number}`)} />}
      chip={<Suspense fallback={null}><Chip read={head} /></Suspense>}
      facts={<Suspense fallback={null}><Facts head={head} rest={rest} /></Suspense>}
      actions={<Suspense fallback={null}><Actions head={head} rest={rest} /></Suspense>}
    >
      <StreamSection shape="strip+table">
        <PolicyBody head={head} rest={rest} />
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

/** The one thing to do (an open pay issue), then everything else under Actions. */
async function Actions({ head, rest }: { head: Head; rest: Rest }) {
  const [row, more] = await Promise.all([head, rest]);
  if (!row) return null;
  const open = more ? openOf(row, more.discrepancies) : [];
  return (
    <>
      {open[0] && <Button asChild><Link href={`/app/discrepancies/${open[0].id}`}>{open.length === 1 ? "Open Pay Issue" : `Open ${open.length} Pay Issues`}</Link></Button>}
      <RecordLapseSignal policy={{ id: row.id, status: row.status }} />
      <PolicyMoreMenu links={[]} policyNumber={row.policy_number} />
    </>
  );
}

function whatOf(row: MoneyRow): string {
  if (row.kind === "advance") return row.rateBp !== null ? `Advance · at ${pct(row.rateBp)}` : "Advance";
  if (row.kind === "commission") return row.policyYear ? `Commission · year ${row.policyYear}${row.rateBp !== null ? ` at ${pct(row.rateBp)}` : ""}` : "Commission";
  if (row.kind === "chargeback") return "Chargeback";
  return STATEMENT_KIND_LABELS[row.kind as keyof typeof STATEMENT_KIND_LABELS] ?? row.kind;
}

async function PolicyBody({ head, rest }: { head: Head; rest: Rest }) {
  const [row, more] = await Promise.all([head, rest]);
  if (!row) notFound();
  if (!more) notFound();
  const { library, statements, discrepancies, leadSource, discrepanciesFailed } = more;
  const today = new Date().toISOString().slice(0, 10);
  const endedOn = statusChangedAt(row);
  const ledger = computeLedger([{
    id: row.id, policyNumber: row.policy_number, insuredName: row.insured_name, carrier: row.carrier, product: row.product,
    effectiveDate: row.effective_date, annualPremiumCents: row.annual_premium_cents, status: row.status, statusChangedAt: endedOn, createdBy: row.created_by,
  }], library, today);
  const expected = ledger.entries;
  const lines = (statements?.entries ?? []).filter((entry) => entry.policyId === row.id);
  const check = pairPolicyMoney(expected, lines);
  const exposure = ledger.exposure[0] ?? null;
  const open = openOf(row, discrepancies);
  const status = statusOf(row);

  // What the contract is: the advance rule and the rate behind the first entry.
  const first = expected.find((entry) => entry.kind !== "chargeback") ?? null;
  const rule = first?.advanceRuleId ? library.advanceRules.find((r) => r.id === first.advanceRuleId) ?? null : null;
  const contractWords = first
    ? rule ? `${pct(rule.advance_pct_bp)} advance · ${rule.advance_months} mo at ${pct(first.contractLevelBp)}` : `rate ${first.rateBp !== null ? pct(first.rateBp) : "—"} at ${pct(first.contractLevelBp)}`
    : ledger.gaps[0]?.reason ?? (row.status === "pending" ? "not issued yet" : "no rate on the Rate card");
  const chargedBack = expected.some((entry) => entry.kind === "chargeback");
  const diff = check.differenceCents;
  const level = first ? pct(first.contractLevelBp) : null;

  const facts: Array<[string, ReactNode]> = [
    ["Client", row.insured_name],
    ["Carrier", `${row.carrier} · ${row.product}`],
    ["Issued", statementDay(row.effective_date)],
    ...(endedOn ? [[status.label, statementDay(endedOn)] as [string, ReactNode]] : []),
    ["Renewal", row.renewal_date ? statementDay(row.renewal_date) : "—"],
    ["Your level", level ? `${level}${first?.rateBp !== null && first?.rateBp !== undefined ? ` · rate ${pct(first.rateBp)}` : ""}` : <Link href="/app/book-setup" className="font-medium text-[var(--accent-ink)] hover:underline">Add the rate</Link>],
    ["Source", "Entered by hand"],
    ["Lead source", leadSource],
  ];

  // Recent: the carrier's lines and the status change, newest first.
  const events: Array<{ key: string; on: string; tone: "good" | "danger" | "neutral"; text: string; detail: string }> = [
    ...lines.map((line) => ({
      key: line.id,
      on: line.postedOn,
      tone: line.amountCents < 0 ? ("danger" as const) : ("good" as const),
      text: `${STATEMENT_KIND_LABELS[line.kind]} ${statementMoney(line.amountCents)}`,
      detail: `${line.carrierName} · ${statementPeriod(line.periodStart, line.periodEnd)} · line ${line.lineNumber}`,
    })),
    ...(endedOn ? [{ key: "status", on: endedOn.slice(0, 10), tone: "danger" as const, text: status.label, detail: "the policy's status changed" }] : []),
  ].sort((a, b) => b.on.localeCompare(a.on)).slice(0, 6);

  return (
    <>
      {discrepanciesFailed && (
        <p className="m-0 text-sm text-[var(--warning-ink)]">This policy&rsquo;s pay issues could not be loaded just now, so none are shown. Reload to try again.</p>
      )}

      <StatStrip label="This policy's money">
        <StatTile label="Premium" value={<>{row.annual_premium_cents !== null ? statementMoney(row.annual_premium_cents) : "—"}</>} unit={row.annual_premium_cents !== null ? "/yr" : undefined} footnote={`${row.product} · ${row.carrier}`} />
        <StatTile label="Contract expects" value={<>{statementMoney(check.expectedCents)}</>} footnote={first ? contractWords : <StatusChip tone="warning">{contractWords}</StatusChip>} />
        <StatTile label="Carrier paid" value={<>{statementMoney(check.paidCents)}</>} footnote={check.takenBackCents ? `${statementMoney(check.paidOutCents)} paid, ${statementMoney(check.takenBackCents)} taken back` : `${lines.length.toLocaleString("en-US")} statement ${lines.length === 1 ? "line" : "lines"}`} />
        <StatTile
          label="Difference"
          value={<>{statementMoney(diff)}</>}
          footnote={Math.abs(diff) <= 100 ? (chargedBack ? "a lapse inside the clawback window: expected" : "paid as the contract expects") : <StatusChip tone="warning">{diff < 0 ? `${statementMoney(-diff)} short` : `${statementMoney(diff)} over`}</StatusChip>}
        />
        <StatTile
          label="Chargeback exposure"
          value={<>{exposure ? statementMoney(exposure.exposureCents) : "—"}</>}
          footnote={exposure ? <StatusChip tone="warning">{`Until ${statementDay(exposure.clawbackEndsOn)}`}</StatusChip> : row.status === "active" ? "outside the clawback window" : "not in force"}
        />
      </StatStrip>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <TableCard title="Expected vs Paid" description="Every line, both sides">
          {check.rows.length === 0 ? (
            <EmptyState title="Nothing expected or paid yet" hint={row.status === "pending" ? "A pending policy has not been issued, so nothing is expected yet." : first ? "Lines appear here once a carrier statement that names this policy is accepted." : "Add this carrier's rate on the Rate card, and what the contract expects appears here."} />
          ) : (
            <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr>
                  <th className="w-[120px]">Date</th>
                  <th>What</th>
                  <th className="w-[120px] text-right">Expected</th>
                  <th className="w-[120px] text-right">Paid</th>
                  <th className="w-[200px]">From</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {check.rows.map((money) => {
                  const issue = !money.matches ? open[0] ?? null : null;
                  return (
                    <tr key={money.key}>
                      <td className="whitespace-nowrap tabular-nums text-muted-foreground">{statementDay(money.date)}</td>
                      <td className="whitespace-nowrap font-medium text-foreground">{whatOf(money)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{money.expectedCents === null ? <span className="text-muted-foreground">—</span> : statementMoney(money.expectedCents)}</td>
                      <td className={`whitespace-nowrap text-right tabular-nums ${money.matches ? "" : "text-[var(--warning-ink)]"}`} title={money.matches ? undefined : `${statementMoney(Math.abs(money.gapCents))} ${money.gapCents < 0 ? "short" : "over"}`}>{money.paidCents === null ? <span className="text-[var(--warning-ink)]">Not paid</span> : statementMoney(money.paidCents)}</td>
                      <td className="whitespace-nowrap text-muted-foreground">{money.line ? <Link href={`/app/statements/${money.line.statementId}`} className="hover:underline">{statementPeriod(money.line.periodStart, money.line.periodEnd)} statement · line {money.line.lineNumber}</Link> : money.expectedCents !== null ? "your contract" : "—"}</td>
                      {issue ? (
                        <RowActionCell><RowAction href={`/app/discrepancies/${issue.id}`} title={`${statementMoney(Math.abs(money.gapCents))} ${money.gapCents < 0 ? "short" : "over"}`}>Open Pay Issue</RowAction></RowActionCell>
                      ) : (
                        <td className="w-px whitespace-nowrap text-right">{money.matches ? <StatusChip tone="good">Matches</StatusChip> : <StatusChip tone="warning">{money.gapCents < 0 ? `${statementMoney(-money.gapCents)} short` : `${statementMoney(money.gapCents)} over`}</StatusChip>}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td />
                  <td className="text-foreground">Net</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{statementMoney(check.expectedCents)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{statementMoney(check.paidCents)}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </TableCard>

        <div className="grid min-w-0 gap-4">
          <TableCard title="The policy">
            <dl className="m-0 border-t border-border">
              {facts.map(([term, value]) => (
                <div key={term} className="grid min-h-[2.5rem] grid-cols-[104px_minmax(0,1fr)] items-center gap-x-3 border-b border-border px-4 py-1.5 text-sm last:border-b-0">
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="m-0 min-w-0 truncate font-medium text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </TableCard>

          <TableCard title="Recent">
            {events.length === 0 ? (
              <p className="m-0 border-t border-border px-4 py-3 text-sm text-muted-foreground">Nothing yet: no statement has named this policy.</p>
            ) : (
              <ul className="m-0 list-none border-t border-border p-0">
                {events.map((event) => (
                  <li key={event.key} className="grid min-h-[2.75rem] grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border px-4 py-1.5 text-sm last:border-b-0">
                    <span aria-hidden="true" className={`size-2 rounded-full ${event.tone === "danger" ? "bg-[var(--error)]" : event.tone === "good" ? "bg-[var(--success)]" : "bg-muted-foreground"}`} />
                    <span className="min-w-0 truncate" title={event.detail}><span className="font-medium text-foreground">{event.text}</span> <span className="text-muted-foreground">· {event.detail}</span></span>
                    <span className="whitespace-nowrap tabular-nums text-muted-foreground">{statementDay(event.on)}</span>
                  </li>
                ))}
              </ul>
            )}
          </TableCard>
        </div>
      </div>
    </>
  );
}
