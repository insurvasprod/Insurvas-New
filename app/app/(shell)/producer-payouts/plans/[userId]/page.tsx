import { Suspense } from "react";
import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { listTeamPlans } from "@/lib/agency/payPlanStore";
import { isRecordId } from "@/lib/ledger/statementConstants";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { PayPlanForm } from "@/components/app/agency/pay-plans";
import { PRODUCER_PAYOUTS_SLOT } from "@/components/app/agency/slots";
import { NeighbourNav } from "@/components/app/commissions/team-payouts/shared";
import { StreamSection, TitleShape } from "@/components/ui/stream-section";
import { Part, startParts } from "@/components/app/commissions/frame-parts";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Commissions › Team payouts › Pay plans › one person (round 7, 6·1, owner 2026-11-10): the plan form, an own page.
 * Discard · Save plan on the title line (the form fills the slot); ‹ › name the team members either side in the
 * Pay plans list's order.
 */
export default async function PayPlanPage({ params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Team payouts" description="Pay your team for the month." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Team payouts" detail="The owner, admins and the bookkeeper set pay plans." />;
  const { userId } = await params;
  if (!isRecordId(userId)) notFound();
  // Frame first (§7a): the trail and the slot for Save draw at once; the person's name, the ‹ › and the plan's form
  // (one block, as a form fills in) stream in.
  const read = startParts((async () => {
    const { team, pending } = await listTeamPlans(guard.context.tenantId);
    const at = team.findIndex((m) => m.userId === userId);
    if (at < 0) notFound();
    const member = team[at];
    const link = (m: (typeof team)[number] | undefined) => (m ? { href: `/app/producer-payouts/plans/${m.userId}`, label: m.name } : null);
    return {
      title: `${member.name} · pay plan`,
      actions: <NeighbourNav previous={link(team[at - 1])} next={link(team[at + 1])} noun="team member" />,
      body: pending ? <TableCard><EmptyState title="Pay plans are not switched on yet" hint="Until then everyone is paid by their contract level, as before." /></TableCard> : <PayPlanForm member={member} readOnly={guard.entitlement.access === "read_only"} />,
    };
  })());
  return (
    <CommissionsPage
      step="teamPayouts"
      title={<Suspense fallback={<TitleShape />}><Part read={read} part="title" /></Suspense>}
      info="How this person is paid. A change applies from the date you choose; months already paid keep their plan."
      breadcrumbs={[{ label: "Commissions" }, { label: "Team payouts", href: "/app/producer-payouts" }, { label: "Pay plans", href: "/app/producer-payouts?tab=plans" }, { label: "Pay plan" }]}
      actions={<span className="inline-flex flex-wrap items-center gap-2"><Suspense fallback={null}><Part read={read} part="actions" /></Suspense><StepSlotTarget id={PRODUCER_PAYOUTS_SLOT} /></span>}
    >
      <StreamSection shape="form"><Part read={read} part="body" /></StreamSection>
    </CommissionsPage>
  );
}
