import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ProducerActions, ProducerDetail, type ProducerTab } from "@/components/app/agency/producer-detail";
import { AgencyPage } from "@/components/app/agency/agency-page";
import { StatusChip } from "@/components/ui/status-chip";
import { ViewTabs } from "@/components/ui/view-tabs";
import { hasFeature } from "@/lib/entitlements/types";
import { PRODUCER_STATUS_LABELS } from "@/lib/agency/constants";
import { readProducerHeader } from "@/lib/agency/producerHeader";
import { MEMBER_ROLE_LABELS, type MemberRole } from "@/lib/tenantAuth/roles";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { NeighbourLinks, type Neighbour } from "@/components/app/commissions/producer-pay/neighbour-links";
import { ReviewButton } from "@/components/app/commissions/producer-pay/review-dialog";
import { parsePeriod, periodOptions, producerPayHref } from "@/components/app/commissions/producer-pay/period";
import type { MoneyView } from "@/components/app/commissions/producer-pay/money-core";
import { readOpenReviews } from "@/lib/agency/moneyStores";
import { readRoster } from "@/lib/agency/producerStore";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TONE = { invited: "neutral", onboarding: "info", active: "good", suspended: "warning", offboarded: "neutral" } as const;

/**
 * AG-1.1 · one producer's record, Agency › Producers › a producer (Home › Agency, 2026-11-03). The header is
 * read on the server with the record API's own visibility (a producer opens only his own; a manager his reports'):
 * the name, the status chip, one line of facts, at most two buttons and More, and the tabs on the title line
 * (`?tab=overview|carriers|onboarding|money`; Producer pay links to Money). The old `?tab=production` lands on
 * Overview, its two links are in More.
 */
export default async function ProducerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; from?: string; period?: string; chip?: string }> }) {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producers" description="Everyone who writes business under your contracts." />;
  if (!actAsPage(guard, ["owner", "bookkeeper", "producer"])) return <RoleGateNotice featureLabel="Producers" detail="The owner, admins, managers, producers and the bookkeeper open producer records." />;
  const [{ id }, { tab: asked, from, period: askedPeriod, chip }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const producer = await readProducerHeader(guard.context, id);
  if (!producer) notFound();

  const isManager = guard.context.memberRole === "manager";
  const showMoney = hasFeature(guard.entitlement, "producer_payouts") && !(isManager && !producer.isSelf);
  const blocked = !producer.canSubmit && producer.status !== "offboarded" && producer.status !== "invited";
  const base = `/app/producers/${id}`;
  // Round 7 (mockups-r7/commissions.html 4·1): opened from Commissions › Producer pay, the record stays in the
  // Commissions frame for that month, every tab keeps it, and ‹ › walk Producer pay's list.
  const fromPay = from === "reconciliation" && showMoney;
  const period = parsePeriod(askedPeriod);
  const carry = fromPay ? `from=reconciliation&period=${period}` : "";
  const withCarry = (query: string) => (query || carry ? `${base}?${[query, carry].filter(Boolean).join("&")}` : base);
  const tabs: Array<{ key: ProducerTab; label: string; href: string; tone?: "danger" }> = [
    { key: "overview", label: "Overview", href: withCarry("") },
    { key: "carriers", label: "Carriers", href: withCarry("tab=carriers") },
    { key: "onboarding", label: "Onboarding", href: withCarry("tab=onboarding"), ...(blocked ? { tone: "danger" as const } : {}) },
    ...(showMoney ? [{ key: "money" as const, label: "Money", href: withCarry("tab=money") }] : []),
  ];
  const tab: ProducerTab = tabs.find((t) => t.key === asked)?.key ?? "overview";
  const role = producer.role ? MEMBER_ROLE_LABELS[producer.role as MemberRole] ?? producer.role : "Producer";
  const facts = [
    role,
    `reports to ${producer.managerName === "Owner" ? "the owner" : producer.managerName}`,
    producer.status === "offboarded" && producer.offboardedOn ? `offboarded ${producer.offboardedOn}` : producer.hiredOn ? `hired ${producer.hiredOn}` : null,
  ].filter(Boolean).join(" · ");

  // The Money tab: ‹ › name the neighbouring producers (by name, as Producer pay and the roster list them), and the
  // open review is the primary. Only for the people who see everyone's pay; a producer has no neighbours to walk.
  const keeper = guard.role === "owner" || guard.role === "bookkeeper";
  const onMoney = tab === "money" && showMoney;
  const [roster, reviews] = onMoney && keeper
    ? await Promise.all([readRoster(guard.context).catch(() => null), readOpenReviews(guard.context.tenantId, producer.userId).catch(() => [])])
    : [null, []];
  const ordered = (roster?.rows ?? []).filter((p) => p.status !== "invited").sort((a, b) => a.displayName.localeCompare(b.displayName));
  const at = ordered.findIndex((p) => p.id === id);
  const neighbour = (p: (typeof ordered)[number] | undefined): Neighbour => (p ? { name: p.displayName, href: fromPay ? producerPayHref(p.id, period) : `/app/producers/${p.id}?tab=money` } : null);
  const review = reviews.find((r) => fromPay && r.periodStart.startsWith(period)) ?? reviews[0] ?? null;
  const readOnly = guard.entitlement.access === "read_only";
  const actions = (
    <>
      {onMoney && at >= 0 && ordered.length > 1 && <NeighbourLinks previous={neighbour(ordered[at - 1])} next={neighbour(ordered[at + 1])} noun="producer" />}
      {onMoney && review && <ReviewButton review={review} name={producer.displayName} readOnly={readOnly} />}
      <ProducerActions producer={producer} canManage={guard.role === "owner" && !readOnly} scorecards={hasFeature(guard.entitlement, "producer_scorecards")} />
    </>
  );
  const moneyView: MoneyView = chip === "statements" || chip === "chargebacks" ? chip : "ledger";
  const detail = (
    <ProducerDetail
      producerId={id}
      tab={tab}
      viewer={{ isOwner: guard.role === "owner", isManager, isBookkeeper: guard.role === "bookkeeper", canSeeMoney: showMoney }}
      money={{ name: producer.displayName, initialView: moneyView, initialSelection: fromPay || askedPeriod ? period : "all", months: periodOptions() }}
    />
  );

  if (fromPay) {
    return (
      <CommissionsPage
        step="reconciliation"
        title={producer.displayName}
        breadcrumbs={[{ label: "Commissions" }, { label: "Producer pay", href: `/app/producer-reconciliation?period=${period}` }, { label: producer.displayName }]}
        tabs={<ViewTabs label="Producer" value={tab} tabs={tabs} />}
        actions={actions}
      >
        {detail}
      </CommissionsPage>
    );
  }

  return (
    <AgencyPage
      step="producers"
      title={producer.displayName}
      chip={<StatusChip tone={TONE[producer.status]}>{PRODUCER_STATUS_LABELS[producer.status]}</StatusChip>}
      facts={facts}
      tabs={<ViewTabs label="Producer" value={tab} tabs={tabs} />}
      actions={actions}
    >
      {detail}
    </AgencyPage>
  );
}
