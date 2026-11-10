import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { getConsentRecord } from "@/lib/consent/locker";
import { CONSENT_STATUS_HINTS, CONSENT_STATUS_LABELS, type ConsentStatus } from "@/lib/consent/constants";
import { evidenceTime } from "@/lib/consent/evidence";
import { mayGenerateReports } from "@/lib/compliance/evidenceReport";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Compliance › Consent › a certificate (LA-2.6; foundation pass 2026-11-03, was a pop-up over the list). The
 * title is the lead, with the certificate's state; one line of facts; the provider's own certificate as the
 * one button and More for the lead and its evidence report. Two tabs: Details (every fact the locker holds,
 * "Not recorded" where it holds nothing) and Our stored copy. Read-only: a certificate is evidence, never edited.
 */
type Tab = "details" | "copy";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TONE: Record<ConsentStatus, StatusTone> = { claimed: "good", pending: "warning", expired: "danger", failed: "danger" };

export default async function ConsentRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("consent_locker");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Consent locker" description="Every consent certificate, searchable, with our stored copy." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Consent locker" detail="Only owners, producers and assistants can open the consent locker." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Consent locker" detail="In an agency, the owner and admins handle the consent locker." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const tab: Tab = (await searchParams).tab === "copy" ? "copy" : "details";
  let record: Awaited<ReturnType<typeof getConsentRecord>>;
  try {
    record = await getConsentRecord(guard.context.tenantId, id);
  } catch {
    notFound();
  }
  const digits = (record.leadPhone ?? "").replace(/\D/g, "").slice(-10);
  // Everything else held about this number is on Evidence, for the roles that may generate a report.
  const evidence = digits.length === 10 && actAsPage(guard, ["owner", "producer"]) && (await mayGenerateReports(guard.context.tenantId, guard.role));
  const base = `/app/consent/${record.id}`;
  const facts = [
    `${record.provider} certificate`,
    record.vendorName ? `from ${record.vendorName}` : null,
    `captured ${evidenceTime(record.capturedAt)}`,
    record.consentTimestamp ? `consent given ${evidenceTime(record.consentTimestamp)}` : "consent time not stated",
  ].filter(Boolean).join(" · ");
  const rows: [string, string | null][] = [
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
  ];

  return (
    <ComplianceFlowPage
      step="consent"
      title={record.leadName}
      chip={<StatusChip tone={TONE[record.status]}>{CONSENT_STATUS_LABELS[record.status]}</StatusChip>}
      facts={facts}
      tabs={<ViewTabs label="This certificate" value={tab} tabs={[
        { key: "details", label: "Details", href: base },
        { key: "copy", label: "Our stored copy", href: `${base}?tab=copy` },
      ]} />}
      actions={<>
        <MoreMenu items={[
          { label: "Open the lead", href: `/app/leads/${record.leadId}` },
          evidence ? { label: "Evidence report for this number", href: `/app/evidence-report?phone=${digits}` } : null,
        ]} />
        {record.certificateUrl ? <Button asChild><a href={record.certificateUrl} target="_blank" rel="noreferrer noopener">Provider&rsquo;s certificate<ExternalLink aria-hidden="true" /></a></Button> : null}
      </>}
    >
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
            </tbody>
          </table>
        </TableCard>
      ) : record.hasStoredCopy ? (
        <TableCard title="Our stored copy" description="What we claimed from the provider. It survives their link expiring.">
          <pre className="m-0 max-h-[60vh] overflow-auto border-t border-border px-4 py-3 text-xs leading-normal whitespace-pre-wrap break-all text-[var(--body)]">{JSON.stringify(record.storedCopy ?? { stored_ref: record.storedRef }, null, 2)}</pre>
        </TableCard>
      ) : (
        <TableCard>
          <EmptyState title="No stored copy" hint="The provider's link is all that exists, and it is theirs to expire." action={record.certificateUrl ? <Button variant="outline" asChild><a href={record.certificateUrl} target="_blank" rel="noreferrer noopener">Open the provider&rsquo;s certificate</a></Button> : <Button variant="outline" asChild><Link href="/app/consent">Back to the locker</Link></Button>} />
        </TableCard>
      )}
    </ComplianceFlowPage>
  );
}
