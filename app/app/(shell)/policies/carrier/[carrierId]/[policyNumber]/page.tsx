import Link from "next/link";
import { notFound } from "next/navigation";

import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PolicyAnnotationForm } from "@/components/app/policy-annotation-form";
import { ProvisionalBadge } from "@/components/app/provisional-badge";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { guardPage } from "@/lib/entitlements/guardPage";
import { fileDay } from "@/lib/ingestion/constants";
import { RISK_LABELS, statusLabel, type RiskBand } from "@/lib/ingestion/policyBook";
import { loadPolicy } from "@/lib/ingestion/policyBookStore";
import { moneyOrUnknown } from "@/lib/ingestion/policyCurrent";
import { isRecordUuid } from "@/lib/ingestion/path";

const RISK_TONE: Record<RiskBand, StatusTone> = { none: "neutral", watch: "info", at_risk: "warning", critical: "danger" };
const MODE: Record<string, string> = { monthly: "a month", quarterly: "a quarter", semiannual: "every 6 months", annual: "a year" };
const METHOD: Record<string, string> = { bank_draft: "Bank draft", direct_express: "Direct Express", card: "Card", direct_bill: "Direct bill (mailed)" };
const KIND_DOT: Record<string, string> = { sale: "bg-[var(--info)]", carrier: "bg-[var(--primary)]", change: "bg-[var(--warning)]", money: "bg-[var(--success)]" };
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

  const view = await loadPolicy({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role }, carrierId, policyNumber);
  if (!view) {
    return (
      <div className="m-stagger flex flex-col gap-6">
        <Link href="/app/policies" className="text-sm text-muted-foreground hover:underline">← Policies</Link>
        <EmptyState title="This policy is not in your book" hint={guard.role === "producer" ? "It may be credited to another agent, or its carrier file hasn't arrived yet." : "Its carrier file may not have arrived yet, or the policy number is different."} />
      </div>
    );
  }
  const { policy, client, lead, timeline, source, others, household } = view;
  const readOnly = guard.entitlement.access === "read_only";
  const monthly = policy.annualCents === null ? null : Math.round(policy.annualCents / 12);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <Link href="/app/policies" className="text-sm text-muted-foreground hover:underline">← Policies</Link>
      <PageHeader
        title={client?.name ?? `Policy ${policy.policyNumber}`}
        description={`${policy.carrierName} · Policy ${policy.policyNumber}${policy.product ? ` · ${policy.product}` : ""}`}
      />
      {client?.provisional && <p role="status" className="-mt-4 m-0 text-sm"><ProvisionalBadge /> <span className="text-muted-foreground">This client was built from the carrier&apos;s file. <Link href="/app/duplicates" className="font-medium text-[var(--accent-ink)] hover:underline">Check it in the contact directory</Link>.</span></p>}
      {!client && <p role="status" className="-mt-4 m-0 text-sm text-[var(--warning-ink)]">No client is linked to this policy yet. <Link href="/app/policy-matching" className="font-medium underline">Link it in Policy matching</Link>.</p>}

      <StatStrip label="This policy">
        <StatTile label="Premium" value={dollars(policy.premiumCents)} footnote={policy.premiumMode ? `${MODE[policy.premiumMode] ?? policy.premiumMode}${monthly !== null && policy.premiumMode !== "monthly" ? ` · ${dollars(monthly)} a month` : ""}` : "mode not given"} />
        <StatTile label="Face amount" value={dollars(policy.faceCents)} />
        <StatTile label="Status" value={statusLabel(policy.status)} footnote={policy.statusRaw ? `carrier says “${policy.statusRaw}”` : undefined} />
        <StatTile label="Risk" value={RISK_LABELS[policy.riskBand]} valueTone={policy.riskBand === "at_risk" || policy.riskBand === "critical" ? "warning" : undefined} footnote={policy.daysLeft !== null ? `${policy.daysLeft} day${policy.daysLeft === 1 ? "" : "s"} until the carrier closes it` : policy.daysPastDue ? `${policy.daysPastDue} days past due` : "paid up to date"} />
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
                ["Agent", policy.agentName ?? (policy.agentCode ? `Code ${policy.agentCode}, not mapped` : "—")],
              ].map(([term, value]) => (
                <div key={term} className="min-w-0"><dt className="text-xs text-muted-foreground">{term}</dt><dd className="m-0 truncate font-medium text-foreground" title={value}>{value}</dd></div>
              ))}
            </dl>
          </TableCard>

          <TableCard title="Timeline" description="What has happened to this policy, oldest first.">
            {timeline.length === 0 ? (
              <p className="m-0 px-4 py-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <ol className="m-0 list-none px-4 py-3">
                {timeline.map((item, index) => (
                  <li key={index} className="grid grid-cols-[110px_12px_minmax(0,1fr)] items-start gap-3 py-2 text-sm">
                    <span className="tabular-nums text-muted-foreground">{fileDay(item.date)}</span>
                    <span aria-hidden="true" className={`mt-1.5 size-2 rounded-full ${KIND_DOT[item.kind]}`} />
                    <span className="min-w-0"><span className="text-foreground">{item.label}</span>{item.detail && <span className="block truncate text-xs text-muted-foreground" title={item.detail}>{item.detail}</span>}</span>
                  </li>
                ))}
              </ol>
            )}
          </TableCard>

          <details className="rounded-lg border border-border bg-card">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">Source{source.file ? ` · ${source.file.name}${source.file.rowNumber ? `, row ${source.file.rowNumber}` : ""}` : ""}</summary>
            <div className="border-t border-border">
              <table className="portal-lead-table w-full text-left text-sm">
                <thead><tr><th>Field</th><th>Value now</th><th>Last changed</th><th>From file</th></tr></thead>
                <tbody>
                  {source.fields.map((field) => (
                    <tr key={field.label}>
                      <td className="text-muted-foreground">{field.label}</td>
                      <td className="text-foreground">{field.value}</td>
                      <td className="tabular-nums">{field.changedOn ? fileDay(field.changedOn) : <span className="text-muted-foreground">never</span>}</td>
                      <td className="max-w-[260px] truncate" title={field.fromFile ?? undefined}>{field.fromFile ?? "—"}</td>
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
            <dl className="m-0 grid gap-2 px-4 py-4 text-sm">
              {[
                ["Advance received", policy.money.advancedCents],
                ["Earned to date", policy.money.earnedCents],
                ["Charged back", policy.money.chargedBackCents],
                ["Chargeback exposure", policy.money.unearnedCents],
              ].map(([term, cents]) => (
                <div key={term as string} className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">{term as string}</dt><dd className="m-0 font-semibold tabular-nums text-foreground">{moneyOrUnknown(cents as number | null)}</dd></div>
              ))}
              {policy.money.advancedCents === null && <p className="m-0 text-xs text-muted-foreground">Unknown until this carrier&apos;s commission statements are read.</p>}
              {policy.inClawbackWindow && <p className="m-0 text-xs text-[var(--warning-ink)]">Inside the chargeback window: a lapse now means part of the advance comes back.</p>}
            </dl>
            <div className="border-t border-border px-4 py-3 text-sm">
              <span className="block text-xs text-muted-foreground">Lead source</span>
              <span className="font-medium text-foreground">{lead.name ?? "Not known"}</span>
              {lead.costPerLeadCents !== null && <span className="block text-xs text-muted-foreground">Campaign average {dollars(lead.costPerLeadCents)} a lead</span>}
            </div>
          </TableCard>

          {(others.length > 0 || household) && (
            <TableCard title={others.length ? `${client?.name ?? "This client"} has ${others.length + 1} policies` : "Household"}>
              <ul className="m-0 list-none px-4 py-3 text-sm">
                {others.map((other) => (
                  <li key={`${other.carrierId}|${other.policyNumber}`} className="flex items-baseline justify-between gap-3 py-1">
                    <Link href={policyHref(other.carrierId, other.policyNumber)} className="min-w-0 truncate hover:underline">{other.carrierName} · <span className="font-mono text-xs">{other.policyNumber}</span></Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{statusLabel(other.status)}{other.annualCents !== null ? ` · ${dollars(Math.round(other.annualCents / 12))}/mo` : ""}</span>
                  </li>
                ))}
              </ul>
              {household && (
                <div className="border-t border-border px-4 py-3 text-sm">
                  <span className="block text-xs text-muted-foreground">Household ({household.people.join(", ")})</span>
                  <span className="font-semibold tabular-nums text-foreground">{dollars(household.monthlyCents)} a month</span>
                  <span className="text-xs text-muted-foreground"> across {household.policies} policies in force or at risk</span>
                </div>
              )}
            </TableCard>
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
