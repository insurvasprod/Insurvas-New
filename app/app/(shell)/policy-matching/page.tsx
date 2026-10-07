import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PolicyMatchingWorkspace } from "@/components/app/policy-matching-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { AI_REVIEW_PENDING, loadMatching, MATCHING_PENDING_MESSAGE } from "@/lib/ingestion/policyMatchingStore";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › Policy matching (LA-4.8, Notion sprint): which client and which agent each
 * carrier policy belongs to, and how each link was made. Owner and bookkeeper. Opening it writes
 * nothing.
 */
export default async function PolicyMatchingPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Policy matching" description="Link every carrier policy to the right client and agent." />;
  if (!hasTenantPermission(guard.role, "statements.view")) return <RoleGateNotice featureLabel="Policy matching" detail="Policy matching is done by the account owner or a bookkeeper." />;

  const view = await loadMatching(guard.context.tenantId);
  const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title="Policy matching" description="Which client and agent each carrier policy belongs to." />
      {!view.available ? (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{MATCHING_PENDING_MESSAGE}</div>
      ) : (
        <>
          <StatStrip label="Policy matching totals">
            <StatTile label="Waiting for you" value={view.reviews.length.toLocaleString("en-US")} valueTone={view.reviews.length ? "warning" : undefined} footnote="pick the right client" />
            <StatTile label="Linked automatically" value={view.ladder.all ? pct(Math.round((100 - (view.ladder.toReviewPct ?? 0)) * 10) / 10) : "—"} footnote={`of ${view.ladder.all.toLocaleString("en-US")} policy rows read, 30 days`} />
            <StatTile label="Sent to review" value={pct(view.ladder.toReviewPct)} footnote="lower when numbers are saved at the sale" />
            {view.aiAccuracy.reviewed > 0 && <StatTile label="AI accuracy, 7 days" value={pct(view.aiAccuracy.pct)} footnote={`${view.aiAccuracy.correct} of ${view.aiAccuracy.reviewed} confirmed`} />}
            <StatTile label="Agent codes to map" value={view.unmapped.length.toLocaleString("en-US")} valueTone={view.unmapped.length ? "warning" : undefined} footnote="so each policy credits the right agent" />
          </StatStrip>
          <PolicyMatchingWorkspace reviews={view.reviews} links={view.links} unmapped={view.unmapped} mapped={view.mapped} members={view.members} readOnly={guard.entitlement.access === "read_only"} aiNote={AI_REVIEW_PENDING} />
        </>
      )}
    </div>
  );
}
