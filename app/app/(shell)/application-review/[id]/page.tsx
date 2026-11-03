import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ReviewRecord } from "@/components/app/agency/review-board";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AG-1.11 · one Application review, a page of its own (foundation pass 2026-11-03; it was a side panel). The API
 * scopes what can be read (a producer his own, a manager his reports'); only the owner, an admin or a manager
 * records an outcome.
 */
export default async function ApplicationReviewRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardPage("team_qa");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Application review" description="A sample of each producer's submitted paperwork, reviewed and coached." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Application review" detail="The owner, admins, managers and producers see application review." />;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <ReviewRecord reviewId={id} />;
}
