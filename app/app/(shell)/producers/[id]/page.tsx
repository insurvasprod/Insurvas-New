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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TONE = { invited: "neutral", onboarding: "info", active: "good", suspended: "warning", offboarded: "neutral" } as const;

/**
 * AG-1.1 · one producer's record, Agency › Producers › a producer (Home › Agency, 2026-11-03). The header is
 * read on the server with the record API's own visibility (a producer opens only his own; a manager his reports'):
 * the name, the status chip, one line of facts, at most two buttons and More, and the tabs on the title line
 * (`?tab=overview|carriers|onboarding|money`; Producer pay links to Money). The old `?tab=production` lands on
 * Overview, its two links are in More.
 */
export default async function ProducerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producers" description="Everyone who writes business under your contracts." />;
  if (!actAsPage(guard, ["owner", "bookkeeper", "producer"])) return <RoleGateNotice featureLabel="Producers" detail="The owner, admins, managers, producers and the bookkeeper open producer records." />;
  const [{ id }, { tab: asked }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const producer = await readProducerHeader(guard.context, id);
  if (!producer) notFound();

  const isManager = guard.context.memberRole === "manager";
  const showMoney = hasFeature(guard.entitlement, "producer_payouts") && !(isManager && !producer.isSelf);
  const blocked = !producer.canSubmit && producer.status !== "offboarded" && producer.status !== "invited";
  const base = `/app/producers/${id}`;
  const tabs: Array<{ key: ProducerTab; label: string; href: string; tone?: "danger" }> = [
    { key: "overview", label: "Overview", href: base },
    { key: "carriers", label: "Carriers", href: `${base}?tab=carriers` },
    { key: "onboarding", label: "Onboarding", href: `${base}?tab=onboarding`, ...(blocked ? { tone: "danger" as const } : {}) },
    ...(showMoney ? [{ key: "money" as const, label: "Money", href: `${base}?tab=money` }] : []),
  ];
  const tab: ProducerTab = tabs.find((t) => t.key === asked)?.key ?? "overview";
  const role = producer.role ? MEMBER_ROLE_LABELS[producer.role as MemberRole] ?? producer.role : "Producer";
  const facts = [
    role,
    `reports to ${producer.managerName === "Owner" ? "the owner" : producer.managerName}`,
    producer.status === "offboarded" && producer.offboardedOn ? `offboarded ${producer.offboardedOn}` : producer.hiredOn ? `hired ${producer.hiredOn}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <AgencyPage
      step="producers"
      title={producer.displayName}
      chip={<StatusChip tone={TONE[producer.status]}>{PRODUCER_STATUS_LABELS[producer.status]}</StatusChip>}
      facts={facts}
      lead={<ViewTabs label="Producer" value={tab} tabs={tabs} />}
      actions={<ProducerActions producer={producer} canManage={guard.role === "owner" && guard.entitlement.access !== "read_only"} scorecards={hasFeature(guard.entitlement, "producer_scorecards")} />}
    >
      <ProducerDetail
        producerId={id}
        tab={tab}
        viewer={{ isOwner: guard.role === "owner", isManager, isBookkeeper: guard.role === "bookkeeper", canSeeMoney: showMoney }}
      />
    </AgencyPage>
  );
}
