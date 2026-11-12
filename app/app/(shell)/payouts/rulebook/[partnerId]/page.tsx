import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { getRulebook, listRulebooks, PayoutError } from "@/lib/accounting/payoutStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { RulebookForm } from "@/components/app/accounting/partner-ledger-board";
import { RULEBOOK_SLOT } from "@/components/app/commissions/splits/slots";
import { NeighbourNav } from "@/components/app/commissions/team-payouts/shared";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Commissions › Partner payouts › a partner's payout rulebook (round 7, 9·2, owner 2026-11-10), its own page: 1 how
 * they win (Model A, a flat rate once an application is submitted; Model B, a share of the commission on an issued
 * policy), 2 how much, 3 when they are paid and who carries chargebacks, 4 who gets the money. Discard · Save
 * rulebook on the title line; ‹ › name the partners either side in the Rulebooks list. The price becomes a new
 * effective-dated term, so what was earned before keeps its old price. The leave guard stays.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PartnerRulebookPage({ params }: { params: Promise<{ partnerId: string }> }) {
  const guard = await guardPage("payout_runs");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner payouts" description="What each partner is owed, from the ledger." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Partner payouts" detail="Only owners and bookkeepers can see what partners are paid." />;
  const { partnerId } = await params;
  if (!UUID.test(partnerId)) notFound();
  const tenantId = guard.context.tenantId;
  let rulebook: Awaited<ReturnType<typeof getRulebook>> | null = null;
  let list: Awaited<ReturnType<typeof listRulebooks>> = [];
  try {
    [rulebook, list] = await Promise.all([getRulebook(tenantId, partnerId), listRulebooks(tenantId).catch(() => [])]);
  } catch (error) {
    if (!(error instanceof PayoutError)) throw error;
    if (error.status === 404) notFound();
  }
  const at = list.findIndex((r) => r.partnerId === partnerId);
  const link = (r: (typeof list)[number] | undefined) => (r ? { href: `/app/payouts/rulebook/${r.partnerId}`, label: r.partnerName } : null);
  const name = rulebook?.partnerName ?? "Payout rulebook";
  return (
    <CommissionsPage
      step="partnerPayouts"
      title={rulebook ? `${rulebook.partnerName} · payout rulebook` : "Payout rulebook"}
      info="How this partner is paid. A new price starts on the day you choose; everything earned before it keeps the old price. The pay schedule decides when Run payouts makes this partner's next invoice."
      breadcrumbs={[{ label: "Commissions" }, { label: "Partner payouts", href: "/app/payouts" }, { label: "Rulebooks", href: "/app/payouts?view=rulebooks" }, { label: name }]}
      actions={rulebook ? <span className="inline-flex flex-wrap items-center gap-2"><NeighbourNav previous={at > 0 ? link(list[at - 1]) : null} next={at >= 0 ? link(list[at + 1]) : null} noun="partner" /><StepSlotTarget id={RULEBOOK_SLOT} /></span> : undefined}
    >
      {rulebook ? <RulebookForm rulebook={rulebook} readOnly={guard.entitlement.access === "read_only"} /> : <TableCard><EmptyState title="Partner payouts aren't switched on for this agency yet." hint="Rulebooks appear here once they are." /></TableCard>}
    </CommissionsPage>
  );
}
