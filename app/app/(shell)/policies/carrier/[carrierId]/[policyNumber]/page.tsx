import Link from "next/link";
import { notFound } from "next/navigation";

import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PolicyAnnotationForm } from "@/components/app/policy-annotation-form";
import { PolicyAwaitingFile } from "@/components/app/policy-awaiting-file";
import { ProvisionalBadge } from "@/components/app/provisional-badge";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedPager, PagedProvider, PagedTableCard } from "@/components/ui/paged";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { scopeFor } from "@/lib/agency/visibility";
import { guardPage } from "@/lib/entitlements/guardPage";
import { fileDay } from "@/lib/ingestion/constants";
import { fileHref, rowHref } from "@/lib/ingestion/trace";
import { RISK_LABELS, statusLabel, type RiskBand } from "@/lib/ingestion/policyBook";
import { loadIssuedAwaitingOne, loadPolicy } from "@/lib/ingestion/policyBookStore";
import { moneyOrUnknown, riskFootnote } from "@/lib/ingestion/policyCurrent";
import { isRecordUuid } from "@/lib/ingestion/path";

const RISK_TONE: Record<RiskBand, StatusTone> = { none: "neutral", watch: "info", at_risk: "warning", critical: "danger" };
const MODE: Record<string, string> = { monthly: "a month", quarterly: "a quarter", semiannual: "every 6 months", annual: "a year" };
const METHOD: Record<string, string> = { bank_draft: "Bank draft", direct_express: "Direct Express", card: "Card", direct_bill: "Direct bill (mailed)" };
const KIND_DOT: Record<string, string> = { sale: "bg-[var(--info)]", carrier: "bg-[var(--primary)]", change: "bg-[var(--warning)]", money: "bg-[var(--success)]" };
const signed = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const policyHref = (carrierId: string, policyNumber: string) => `/app/policies/carrier/${carrierId}/${encodeURIComponent(policyNumber)}`;

/**
 * Book of Business › Policies › one policy (LA-4.11, Notion sprint): who, which carrier, how much,
 * what state and how risky; the money; everything that has happened to it, in one timeline; and the
 * file and row each value came from. Carrier data is read-only; notes and lead source are ours.
 */
export default async function PolicyPage({ params }: { params: Promise<{ carrierId: string; policyNumber: string }> }) {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." />;
  const { carrierId, policyNumber: raw } = await params;
  const policyNumber = decodeURIComponent(raw);
  if (!isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 100) notFound();

  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const view = await loadPolicy(viewer, carrierId, policyNumber);
  if (!view) {
    // Module 4 · Door 1: a sale recorded as issued is in the book before its carrier file lists it.
    const awaiting = await loadIssuedAwaitingOne(viewer, carrierId, policyNumber).catch(() => null);
    if (awaiting) return <PolicyAwaitingFile sale={awaiting} />;
    return (
      <div className="m-stagger flex flex-col gap-6">
        <Link href="/app/policies" className="text-sm text-muted-foreground hover:underline">← Policies</Link>
        <EmptyState title="This policy is not in your book" hint={guard.role === "producer" ? "It may be credited to another agent, or its carrier file hasn't arrived yet." : "Its carrier file may not have arrived yet, or the policy number is different."} />
      </div>
    );
  }
  const { policy, client, sale, lead, timeline, source, others, household } = view;
  const saleState = sale ? (sale.outcome ? sale.outcome.replaceAll("_", " ") : sale.status ? sale.status.replaceAll("_", " ") : null) : null;
  const readOnly = guard.entitlement.access === "read_only";
  const monthly = policy.annualCents === null ? null : Math.round(policy.annualCents / 12);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <Link href="/app/policies" className="text-sm text-muted-foreground hover:underline">← Policies</Link>
      <PageHeader
        title={client?.name ?? sale?.name ?? `Policy ${policy.policyNumber}`}
        description={`${policy.carrierName} · Policy ${policy.policyNumber}${policy.product ? ` · ${policy.product}` : ""}`}
      />
      {client?.provisional && <p role="status" className="-mt-4 m-0 text-sm"><ProvisionalBadge /> <span className="text-muted-foreground">This client was built from the carrier&apos;s file. <Link href="/app/duplicates" className="font-medium text-[var(--accent-ink)] hover:underline">Check it in the contact directory</Link>.</span></p>}
      {/* The sale this policy is linked to (LA-3): shown whether or not its client is known yet. */}
      {sale && <p role="status" className="-mt-4 m-0 text-sm text-muted-foreground">Linked to {sale.name ? `${sale.name}'s` : "an"} application{saleState ? ` (${saleState})` : ""}. <Link href={`/app/applications/${sale.caseId}`} className="font-medium text-[var(--accent-ink)] hover:underline">Open the application</Link></p>}
      {!client && !sale && <p role="status" className="-mt-4 m-0 text-sm text-[var(--warning-ink)]">No client is linked to this policy yet. <Link href="/app/policy-matching" className="font-medium underline">Link it in Policy matching</Link>.</p>}

      <StatStrip label="This policy">
        <StatTile label="Premium" value={dollars(policy.premiumCents)} footnote={policy.premiumMode ? `${MODE[policy.premiumMode] ?? policy.premiumMode}${monthly !== null && policy.premiumMode !== "monthly" ? ` · ${dollars(monthly)} a month` : ""}` : "mode not given"} />
        <StatTile label="Face amount" value={dollars(policy.faceCents)} />
        <StatTile label="Status" value={statusLabel(policy.status)} footnote={policy.statusRaw ? `carrier says “${policy.statusRaw}”` : undefined} />
        <StatTile label="Risk" value={RISK_LABELS[policy.riskBand]} valueTone={policy.riskBand === "at_risk" || policy.riskBand === "critical" ? "warning" : undefined} footnote={riskFootnote(policy)} />
        <StatTile label="Paid to" value={fileDay(policy.paidTo)} footnote={policy.lastFileDate ? `per the carrier file of ${fileDay(policy.lastFileDate)}` : undefined} />
      </StatStrip>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <TableCard title="Policy">
            <dl className="grid gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-3">
              {[
                ["Issued", fileDay(policy.issuedOn)],
                ["Effective", fileDay(policy.effectiveDate)],
                ["Payment method", policy.paymentMethod ? METHOD[policy.paymentMethod] ?? policy.paymentMethod : "—"],
                ["Draft day", policy.draftDay ? String(policy.draftDay) : "—"],
                ["Months paid", policy.monthsPaid === null ? "—" : String(policy.monthsPaid)],
              ].map(([term, value]) => (
                <div key={term} className="min-w-0"><dt className="text-xs text-muted-foreground">{term}</dt><dd className="m-0 truncate font-medium text-foreground" title={value}>{value}</dd></div>
              ))}
              {/* An agent code no member is mapped to links to where it is mapped (Policy matching › Agent codes). */}
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Agent</dt>
                <dd className="m-0 truncate font-medium text-foreground" title={policy.agentName ?? policy.agentCode ?? undefined}>
                  {policy.agentName ?? (policy.agentCode ? <>Code {policy.agentCode}, <Link href="/app/policy-matching?tab=agents" className="text-[var(--accent-ink)] hover:underline">not mapped</Link></> : "—")}
                </dd>
              </div>
            </dl>
          </TableCard>

          <PagedTableCard total={timeline.length} noun="events" title="Timeline" description="What has happened to this policy, oldest first.">
            {timeline.length === 0 ? (
              <p className="m-0 px-4 py-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <PagedBody as="ol" className="m-0 list-none px-4 py-3">
                {timeline.map((item, index) => (
                  <li key={index} className="grid grid-cols-[110px_12px_minmax(0,1fr)] items-start gap-3 py-2 text-sm">
                    <span className="tabular-nums text-muted-foreground">{fileDay(item.date)}</span>
                    <span aria-hidden="true" className={`mt-1.5 size-2 rounded-full ${KIND_DOT[item.kind]}`} />
                    <span className="min-w-0"><span className="text-foreground">{item.label}</span>{item.detail && <span className="block truncate text-xs text-muted-foreground" title={item.detail}>{item.detail}</span>}{item.source && <Link href={item.source.href} className="block truncate text-xs text-[var(--accent-ink)] hover:underline" title={item.source.text}>{item.source.text}</Link>}</span>
                  </li>
                ))}
              </PagedBody>
            )}
          </PagedTableCard>

          <details className="rounded-lg border border-border bg-card">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">Source{source.file ? ` · ${source.file.name}${source.file.rowNumber ? `, row ${source.file.rowNumber}` : ""}` : ""}</summary>
            <div className="border-t border-border">
              <table className="portal-lead-table w-full text-left text-sm">
                <thead><tr><th>Field</th><th>Value now</th><th>Read from</th><th>Last changed</th></tr></thead>
                <tbody>
                  {source.fields.map((field) => (
                    <tr key={field.label}>
                      <td className="text-muted-foreground">{field.label}</td>
                      <td className="text-foreground">{field.value}</td>
                      <td className="max-w-[300px] text-xs">
                        {field.computed ? <span className="text-muted-foreground">Computed from {field.computed}</span>
                          : field.readFrom ? <Link href={field.readFrom.rowNumber ? rowHref(field.readFrom.fileId, field.readFrom.rowNumber) : fileHref(field.readFrom.fileId)} className="block truncate hover:underline" title={`Snapshot of ${fileDay(field.readFrom.snapshotDate)} · ${field.readFrom.fileName ?? "file"}${field.readFrom.rowNumber ? `, row ${field.readFrom.rowNumber}` : ""}`}>{field.readFrom.fileName ?? "The file"}{field.readFrom.rowNumber ? `, row ${field.readFrom.rowNumber}` : ""}</Link>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="max-w-[260px] text-xs tabular-nums">
                        {field.changedIn ? <Link href={field.changedIn.rowNumber ? rowHref(field.changedIn.fileId, field.changedIn.rowNumber) : fileHref(field.changedIn.fileId)} className="block truncate hover:underline" title={field.changedIn.fileName ?? undefined}>{fileDay(field.changedOn)} · {field.changedIn.fileName ?? "file"}{field.changedIn.rowNumber ? `, row ${field.changedIn.rowNumber}` : ""}</Link>
                          : <span className="text-muted-foreground">{field.computed ? "—" : "never"}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {source.raw && (
                <div className="border-t border-border px-4 py-3">
                  <p className="m-0 mb-2 text-xs text-muted-foreground">The row exactly as the carrier sent it{source.file?.date ? ` (file of ${fileDay(source.file.date)})` : ""}:</p>
                  <dl className="m-0 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    {Object.entries(source.raw).map(([column, value]) => (
                      <div key={column} className="flex min-w-0 gap-2"><dt className="shrink-0 font-mono text-muted-foreground">{column}</dt><dd className="m-0 truncate font-mono text-foreground" title={String(value ?? "")}>{String(value ?? "")}</dd></div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </details>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <TableCard title="Money">
            {!view.ledger.available ? (
              <p className="m-0 px-4 py-4 text-sm text-muted-foreground">The commission ledger needs a database update (20261008220000).</p>
            ) : !view.ledger.totals ? (
              <div className="grid gap-2 px-4 py-4 text-sm">
                {["Advance received", "Earned to date", "Charged back", "Still at risk"].map((term) => (
                  <div key={term} className="flex items-baseline justify-between gap-3"><span className="text-muted-foreground">{term}</span><span className="font-semibold tabular-nums text-foreground">Unknown</span></div>
                ))}
                <p className="m-0 text-xs text-muted-foreground">Unknown until this carrier&apos;s commission statements are read.</p>
              </div>
            ) : (
              <div className="grid gap-1 px-4 py-3 text-sm">
                {/* Each figure opens the ledger lines behind it. */}
                {([
                  ["Advance received", view.ledger.totals.advancedCents, "advance"],
                  ["Earned to date", view.ledger.totals.earnedCents, "earned"],
                  ["Charged back", view.ledger.totals.chargedBackCents, "chargeback"],
                  ...(view.ledger.totals.overrideCents ? [["Overrides (upline)", view.ledger.totals.overrideCents, "override"]] : []),
                  ...(view.ledger.totals.feeCents || view.ledger.totals.interestCents ? [["Fees and interest", view.ledger.totals.feeCents + view.ledger.totals.interestCents, "fee"]] : []),
                  ["Net received", view.ledger.totals.netReceivedCents, "net"],
                  ...(view.ledger.totals.heldCents ? [["Held, not paid yet", view.ledger.totals.heldCents, "held"]] : []),
                ] as Array<[string, number, string]>).map(([term, cents, kind]) => {
                  const lines = view.ledger.entries.filter((entry) => kind === "net" ? (entry.correctsType ?? entry.type) !== "held" : kind === "fee" ? ["fee", "advance_interest"].includes(entry.correctsType ?? entry.type) : (entry.correctsType ?? entry.type) === kind);
                  return (
                    <details key={term} className="group">
                      <summary className={`flex cursor-pointer list-none items-baseline justify-between gap-3 rounded py-1 hover:bg-[var(--surface-hover,transparent)] ${kind === "net" ? "border-t border-border pt-2 font-semibold" : ""}`}>
                        <span className="text-muted-foreground group-open:text-foreground">{term} <span className="text-xs">({lines.length})</span></span>
                        <span className="font-semibold tabular-nums text-foreground">{signed(cents)}</span>
                      </summary>
                      <PagedProvider>
                      <PagedBody as="ul" className="m-0 mb-2 list-none border-l-2 border-border pl-3 text-xs">
                        {lines.map((entry) => (
                          <li key={entry.id} className="flex justify-between gap-2 py-0.5">
                            <span className="min-w-0 truncate text-muted-foreground" title={[entry.reversalReason, entry.fileName ? `${entry.fileName}, row ${entry.rowNumber}` : null].filter(Boolean).join(" · ")}>{fileDay(entry.transactionDate ?? entry.statementDate)} · {entry.type === "reversal" ? "reversal" : entry.type.replaceAll("_", " ")}{entry.fileName ? <> · <Link href={rowHref(entry.fileId, entry.rowNumber)} className="hover:text-foreground hover:underline">row {entry.rowNumber}</Link></> : ""}</span>
                            <span className="shrink-0 tabular-nums">{signed(entry.amountCents)}</span>
                          </li>
                        ))}
                      </PagedBody>
                      {lines.length > 10 && <div className="mb-2 flex flex-wrap items-center justify-between gap-3 border-t border-border py-2 text-xs text-muted-foreground"><PagedPager total={lines.length} noun="lines" /></div>}
                      </PagedProvider>
                    </details>
                  );
                })}
                {view.ledger.unearned && (
                  <details className="group mt-1 rounded-md border border-border px-3 py-2">
                    <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3">
                      <span className="font-semibold text-foreground">Still at risk</span>
                      <span className={`font-semibold tabular-nums ${view.ledger.unearned.atRiskCents ? "text-[var(--warning-ink)]" : "text-foreground"}`}>{view.ledger.unearned.atRiskCents === null ? "Unknown" : signed(view.ledger.unearned.atRiskCents)}</span>
                    </summary>
                    <p className="m-0 mt-2 text-xs text-muted-foreground">
                      {view.ledger.unearned.reason
                        ? `Unknown: ${view.ledger.unearned.reason}.`
                        : `Advance ${signed(view.ledger.unearned.advancedCents)} over ${view.ledger.unearned.months} months (from the ${view.ledger.unearned.monthsSource}${view.ledger.rule ? `, ${view.ledger.rule.productCode} from ${fileDay(view.ledger.rule.effectiveFrom)}` : ""}), ${view.ledger.unearned.clawbackType === "full" ? "charged back in full until it is earned" : "earned month by month"}. Months paid: ${view.ledger.unearned.monthsPaid}. Unearned ${signed(view.ledger.unearned.unearnedCents ?? 0)}, less ${signed(-view.ledger.unearned.chargedBackCents)} already charged back.`}
                    </p>
                  </details>
                )}
                {/* Only while some advance is still at risk (or that is unknown): a fully charged-back advance has nothing left to lose. */}
                {policy.inClawbackWindow && view.ledger.unearned && view.ledger.unearned.atRiskCents !== 0 && <p className="m-0 mt-1 text-xs text-[var(--warning-ink)]">Inside the chargeback window: a lapse now means part of the advance comes back.</p>}
              </div>
            )}
            {/* LA-4.13: what the carrier should pay, once its trigger has occurred. */}
            {view.expected.available && (
              <div className="border-t border-border px-4 py-3 text-sm">
                <span className="block text-xs text-muted-foreground">Expected first-year commission</span>
                {view.expected.rows.length === 0 ? (
                  <span className="text-muted-foreground">Nothing expected yet: the carrier hasn&apos;t reached its pay trigger, or its trigger isn&apos;t set in Carrier rules.</span>
                ) : view.expected.rows[0].confidence === "no_rate_card" ? (
                  <span className="text-[var(--warning-ink)]">Unknown: {view.expected.rows[0].reason}. {["owner", "bookkeeper"].includes(guard.role) && <Link href="/app/rate-card" className="font-semibold underline">Add the rate</Link>}</span>
                ) : (
                  <>
                    <span className="font-semibold tabular-nums text-foreground">{dollars(Number(view.expected.rows[0].expected_amount_cents))}</span>
                    {view.expected.rows[0].expected_advance_cents !== null && <span className="text-muted-foreground"> · {dollars(Number(view.expected.rows[0].expected_advance_cents))} as an advance</span>}
                    <span className="block text-xs text-muted-foreground">
                      {view.expected.rows[0].rate_bp_applied / 100}% of {dollars(Number(view.expected.rows[0].commissionable_premium_cents))} a year{view.expected.rows[0].confidence === "assumed_level" ? ", contract level assumed" : ""} · {view.expected.rows[0].commission_trigger === "on_issue" ? "issued" : "first draft"} {fileDay(view.expected.rows[0].trigger_occurred_on)}{view.expected.rows[0].overdue_from ? ` · due by ${fileDay(view.expected.rows[0].overdue_from)}` : ""}
                    </span>
                  </>
                )}
              </div>
            )}
            <div className="border-t border-border px-4 py-3 text-sm">
              <span className="block text-xs text-muted-foreground">Lead source</span>
              <span className="font-medium text-foreground">{lead.name ?? "Not known"}</span>
              {lead.costPerLeadCents !== null && <span className="block text-xs text-muted-foreground">Campaign average {dollars(lead.costPerLeadCents)} a lead</span>}
            </div>
          </TableCard>

          {(others.length > 0 || household) && (
            <PagedTableCard total={others.length} noun="policies" title={others.length ? `${client?.name ?? "This client"} has ${others.length + 1} policies` : "Household"}>
              <PagedBody as="ul" className="m-0 list-none px-4 py-3 text-sm">
                {others.map((other) => (
                  <li key={`${other.carrierId}|${other.policyNumber}`} className="flex items-baseline justify-between gap-3 py-1">
                    <Link href={policyHref(other.carrierId, other.policyNumber)} className="min-w-0 truncate hover:underline">{other.carrierName} · <span className="font-mono text-xs">{other.policyNumber}</span></Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{statusLabel(other.status)}{other.annualCents !== null ? ` · ${dollars(Math.round(other.annualCents / 12))}/mo` : ""}</span>
                  </li>
                ))}
              </PagedBody>
              {household && (
                <div className="border-t border-border px-4 py-3 text-sm">
                  <span className="block text-xs text-muted-foreground">Household ({household.people.join(", ")})</span>
                  <span className="font-semibold tabular-nums text-foreground">{dollars(household.monthlyCents)} a month</span>
                  <span className="text-xs text-muted-foreground"> across {household.policies} policies in force or at risk</span>
                </div>
              )}
            </PagedTableCard>
          )}

          <TableCard title="Your notes">
            <div className="px-4 py-4">
              {view.notes.available ? (
                <PolicyAnnotationForm
                  carrierId={policy.carrierId}
                  policyNumber={policy.policyNumber}
                  notes={view.notes.text}
                  vendorId={lead.vendorId}
                  campaignId={lead.campaignId}
                  vendors={view.choices.vendors}
                  campaigns={view.choices.campaigns}
                  leadFromSale={lead.fromSale}
                  disabledReason={readOnly ? "The account is read-only." : null}
                />
              ) : (
                <p className="m-0 text-sm text-muted-foreground">Notes need a database update (20261008210000).</p>
              )}
            </div>
          </TableCard>
        </div>
      </div>
    </div>
  );
}
