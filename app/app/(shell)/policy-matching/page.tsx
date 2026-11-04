import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PolicyMatchingWorkspace, type PolicyMatchingTab } from "@/components/app/policy-matching-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { Callout } from "@/components/app/settings/primitives";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { ViewTabs } from "@/components/ui/view-tabs";
import { scopeFor } from "@/lib/agency/visibility";
import { AI_REVIEW_PENDING, loadMatching, MATCHING_PENDING_MESSAGE } from "@/lib/ingestion/policyMatchingStore";

/**
 * Book of Business › Policy matching (LA-4.8, Notion sprint): which client and which agent each
 * carrier policy belongs to, and how each link was made. Owner and bookkeeper. Opening it writes
 * nothing.
 */
export default async function PolicyMatchingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Policy matching" description="Link every carrier policy to the right client and agent." />;
  if (!actAsPagePermission(guard, "statements.view")) return <RoleGateNotice featureLabel="Policy matching" detail="Policy matching is done by the account owner or a bookkeeper." />;

  // AG-0.5: as Needs you — these links and codes reach across producers' books, so a narrow agency session is refused.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Policy matching" detail="In an agency, the owner, admins and the bookkeeper make these decisions." />;

  const view = await loadMatching(guard.context.tenantId);
  // ?tab=agents opens the agent codes (a policy whose agent code is not mapped links here).
  const { tab: asked } = await searchParams;
  const tab: PolicyMatchingTab = asked === "agents" || asked === "links" ? asked : "review";
  const pct = (value: number | null) => (value === null ? "—" : `${value}%`);
  // The views on the title line (UI-CONSISTENCY §8a), each its own address.
  const tabs = view.available ? (
    <ViewTabs<PolicyMatchingTab>
      label="Policy matching views"
      value={tab}
      controls="policy-matching-panel"
      tabs={[
        { key: "review", label: "To review", count: view.reviews.length, href: "/app/policy-matching" },
        { key: "links", label: "Links", count: view.links.length, href: "/app/policy-matching?tab=links" },
        { key: "agents", label: "Agent codes", count: view.unmapped.length, href: "/app/policy-matching?tab=agents" },
      ]}
    />
  ) : undefined;

  return (
    <DataInPage step="needs-you" title="Policy matching" lead={tabs}>
      {!view.available ? (
        // §3: a blocked state raises a bell alert, never a box on the page.
        <Callout tone="warning" title={MATCHING_PENDING_MESSAGE} />
      ) : (
        <>
          <StatStrip label="Policy matching totals">
            <StatTile label="Waiting for you" value={view.reviews.length.toLocaleString("en-US")} valueTone={view.reviews.length ? "warning" : undefined} footnote="pick the right client" />
            {/* LA-4.8: the share of rows resolving at each ladder step, 30 days of files. */}
            <StatTile label="Already linked" value={pct(view.ladder.alreadyLinkedPct)} footnote={`of ${view.ladder.all.toLocaleString("en-US")} policy rows read, 30 days`} />
            <StatTile label="Linked by number" value={pct(view.ladder.exactLinkedPct)} footnote="the sale's policy number" />
            <StatTile label="Matched by search" value={pct(view.ladder.toReviewPct)} footnote="no number: a review or no sale on record" />
            {view.aiAccuracy.reviewed > 0 && <StatTile label="Automatic match accuracy, 7 days" value={pct(view.aiAccuracy.pct)} footnote={`${view.aiAccuracy.correct} of ${view.aiAccuracy.reviewed} confirmed`} />}
            <StatTile label="Agent codes to map" value={view.unmapped.length.toLocaleString("en-US")} valueTone={view.unmapped.length ? "warning" : undefined} footnote="so each policy credits the right agent" />
          </StatStrip>
          <PolicyMatchingWorkspace reviews={view.reviews} links={view.links} unmapped={view.unmapped} mapped={view.mapped} members={view.members} carriers={view.carriers} readOnly={guard.entitlement.access === "read_only"} aiNote={AI_REVIEW_PENDING} tab={tab} />
        </>
      )}
    </DataInPage>
  );
}
