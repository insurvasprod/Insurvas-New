import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { getRulebook, PayoutError } from "@/lib/accounting/payoutStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { RulebookForm } from "@/components/app/accounting/partner-ledger-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Accounting › Partner payouts › a partner's payout rulebook (owner, 2026-11-06), a form page: 1 how they
 * win (Model A, a flat rate once an application is submitted; Model B, a share of the commission on an
 * issued policy), 2 how much, 3 when they are paid and who carries chargebacks, 4 who gets the money. The
 * price becomes a new effective-dated term, so what was earned before keeps its old price. Owner and
 * bookkeeper; read-only plans see it, not change it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PartnerRulebookPage({ params }: { params: Promise<{ partnerId: string }> }) {
  const guard = await guardPage("payout_runs");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner payouts" description="What each partner is owed, from the ledger." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Partner payouts" detail="Only owners and bookkeepers can see what partners are paid." />;
  const { partnerId } = await params;
  if (!UUID.test(partnerId)) notFound();
  let rulebook: Awaited<ReturnType<typeof getRulebook>> | null = null;
  let problem: string | null = null;
  try {
    rulebook = await getRulebook(guard.context.tenantId, partnerId);
  } catch (error) {
    if (!(error instanceof PayoutError)) throw error;
    if (error.status === 404) notFound();
    problem = error.message;
  }
  return (
    <AccountingPage
      step="payouts"
      title={rulebook ? `${rulebook.partnerName} · payout rulebook` : "Payout rulebook"}
      info="How this partner is paid. A new price starts on the day you choose; everything earned before it keeps the old price. The pay schedule decides when Run payouts makes this partner's next invoice."
    >
      {rulebook ? <RulebookForm rulebook={rulebook} readOnly={guard.entitlement.access === "read_only"} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </AccountingPage>
  );
}
