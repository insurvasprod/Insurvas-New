import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { DeletionError, deletionSettings, eventsFor, getDeletionRequest, listDeletionRequests, previewDeletion } from "@/lib/compliance/dataSubjectStore";
import { METHOD_LABELS, VIA_LABELS, holdRemaining, type VerificationMethod } from "@/lib/compliance/dataSubject";
import { OPEN_DELETION, deletionChip, deletionName, deletionQueue, holdRows } from "@/lib/compliance/deletionView";
import { loadComplianceSettings } from "@/lib/compliance/settingsStore";
import { formatPhone } from "@/lib/compliance/evidenceGaps";
import { dayMonthYear } from "@/lib/format/dates";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RecordStepper, neighboursOf } from "@/components/app/accounting/record-stepper";
import { DeletionRequestActions } from "@/components/app/compliance/deletion-requests-board";
import { ComplianceFlowPage } from "@/components/app/compliance/compliance-flow";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Compliance › Deletions › a request (LA-6.5; foundation pass 2026-11-03, was a side sheet; round 7 2026-11-11,
 * mockups-r7/compliance.html 5·1). The title is the person's name alone; tabs What we hold · Audit trail (and
 * Certificate once deleted) on the title line; ‹ › name the neighbouring requests in the Open list's order (All
 * when this one is closed); the step's one action and More, each a confirm with its fields. A plain strip
 * carries the status chip, the phone (its evidence report), the email and when it arrived. What we hold says
 * what happens to each record, and why, before anyone deletes (Module 6 §7), read from the purge registry.
 * Owner and producer read; the agency's performers move it.
 */
type Tab = "held" | "trail" | "deleted";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (iso: string | null) => (iso ? dayMonthYear(iso) : "—");
const words = (key: string) => key.replace(/[_:]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default async function DeletionRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Deletion requests" description="When one person asks to be deleted: verify, hold, delete and certify." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Deletion requests" detail="Only owners and producers can see consumer deletion requests." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Deletion requests" detail="In an agency, the owner and admins handle deletion requests." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const asked = (await searchParams).tab;
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role };
  let loaded: { request: Awaited<ReturnType<typeof getDeletionRequest>>; events: Awaited<ReturnType<typeof eventsFor>>; preview: Awaited<ReturnType<typeof previewDeletion>> | null; settings: Awaited<ReturnType<typeof deletionSettings>>; mayPerform: boolean; list: Awaited<ReturnType<typeof listDeletionRequests>> } | null = null;
  let problem: string | null = null;
  try {
    // The list is read beside the request, for ‹ ›: the same rows and order the list page shows.
    const [request, settings, compliance, list] = await Promise.all([getDeletionRequest(viewer, id), deletionSettings(viewer.tenantId), loadComplianceSettings(viewer.tenantId), listDeletionRequests(viewer)]);
    const mayPerform = compliance.deletion.performerRoles.includes(guard.role);
    // Before the deletion, what would be found: read only, as the API does, for the roles that may perform it.
    const [events, preview] = await Promise.all([eventsFor(viewer, id), ["received", "verifying", "scheduled"].includes(request.status) && mayPerform ? previewDeletion(viewer, id) : null]);
    loaded = { request, events, preview, settings, mayPerform, list };
  } catch (error) {
    if (!(error instanceof DeletionError)) throw error;
    if (error.status === 404) notFound();
    problem = error.message;
  }
  if (!loaded) return <ComplianceFlowPage step="deletions" title="Deletion request"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></ComplianceFlowPage>;
  const { request: r, events, preview, settings, mayPerform, list } = loaded;
  const completed = r.status === "completed";
  const tab: Tab = asked === "trail" ? "trail" : asked === "deleted" && completed ? "deleted" : "held";
  const now = new Date();
  const hold = holdRemaining(r.scheduledPurgeAt, now);
  const base = `/app/deletion-requests/${r.id}`;
  const chip = deletionChip(r, now);
  // ‹ › walk the Open list, oldest first, as the list shows it; a closed request walks All.
  const walk = deletionQueue(list, OPEN_DELETION.has(r.status) ? "open" : "all", now);
  const { previous, next } = neighboursOf(walk, r.id, (row) => row.id);
  const neighbour = (row: typeof previous) => (row ? { href: `/app/deletion-requests/${row.id}`, label: deletionName(row) } : null);
  const statusNote = r.status === "received" || r.status === "verifying" ? (mayPerform ? "Waiting on you" : "Waiting on the agency owner")
    : r.status === "scheduled" ? (hold.due ? "Ready to delete" : hold.label.split(";")[0])
    : completed ? `Deleted ${day(r.completedAt)}`
    : r.verifiedAt ? `Verified ${day(r.verifiedAt)}${r.verificationMethod ? `, ${(METHOD_LABELS[r.verificationMethod as VerificationMethod] ?? r.verificationMethod).split(/[,(—]/)[0].trim().toLowerCase()}` : ""}`
    : "—";
  const phone = r.phoneDigits ? formatPhone(r.phoneDigits) : null;
  const rows = holdRows({ preview: preview as Record<string, number> | null, results: completed ? r.results : null, trail: events.length });
  const results = Object.entries(r.results ?? {}).flatMap(([group, tables]) => Object.entries(tables).map(([table, n]) => ({ group, table, ...n })));

  return (
    <ComplianceFlowPage
      step="deletions"
      title={deletionName(r)}
      tabs={<ViewTabs label="This request" value={tab} tabs={[
        { key: "held", label: "What we hold", href: base },
        { key: "trail", label: "Audit trail", count: events.length || null, href: `${base}?tab=trail` },
        ...(completed ? [{ key: "deleted", label: "Certificate", href: `${base}?tab=deleted` }] : []),
      ]} />}
      actions={<>
        <RecordStepper noun="request" previous={neighbour(previous)} next={neighbour(next)} />
        <DeletionRequestActions request={r} methods={settings.methods} holdDays={settings.holdDays} mayPerform={mayPerform} readOnly={guard.entitlement.access === "read_only"} />
      </>}
    >
      {/* The facts, plain; the one chip is the request's status (r7 5·1). */}
      <StatStrip label="This request">
        <StatTile label="Status" valueSize="text" value={<StatusChip tone={chip.tone}>{chip.label}</StatusChip>} footnote={statusNote} />
        <StatTile label="Phone" valueSize="text" value={phone ?? "—"} footnote={phone ? "Evidence report ›" : "none given"} href={r.phoneDigits ? `/app/evidence-report?phone=${r.phoneDigits}` : undefined} />
        <StatTile label="Email" valueSize="text" value={r.email ?? "—"} footnote={r.email ? "as given" : "none given"} />
        <StatTile label="Received" valueSize="text" value={day(r.receivedAt)} footnote={`by ${(VIA_LABELS[r.receivedVia as keyof typeof VIA_LABELS] ?? r.receivedVia).toLowerCase()}`} />
      </StatStrip>
      {tab === "trail" ? (
        <TableCard>
          {events.length === 0 ? <EmptyState title="Nothing recorded yet" hint="Every step of the request is listed here as it happens." /> : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>When</th><th>What happened</th><th>Detail</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={`${e.at}-${e.action}`}>
                    <td className="whitespace-nowrap tabular-nums font-medium text-foreground">{e.at.slice(0, 16).replace("T", " ")}</td>
                    <td className="whitespace-nowrap">{words(e.action)}</td>
                    <td className="max-w-[420px] truncate whitespace-nowrap" title={JSON.stringify(e.detail ?? {})}>{Object.entries(e.detail ?? {}).filter(([, v]) => v !== null && typeof v !== "object").map(([k, v]) => `${words(k)}: ${String(v)}`).join(" · ") || <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : tab === "deleted" ? (
        // The certificate's content: what was removed, anonymised and kept, and why (LA-6.5).
        <TableCard>
          {results.length === 0 ? <EmptyState title="No per-table counts recorded" hint="The certificate holds what the deletion reported." /> : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Records</th><th>Table</th><th className="text-right">Deleted</th><th className="text-right">Anonymised</th><th className="text-right">Kept</th><th>Why kept</th></tr></thead>
              <tbody>
                {results.map((row) => (
                  <tr key={`${row.group}-${row.table}`}>
                    <td className="whitespace-nowrap font-medium text-foreground">{words(row.group)}</td>
                    <td className="whitespace-nowrap">{row.table}</td>
                    <td className="text-right tabular-nums">{row.purged ?? 0}</td>
                    <td className="text-right tabular-nums">{row.anonymised ?? 0}</td>
                    <td className="text-right tabular-nums">{row.kept ?? 0}</td>
                    <td className="max-w-[320px] truncate whitespace-nowrap" title={row.reason ?? row.note ?? undefined}>{row.reason ?? row.note ?? <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      ) : r.status === "rejected" || r.status === "cancelled" ? (
        <TableCard>
          <EmptyState title={r.status === "rejected" ? "Rejected — nothing was deleted" : "Cancelled — nothing was deleted"} hint={r.status === "rejected" ? r.rejectionReason ?? "" : "The request and its audit trail are kept."} />
        </TableCard>
      ) : (
        // What · Found · What happens · Why (Module 6 §7), before anyone deletes, so the certificate holds no
        // surprise. The counts are shown to the agency's performers; everyone sees what happens and why.
        <TableCard>
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>What</th><th className="text-right">Found</th><th>What happens</th><th>Why</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.what}>
                  <td className="whitespace-nowrap font-medium text-foreground">{row.what}</td>
                  <td className={row.found === null ? "text-right text-muted-foreground" : "text-right tabular-nums"}>{row.found === null ? "—" : row.found}</td>
                  <td className="whitespace-nowrap">{row.happens}</td>
                  <td className="max-w-[480px] truncate whitespace-nowrap" title={row.why}>{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </ComplianceFlowPage>
  );
}
