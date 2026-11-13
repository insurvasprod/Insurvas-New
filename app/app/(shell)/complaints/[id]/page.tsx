import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { checklistFor, ComplaintError, getComplaint, listComplaints, respondentFor } from "@/lib/compliance/complaintStore";
import { CATEGORY_LABELS, VIA_LABELS, type ComplaintCategory } from "@/lib/compliance/complaints";
import { complaintPeople } from "@/lib/compliance/complaintPeople";
import { formatPhone } from "@/lib/compliance/evidenceGaps";
import { dayMonthYear } from "@/lib/format/dates";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RecordStepper, neighboursOf } from "@/components/app/accounting/record-stepper";
import { ComplaintRecord, type ComplaintTab } from "@/components/app/compliance/complaints-board";
import { complaintChannel, complaintChip, complaintName, complaintWalk } from "@/lib/compliance/complaintView";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Compliance › Complaints › a complaint (LA-6.4; foundation pass 2026-11-03, was a side panel over the list;
 * round 7 2026-11-11, mockups-r7/compliance.html 4·1). The title is the complainant alone (what it is about when
 * nobody is named), with no chip; tabs Complaint · Response · Files on the title line; ‹ › name the neighbouring
 * complaints in the Not resolved list's order (All when this one is resolved); the next thing to do and More.
 * A plain strip carries the facts: the deadline with its countdown chip, what it is about, who it was made to,
 * the number (its evidence report) and when it arrived. Owner and producer; opening writes nothing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (iso: string | null) => (iso ? dayMonthYear(iso) : "—");

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
  let loaded: { complaint: Awaited<ReturnType<typeof getComplaint>>; checklist: Awaited<ReturnType<typeof checklistFor>>; respondent: Awaited<ReturnType<typeof respondentFor>> | null; people: Awaited<ReturnType<typeof complaintPeople>>; list: Awaited<ReturnType<typeof listComplaints>> } | null = null;
  let problem: string | null = null;
  try {
    // The list is read beside the complaint, for ‹ ›: the same rows and order the list page shows.
    const [complaint, list] = await Promise.all([getComplaint(viewer, id), listComplaints(viewer, { search: "" })]);
    // A regulator complaint is answered under the business's legal name and NPN (LA-8.3).
    const [checklist, respondent, people] = await Promise.all([checklistFor(complaint.category), complaint.channel === "doi" ? respondentFor(viewer.tenantId, complaint.regulatorState) : null, complaintPeople(viewer.tenantId)]);
    loaded = { complaint, checklist, respondent, people, list };
  } catch (error) {
    if (!(error instanceof ComplaintError)) throw error;
    if (error.status === 404) notFound();
    problem = error.message;
  }
  if (!loaded) return <ComplianceFlowPage step="complaints" title="Complaint"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></ComplianceFlowPage>;
  const { complaint: c, checklist, respondent, people, list } = loaded;
  const base = `/app/complaints/${c.id}`;
  const filesCount = c.attachments.length + c.responseAttachments.length;
  const chip = complaintChip(c);
  const isOwner = guard.role === "owner";
  const { previous, next } = neighboursOf(complaintWalk(list, c.id), c.id, (row) => row.id);
  const neighbour = (row: typeof previous) => (row ? { href: `/app/complaints/${row.id}`, label: complaintName(row) } : null);
  const via = (VIA_LABELS[c.receivedVia as keyof typeof VIA_LABELS] ?? c.receivedVia).toLowerCase();

  return (
    <ComplianceFlowPage
      step="complaints"
      title={complaintName(c)}
      tabs={<ViewTabs label="This complaint" value={tab} tabs={[
        { key: "complaint", label: "Complaint", href: base },
        { key: "response", label: "Response", href: `${base}?tab=response` },
        { key: "files", label: "Files", count: filesCount || null, href: `${base}?tab=files` },
      ]} />}
      actions={<RecordStepper noun="complaint" previous={neighbour(previous)} next={neighbour(next)} />}
    >
      {/* The facts, plain; the one chip is the deadline's countdown (r7 4·1). */}
      <StatStrip label="This complaint">
        <StatTile label="Deadline" valueSize="text" value={day(c.responseDueAt)}
          footnote={c.countdown.tone === "none" ? c.countdown.label : <StatusChip tone={chip.tone}>{chip.label}</StatusChip>}
          href={c.countdown.tone === "no_deadline" && isOwner ? "/app/compliance/settings#deadlines" : undefined} />
        <StatTile label="About" valueSize="text" value={CATEGORY_LABELS[c.category as ComplaintCategory] ?? c.category}
          footnote={[c.aboutAgent?.name, c.policyNumber ? `policy ${c.policyNumber}` : null].filter(Boolean).join(" · ") || "not about one agent"} />
        <StatTile label="Made to" valueSize="text" value={complaintChannel(c)} footnote={c.partner ? `via ${c.partner.name}` : `owner ${c.owner.name}`} />
        <StatTile label="Number" valueSize="text" value={c.phoneDigits ? formatPhone(c.phoneDigits) : "—"}
          footnote={c.phoneDigits ? (c.dncAddedAt ? `On do-not-call since ${day(c.dncAddedAt)} · Evidence report ›` : "Evidence report ›") : "none given"}
          href={c.phoneDigits ? `/app/evidence-report?phone=${c.phoneDigits}` : undefined} />
        <StatTile label="Received" valueSize="text" value={day(c.receivedAt)} footnote={`by ${via}`} />
      </StatStrip>
      <ComplaintRecord key={`${c.id}-${tab}`} complaint={c} checklist={checklist} respondent={respondent} team={people.team} tab={tab}
        isOwner={isOwner} readOnly={guard.entitlement.access === "read_only"} />
    </ComplianceFlowPage>
  );
}
