import Link from "next/link";
import { notFound } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { isRecordUuid } from "@/lib/ingestion/path";
import { personName } from "@/lib/format/personName";
import { STATE_LABELS, type CampaignState } from "@/lib/retention/campaign";
import { loadCampaignPolicy } from "@/lib/retention/campaignStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { PaperBillCall, PaperBillCalls } from "@/components/app/retention/paper-bill-call";
import { Button } from "@/components/ui/button";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Retention › Servicing › Paper bill → bank › a policy (LA-5.5; the pick of 2026-11-05, "PbA"). One call: the
 * talk track, then what happened. Tabs: Call and Calls. "Next policy" walks the list in its own order (to call,
 * with a phone first). Same gate as the campaign view; opening it writes nothing.
 */
const TONE: Record<CampaignState, StatusTone> = { remaining: "action", in_progress: "info", converted: "good", declined: "neutral", no_bank_account: "neutral" };
const money = (cents: number | null) => (cents === null ? null : `$${Math.round(cents / 100).toLocaleString("en-US")}/mo`);
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
const callHref = (carrierId: string, policyNumber: string) => `/app/servicing/campaign/${carrierId}/${encodeURIComponent(policyNumber)}`;

export default async function PaperBillCallPage({ params, searchParams }: { params: Promise<{ carrierId: string; policyNumber: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [guard, { carrierId, policyNumber: raw }, query] = await Promise.all([guardPage("payment_repair"), params, searchParams]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Servicing" description="Changes asked of the carrier, tracked until the next carrier file proves them." />;
  if (!actAsPage(guard, ["owner", "producer", "retention"])) return <RoleGateNotice featureLabel="Servicing" detail="Only owners, producers and retention reps can open servicing requests." />;
  const policyNumber = decodeURIComponent(raw);
  if (!isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 120) notFound();
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const loaded = await loadCampaignPolicy(viewer, carrierId, policyNumber);
  if (!loaded) notFound();
  const { campaign, row, position, next, calls } = loaded;
  const readOnly = guard.entitlement.access === "read_only";
  const tab = query.tab === "calls" ? "calls" : "call";
  const name = row.clientName ? personName(row.clientName) : "No client linked";
  const base = callHref(carrierId, policyNumber);
  const facts = [row.phone ? phoneText(row.phone) : "No phone", `${row.carrierName} ${row.policyNumber}`, money(row.monthlyCents), row.history, `${position.toLocaleString("en-US")} of ${campaign.rows.length.toLocaleString("en-US")}`].filter(Boolean).join(" · ");

  return (
    <RetentionPage
      step="servicing"
      title={name}
      chip={<StatusChip tone={TONE[row.state]}>{STATE_LABELS[row.state]}</StatusChip>}
      facts={facts}
      breadcrumbs={retentionTrail("servicing", name, { label: "Paper bill → bank", href: "/app/servicing?view=campaign" })}
      tabs={<ViewTabs label={name} value={tab} tabs={[{ key: "call", label: "Call", href: base }, { key: "calls", label: "Calls", count: calls.length, href: `${base}?tab=calls` }]} />}
      actions={next ? <Button asChild variant="outline"><Link href={callHref(next.carrierId, next.policyNumber)}>Next policy ›</Link></Button> : undefined}
    >
      {tab === "calls" ? <PaperBillCalls calls={calls} /> : (
        <PaperBillCall carrierId={carrierId} policyNumber={policyNumber} state={row.state} talkTrack={campaign.talkTrack} cooloffDays={campaign.cooloffDays} nextHref={next ? callHref(next.carrierId, next.policyNumber) : null} readOnly={readOnly} />
      )}
    </RetentionPage>
  );
}
