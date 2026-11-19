import { Suspense } from "react";
import { notFound } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { isRecordUuid } from "@/lib/ingestion/path";
import { personName } from "@/lib/format/personName";
import { STATE_LABELS, type CampaignState } from "@/lib/retention/campaign";
import { loadCampaignPolicy } from "@/lib/retention/campaignStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Await, RecordTitle, RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { PaperBillCall, PaperBillCalls } from "@/components/app/retention/paper-bill-call";
import { Button } from "@/components/ui/button";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { StreamSection } from "@/components/ui/stream-section";
import { ViewTabs } from "@/components/ui/view-tabs";
import { IntentLink } from "@/components/ui/nav-pending";

/**
 * Retention › Servicing › Paper bill → bank › a policy (LA-5.5; the pick of 2026-11-05, "PbA"). One call: the
 * talk track, then what happened. Tabs: Call and Calls. "Next policy" walks the list in its own order (to call,
 * with a phone first). Same gate as the campaign view; opening it writes nothing.
 */
const TONE: Record<CampaignState, StatusTone> = { remaining: "action", in_progress: "info", converted: "good", declined: "neutral", no_bank_account: "neutral" };
const callHref = (carrierId: string, policyNumber: string) => `/app/servicing/campaign/${carrierId}/${encodeURIComponent(policyNumber)}`;

export default async function PaperBillCallPage({ params, searchParams }: { params: Promise<{ carrierId: string; policyNumber: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [guard, { carrierId, policyNumber: raw }, query] = await Promise.all([guardPage("payment_repair"), params, searchParams]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Servicing" description="Changes asked of the carrier, tracked until the next carrier file proves them." />;
  if (!actAsPage(guard, ["owner", "producer", "retention"])) return <RoleGateNotice featureLabel="Servicing" detail="Only owners, producers and retention reps can open servicing requests." />;
  const policyNumber = decodeURIComponent(raw);
  if (!isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 120) notFound();
  const readOnly = guard.entitlement.access === "read_only";
  const tab = query.tab === "calls" ? "calls" : "call";
  const base = callHref(carrierId, policyNumber);
  // Frame first (UI-CONSISTENCY §7a): the trail, the tabs and the step draw at once and the name waits in a
  // title-shaped placeholder. The read starts here; the name, the Calls count, Next policy and the tab wait on it.
  const read = scopeFor(guard.context).then((scope) => loadCampaignPolicy({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope }, carrierId, policyNumber));
  const nameOf = (loaded: Awaited<typeof read>) => (loaded ? (loaded.row.clientName ? personName(loaded.row.clientName) : "No client linked") : null);
  const tabsOf = (loaded: Awaited<typeof read> | null) => (
    <ViewTabs label={nameOf(loaded) ?? "Call"} value={tab} tabs={[{ key: "call", label: "Call", href: base }, { key: "calls", label: "Calls", ...(loaded ? { count: loaded.calls.length } : {}), href: `${base}?tab=calls` }]} />
  );

  return (
    <RetentionPage
      step="servicing"
      title={<RecordTitle read={read} name={nameOf} />}
      chip={<Suspense fallback={null}><Await read={read}>{(loaded) => (loaded ? <StatusChip tone={TONE[loaded.row.state]}>{STATE_LABELS[loaded.row.state]}</StatusChip> : null)}</Await></Suspense>}
      breadcrumbs={retentionTrail("servicing", "Call", { label: "Paper bill → bank", href: "/app/servicing?view=campaign" })}
      tabs={<Suspense fallback={tabsOf(null)}><Await read={read}>{tabsOf}</Await></Suspense>}
      actions={<Suspense fallback={null}><Await read={read}>{(loaded) => (loaded?.next ? <Button asChild variant="outline"><IntentLink transitionTypes={["nav-forward"]} href={callHref(loaded.next.carrierId, loaded.next.policyNumber)}>Next policy ›</IntentLink></Button> : null)}</Await></Suspense>}
    >
      <StreamSection shape={tab === "calls" ? "table" : "form"}>
        <Await read={read}>
          {(loaded) => {
            if (!loaded) notFound();
            const { campaign, row, next, calls } = loaded;
            return tab === "calls" ? <PaperBillCalls calls={calls} /> : (
              <PaperBillCall carrierId={carrierId} policyNumber={policyNumber} state={row.state} talkTrack={campaign.talkTrack} cooloffDays={campaign.cooloffDays} nextHref={next ? callHref(next.carrierId, next.policyNumber) : null} readOnly={readOnly} />
            );
          }}
        </Await>
      </StreamSection>
    </RetentionPage>
  );
}
