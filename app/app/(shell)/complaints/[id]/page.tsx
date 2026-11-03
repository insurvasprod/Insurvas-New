import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { checklistFor, ComplaintError, getComplaint, respondentFor } from "@/lib/compliance/complaintStore";
import { CHANNEL_LABELS, VIA_LABELS, type ComplaintChannel } from "@/lib/compliance/complaints";
import { complaintPeople } from "@/lib/compliance/complaintPeople";
import { formatPhone } from "@/lib/compliance/evidenceGaps";
import { dayMonthYear } from "@/lib/format/dates";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ComplaintRecord, type ComplaintTab } from "@/components/app/compliance/complaints-board";
import { COMPLAINT_TONE, complaintTitle } from "@/lib/compliance/complaintView";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Compliance › Complaints › a complaint (LA-6.4; foundation pass 2026-11-03, was a side panel over the list).
 * The title is what it is about, with its countdown; one line of facts (who it was made to, when, by whom,
 * the number, the policy, the owner, the deadline); Save and More on the title line. Tabs: Complaint (what it
 * says, and the response checklist), Response (written by the agent, and the workflow), Files (what arrived,
 * the evidence report attached at creation, what we sent). Owner and producer; opening writes nothing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (iso: string | null) => (iso ? dayMonthYear(iso) : null);

export default async function ComplaintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Complaints" description="Every complaint with an owner, a deadline and a countdown." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Complaints" detail="Only owners and producers can see consumer complaints." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Complaints" detail="In an agency, the owner and admins handle complaints." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const asked = (await searchParams).tab;
  const tab: ComplaintTab = asked === "response" || asked === "files" ? asked : "complaint";
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  let loaded: { complaint: Awaited<ReturnType<typeof getComplaint>>; checklist: Awaited<ReturnType<typeof checklistFor>>; respondent: Awaited<ReturnType<typeof respondentFor>> | null; people: Awaited<ReturnType<typeof complaintPeople>> } | null = null;
  let problem: string | null = null;
  try {
    const complaint = await getComplaint(viewer, id);
    // A regulator complaint is answered under the business's legal name and NPN (LA-8.3).
    const [checklist, respondent, people] = await Promise.all([checklistFor(complaint.category), complaint.channel === "doi" ? respondentFor(viewer.tenantId, complaint.regulatorState) : null, complaintPeople(viewer.tenantId)]);
    loaded = { complaint, checklist, respondent, people };
  } catch (error) {
    if (!(error instanceof ComplaintError)) throw error;
    if (error.status === 404) notFound();
    problem = error.message;
  }
  if (!loaded) return <ComplianceFlowPage step="complaints" title="Complaint"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></ComplianceFlowPage>;
  const { complaint: c, checklist, respondent, people } = loaded;
  const base = `/app/complaints/${c.id}`;
  const channel = c.channel === "ftc" ? "FTC" : c.channel === "doi" ? `${c.regulatorState ?? "State"} DOI` : CHANNEL_LABELS[c.channel as ComplaintChannel] ?? c.channel;
  const facts = [
    `Made to ${channel}`,
    `received ${day(c.receivedAt)} by ${(VIA_LABELS[c.receivedVia as keyof typeof VIA_LABELS] ?? c.receivedVia).toLowerCase()}`,
    c.complainantName,
    c.phoneDigits ? formatPhone(c.phoneDigits) : null,
    c.policyNumber ? `policy ${c.policyNumber}` : null,
    c.aboutAgent ? `about ${c.aboutAgent.name}` : null,
    c.partner ? `via ${c.partner.name}` : null,
    `owner ${c.owner.name}`,
    c.responseDueAt ? `respond by ${day(c.responseDueAt)}` : null,
    c.dncAddedAt ? `on do-not-call since ${day(c.dncAddedAt)}` : null,
  ].filter(Boolean).join(" · ");
  const filesCount = c.attachments.length + c.responseAttachments.length;

  return (
    <ComplianceFlowPage
      step="complaints"
      title={complaintTitle(c)}
      chip={<StatusChip tone={COMPLAINT_TONE[c.countdown.tone]}>{c.countdown.label}</StatusChip>}
      facts={facts}
      lead={<ViewTabs label="This complaint" value={tab} tabs={[
        { key: "complaint", label: "Complaint", href: base },
        { key: "response", label: "Response", href: `${base}?tab=response` },
        { key: "files", label: "Files", count: filesCount || null, href: `${base}?tab=files` },
      ]} />}
    >
      <ComplaintRecord key={`${c.id}-${tab}`} complaint={c} checklist={checklist} respondent={respondent} team={people.team} tab={tab}
        isOwner={guard.role === "owner"} readOnly={guard.entitlement.access === "read_only"} />
    </ComplianceFlowPage>
  );
}
