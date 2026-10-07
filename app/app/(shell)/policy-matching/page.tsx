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
            <StatTile label="Waiting for a person" value={view.reviews.length.toLocaleString("en-US")} valueTone={view.reviews.length ? "warning" : undefined} footnote="no policy number we hold" />
            <StatTile label="Linked by number" value={pct(view.ladder.exactLinkedPct)} footnote={`of ${view.ladder.all.toLocaleString("en-US")} policies, last 30 days`} />
            <StatTile label="Needed review" value={pct(view.ladder.toReviewPct)} footnote="high means numbers aren't captured at submission" />
            <StatTile label="AI accuracy, 7 days" value={pct(view.aiAccuracy.pct)} footnote={view.aiAccuracy.reviewed ? `${view.aiAccuracy.correct} of ${view.aiAccuracy.reviewed} confirmed` : "AI review isn't configured"} />
            <StatTile label="Agent codes unmapped" value={view.unmapped.length.toLocaleString("en-US")} valueTone={view.unmapped.length ? "warning" : undefined} footnote="mapped exactly, never guessed" />
          </StatStrip>
          <PolicyMatchingWorkspace reviews={view.reviews} links={view.links} unmapped={view.unmapped} mapped={view.mapped} members={view.members} readOnly={guard.entitlement.access === "read_only"} aiNote={AI_REVIEW_PENDING} />
        </>
      )}
    </div>
  );
}
