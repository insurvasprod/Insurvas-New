import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { getConsentRecord } from "@/lib/consent/locker";
import { CONSENT_STATUS_HINTS, CONSENT_STATUS_LABELS } from "@/lib/consent/constants";
import { EVIDENCE_FILTER_LABEL, EVIDENCE_LABEL, evidenceTime, type EvidenceFilter } from "@/lib/consent/evidence";
import { mayGenerateReports } from "@/lib/compliance/evidenceReport";
import { consentLead, consentWindow } from "@/lib/compliance/consentRecordView";
import { EVIDENCE_CHIP, consentRecordHref, evidenceChipTone } from "@/lib/compliance/consentView";
import { formatPhone, normalizeDigits } from "@/lib/suppression/constants";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { RecordStepper, neighboursOf } from "@/components/app/accounting/record-stepper";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Compliance › Consent › a lead's consent record (LA-2.6; foundation pass 2026-11-03, was a pop-up over the list).
 *
 * Round 7 (board 3·1, owner 2026-11-11): the title is the lead's name alone; Details · Our stored copy sit on the
 * title line; ‹ › name the leads either side in the list's order; a plain strip carries the evidence (its one chip),
 * the phone (to its evidence report) and the provider. The id is the lead's best certificate, or — for a lead with
 * none, which the list's "Add proof ›" opens — the lead itself. Read-only: a certificate is evidence, never edited.
 */
type Tab = "details" | "copy";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTERS = Object.keys(EVIDENCE_FILTER_LABEL) as EvidenceFilter[];

export default async function ConsentRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; evidence?: string }> }) {
  const guard = await guardPage("consent_locker");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Consent locker" description="Every consent certificate, searchable, with our stored copy." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Consent locker" detail="Only owners, producers and assistants can open the consent locker." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Consent locker" detail="In an agency, the owner and admins handle the consent locker." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const tab: Tab = query.tab === "copy" ? "copy" : "details";
  // The list the record was opened from: its evidence filter, so ‹ › walk the same leads.
  const evidenceFilter: EvidenceFilter = FILTERS.includes(query.evidence as EvidenceFilter) ? (query.evidence as EvidenceFilter) : "every";
  const tenantId = guard.context.tenantId;

  // A certificate's id first; else a lead's id (a lead with no certificate has a record too).
  let record: Awaited<ReturnType<typeof getConsentRecord>> | null = null;
  try {
    record = await getConsentRecord(tenantId, id);
  } catch {
    record = null;
  }
  const leadId = record ? record.leadId : id;
  const [lead, ordered] = await Promise.all([consentLead(tenantId, leadId), consentWindow(tenantId, evidenceFilter)]);
  if (!record) {
    if (!lead) notFound();
    // A lead that has a certificate opens on it, so one lead never has two records.
    if (lead.artefactId) redirect(consentRecordHref(lead, evidenceFilter));
  }

  const name = record?.leadName ?? lead?.name ?? "Unnamed lead";
  const phone = record?.leadPhone ?? lead?.phone ?? null;
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10);
  // Everything else held about this number is on Evidence, for the roles that may generate a report.
  const evidence = digits.length === 10 && actAsPage(guard, ["owner", "producer"]) && (await mayGenerateReports(tenantId, guard.role));
  const level = lead?.level ?? (record ? (record.status === "claimed" ? (record.ip ? "full" : "no_ip") : record.status === "pending" ? "link_only" : "lost") : "none");
  const providerName = lead?.providerName ?? record?.vendorName ?? "Direct";
  const keep = evidenceFilter !== "every" ? `evidence=${evidenceFilter}` : "";
  const base = `/app/consent/${id}`;
  const { previous, next } = neighboursOf(ordered, leadId, (row) => row.leadId);

  const rows: [string, string | null][] = record ? [
    ["Certificate id", record.certificateId],
    ["State", `${CONSENT_STATUS_LABELS[record.status]}. ${CONSENT_STATUS_HINTS[record.status]}`],
    ["Consent given", record.consentTimestamp ? evidenceTime(record.consentTimestamp) : null],
    ["Captured", evidenceTime(record.capturedAt)],
    ["Copy claimed", record.claimedAt ? evidenceTime(record.claimedAt) : null],
    ["IP address", record.ip],
    ["Phone on the lead", record.leadPhone],
    ["Landing page", record.landingPage],
    ["Source URL", record.sourceUrl],
    ...(record.captureError ? [["Capture error", record.captureError] as [string, string]] : []),
  ] : [
    ["Consent text", null],
    ["Captured", null],
    ["IP address", null],
    ["Certificate", null],
  ];

  return (
    <ComplianceFlowPage
      step="consent"
      title={name}
      tabs={<ViewTabs label="This consent record" value={tab} tabs={[
        { key: "details", label: "Details", href: keep ? `${base}?${keep}` : base },
        { key: "copy", label: "Our stored copy", href: `${base}?tab=copy${keep ? `&${keep}` : ""}` },
      ]} />}
      actions={<>
        <RecordStepper noun="lead"
          previous={previous ? { href: consentRecordHref(previous, evidenceFilter), label: previous.name } : null}
          next={next ? { href: consentRecordHref(next, evidenceFilter), label: next.name } : null} />
        <MoreMenu items={[
          { label: "Open the lead", href: `/app/leads/${leadId}` },
          evidence ? { label: "Evidence report for this number", href: `/app/evidence-report?phone=${digits}` } : null,
        ]} />
        {record?.certificateUrl ? <Button asChild><a href={record.certificateUrl} target="_blank" rel="noreferrer noopener">Provider&rsquo;s certificate<ExternalLink aria-hidden="true" /></a></Button> : null}
      </>}
    >
      <StatStrip label={`${name}'s consent at a glance`}>
        <StatTile label="Evidence" valueSize="text" value={level === "none" ? "None" : EVIDENCE_LABEL[level]} footnote={<StatusChip tone={evidenceChipTone(level)}>{EVIDENCE_CHIP[level]}</StatusChip>} />
        <StatTile label="Phone" valueSize="text" value={phone ? formatPhone(normalizeDigits(phone) ?? phone) : "—"} footnote={evidence ? "Evidence report ›" : " "} href={evidence ? `/app/evidence-report?phone=${digits}` : undefined} />
        <StatTile label="Provider" valueSize="text" value={providerName} footnote={record ? `${record.provider} certificate` : providerName === "Direct" ? "no vendor" : "no certificate"} />
      </StatStrip>

      {tab === "details" ? (
        <TableCard>
          <table className="w-full border-collapse text-left text-sm" data-even="off">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label} className="m-row">
                  <th scope="row" className="w-56 border-t border-border px-4 py-2.5 text-left font-medium text-muted-foreground first:border-t-0">{label}</th>
                  {/* "Not recorded" rather than a blank cell: a missing IP is a fact about the certificate. */}
                  <td className="border-t border-border px-4 py-2.5 break-all text-[var(--ink)]">{value || <span className="text-muted-foreground">Not recorded</span>}</td>
                </tr>
              ))}
              <tr className="m-row">
                <th scope="row" className="w-56 border-t border-border px-4 py-2.5 text-left font-medium text-muted-foreground">Lead</th>
                <td className="border-t border-border px-4 py-2.5"><Link href={`/app/leads/${leadId}`} className="text-[var(--ink)] hover:underline">Open the lead ›</Link></td>
              </tr>
            </tbody>
          </table>
        </TableCard>
      ) : record?.hasStoredCopy ? (
        <TableCard title="Our stored copy" description="What we claimed from the provider. It survives their link expiring.">
          <pre className="m-0 max-h-[60vh] overflow-auto border-t border-border px-4 py-3 text-xs leading-normal whitespace-pre-wrap break-all text-[var(--body)]">{JSON.stringify(record.storedCopy ?? { stored_ref: record.storedRef }, null, 2)}</pre>
        </TableCard>
      ) : (
        <TableCard>
          <EmptyState
            title="No stored copy"
            hint={record ? "The provider's link is all that exists, and it is theirs to expire." : "This lead came in without a consent certificate, so there is nothing to store yet."}
            action={record?.certificateUrl ? <Button variant="outline" asChild><a href={record.certificateUrl} target="_blank" rel="noreferrer noopener">Open the provider&rsquo;s certificate</a></Button> : <Button variant="outline" asChild><Link href="/app/consent">Back to the locker</Link></Button>}
          />
        </TableCard>
      )}
    </ComplianceFlowPage>
  );
}
