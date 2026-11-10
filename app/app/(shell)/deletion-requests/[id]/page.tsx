import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { DeletionError, deletionSettings, eventsFor, getDeletionRequest, previewDeletion } from "@/lib/compliance/dataSubjectStore";
import { METHOD_LABELS, STATUS_LABELS, VIA_LABELS, holdRemaining, type DeletionStatus, type VerificationMethod } from "@/lib/compliance/dataSubject";
import { DELETION_TONE, deletionWho } from "@/lib/compliance/deletionView";
import { loadComplianceSettings } from "@/lib/compliance/settingsStore";
import { formatPhone } from "@/lib/compliance/evidenceGaps";
import { dayMonthYear } from "@/lib/format/dates";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DeletionRequestActions } from "@/components/app/compliance/deletion-requests-board";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Compliance › Deletions › a request (LA-6.5; foundation pass 2026-11-03, was a side sheet). The title is who
 * asked, with the request's state; one line of facts (received, how, verified how and by whom, the hold, the
 * deletion); the step's one action on the title line and the rest in More, each a confirm with its fields.
 * Tabs: What we hold (before the deletion, what would be found; after it, what was removed, anonymised and
 * kept, and why) and Audit trail. Owner and producer read; the agency's performers move it.
 */
type Tab = "held" | "trail";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (iso: string | null) => (iso ? dayMonthYear(iso) : null);
const PREVIEW: [key: string, label: string][] = [["clients", "Client records"], ["leads", "Leads"], ["applications", "Applications"], ["policies", "Policies"], ["carrierRows", "Carrier statement rows"], ["numbers", "Phone numbers"], ["emails", "Email addresses"]];
const words = (key: string) => key.replace(/[_:]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default async function DeletionRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Deletion requests" description="When one person asks to be deleted: verify, hold, delete and certify." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Deletion requests" detail="Only owners and producers can see consumer deletion requests." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Deletion requests" detail="In an agency, the owner and admins handle deletion requests." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const tab: Tab = (await searchParams).tab === "trail" ? "trail" : "held";
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  let loaded: { request: Awaited<ReturnType<typeof getDeletionRequest>>; events: Awaited<ReturnType<typeof eventsFor>>; preview: Awaited<ReturnType<typeof previewDeletion>> | null; settings: Awaited<ReturnType<typeof deletionSettings>>; mayPerform: boolean } | null = null;
  let problem: string | null = null;
  try {
    const [request, settings, compliance] = await Promise.all([getDeletionRequest(viewer, id), deletionSettings(viewer.tenantId), loadComplianceSettings(viewer.tenantId)]);
    const mayPerform = compliance.deletion.performerRoles.includes(guard.role);
    // Before the deletion, what would be found: read only, as the API does, for the roles that may perform it.
    const [events, preview] = await Promise.all([eventsFor(viewer, id), ["received", "verifying", "scheduled"].includes(request.status) && mayPerform ? previewDeletion(viewer, id) : null]);
    loaded = { request, events, preview, settings, mayPerform };
  } catch (error) {
    if (!(error instanceof DeletionError)) throw error;
    if (error.status === 404) notFound();
    problem = error.message;
  }
  if (!loaded) return <ComplianceFlowPage step="deletions" title="Deletion request"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></ComplianceFlowPage>;
  const { request: r, events, preview, settings, mayPerform } = loaded;
  const hold = holdRemaining(r.scheduledPurgeAt, new Date());
  const base = `/app/deletion-requests/${r.id}`;
  const facts = [
    `Received ${day(r.receivedAt)} by ${(VIA_LABELS[r.receivedVia as keyof typeof VIA_LABELS] ?? r.receivedVia).toLowerCase()}`,
    r.requesterPhone ? `from ${/^\d{10}$/.test(r.requesterPhone) ? formatPhone(r.requesterPhone) : r.requesterPhone}` : r.requesterEmail ? `from ${r.requesterEmail}` : null,
    r.verifiedAt ? `verified ${day(r.verifiedAt)}${r.verificationMethod ? ` (${(METHOD_LABELS[r.verificationMethod as VerificationMethod] ?? r.verificationMethod).split(/[,(—]/)[0].trim().toLowerCase()})` : ""}` : null,
    r.status === "scheduled" ? hold.label.toLowerCase() : null,
    r.completedAt ? `deleted ${day(r.completedAt)}` : null,
  ].filter(Boolean).join(" · ");
  const results = Object.entries(r.results ?? {}).flatMap(([group, tables]) => Object.entries(tables).map(([table, n]) => ({ group, table, ...n })));

  return (
    <ComplianceFlowPage
      step="deletions"
      title={deletionWho(r)}
      chip={<StatusChip tone={DELETION_TONE[r.status as DeletionStatus]}>{STATUS_LABELS[r.status as DeletionStatus] ?? r.status}</StatusChip>}
      facts={facts}
      tabs={<ViewTabs label="This request" value={tab} tabs={[
        { key: "held", label: r.status === "completed" ? "What was deleted" : "What we hold", href: base },
        { key: "trail", label: "Audit trail", count: events.length || null, href: `${base}?tab=trail` },
      ]} />}
      actions={<DeletionRequestActions request={r} methods={settings.methods} holdDays={settings.holdDays} mayPerform={mayPerform} readOnly={guard.entitlement.access === "read_only"} />}
    >
      {tab === "trail" ? (
        <TableCard>
          {events.length === 0 ? <EmptyState title="Nothing recorded yet" hint="Every step of the request is listed here as it happens." /> : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>When</th><th>What happened</th><th>Detail</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={`${e.at}-${e.action}`}>
                    <td className="whitespace-nowrap tabular-nums">{e.at.slice(0, 16).replace("T", " ")}</td>
                    <td>{words(e.action)}</td>
                    <td className="max-w-[420px] truncate text-muted-foreground" title={JSON.stringify(e.detail ?? {})}>{Object.entries(e.detail ?? {}).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => `${words(k)}: ${String(v)}`).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : r.status === "completed" ? (
        // The certificate's content: what was removed, anonymised and kept, and why (LA-6.5).
        <TableCard>
          {results.length === 0 ? <EmptyState title="No per-table counts recorded" hint="The certificate holds what the deletion reported." /> : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Records</th><th>Table</th><th className="text-right">Deleted</th><th className="text-right">Anonymised</th><th className="text-right">Kept</th><th>Why kept</th></tr></thead>
              <tbody>
                {results.map((row) => (
                  <tr key={`${row.group}-${row.table}`}>
                    <td>{words(row.group)}</td>
                    <td className="text-muted-foreground">{row.table}</td>
                    <td className="text-right tabular-nums">{row.purged ?? 0}</td>
                    <td className="text-right tabular-nums">{row.anonymised ?? 0}</td>
                    <td className="text-right tabular-nums">{row.kept ?? 0}</td>
                    <td className="max-w-[320px] truncate text-muted-foreground" title={row.reason ?? row.note ?? undefined}>{row.reason ?? row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : preview ? (
        <TableCard title="Found for this person" description="What a deletion would reach today. Policies and commissions are anonymised and kept; the do-not-call entry is always kept.">
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Records</th><th className="text-right">Found</th></tr></thead>
            <tbody>
              {PREVIEW.map(([key, label]) => (
                <tr key={key}><td>{label}</td><td className="text-right tabular-nums">{(preview as Record<string, number>)[key] ?? 0}</td></tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : (
        <TableCard>
          <EmptyState
            title={r.status === "rejected" ? "Rejected — nothing was deleted" : r.status === "cancelled" ? "Cancelled — nothing was deleted" : "What we hold is shown to the agency's performers"}
            hint={r.status === "rejected" ? r.rejectionReason ?? "" :r.status === "cancelled" ? "The request and its audit trail are kept." : "Compliance settings say who may verify and perform a deletion."} />
        </TableCard>
      )}
    </ComplianceFlowPage>
  );
}
