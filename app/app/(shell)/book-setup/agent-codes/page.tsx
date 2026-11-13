import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { AgentCodes, AgentCodesActions, type AgentCodesShow } from "@/components/app/book/setup/agent-codes";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { loadMatching, MATCHING_PENDING_MESSAGE } from "@/lib/ingestion/policyMatchingStore";

// Written here, not imported from the client screen: a server page reads a client module's constant as a reference.
const AGENT_CODES_HREF = "/app/book-setup/agent-codes";

/**
 * Book of business › Setup › Agent codes (owner 2026-11-02, round 2): who each carrier's writing-agent
 * code credits. The same data and actions as Policy matching › Agent codes, which keeps working at
 * /app/policy-matching?tab=agents. Opening it writes nothing.
 *
 * Round 7, direction A (docs/la4/mockups-r7/carrier-sync-setup.html, board 3·A): To map · Mapped · All are the
 * title line's tabs, each its own address (?show=); Add agent code and Map one by one are its buttons. It opens on
 * the codes to map when there are any.
 */
export default async function SetupAgentCodesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Agent codes" description="Rates, carrier terms and card-move rules for your book." />;
  // Owner and bookkeeper, like every Setup tab and its API.
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Agent codes" detail="Setup is for the account owner and bookkeepers." />;
  const [view, { show: asked }] = await Promise.all([loadMatching(guard.context.tenantId), searchParams]);
  const readOnly = guard.entitlement.access === "read_only";
  const info = <InfoTip label="About agent codes" side="right">The writing-agent code a carrier prints on each policy, and the person in your agency it belongs to. A code nobody owns leaves its policies unassigned: no producer gets the credit, and their commissions can&apos;t be split. Open a code on <b>To map</b> to choose its person, or press <b>Map one by one</b>.</InfoTip>;

  if (!view.available) {
    // Board 3·2: the pending state sits inside the card, never a callout.
    return (
      <DataInPage step="agent-codes" chip={info}>
        <TableCard><EmptyState title={MATCHING_PENDING_MESSAGE} hint="Agent codes open here once it is applied." /></TableCard>
      </DataInPage>
    );
  }

  const show: AgentCodesShow = asked === "unmapped" || asked === "mapped" || asked === "all" ? asked : view.unmapped.length ? "unmapped" : "all";
  const tabs = (
    <ViewTabs<AgentCodesShow>
      label="Agent codes"
      value={show}
      tabs={[
        { key: "unmapped", label: "To map", count: view.unmapped.length, tone: "danger", href: `${AGENT_CODES_HREF}?show=unmapped` },
        { key: "mapped", label: "Mapped", count: view.mapped.length, href: `${AGENT_CODES_HREF}?show=mapped` },
        { key: "all", label: "All", count: view.unmapped.length + view.mapped.length, href: `${AGENT_CODES_HREF}?show=all` },
      ]}
    />
  );

  return (
    <DataInPage step="agent-codes" chip={info} tabs={tabs} actions={<AgentCodesActions unmapped={view.unmapped} members={view.members} carriers={view.carriers} readOnly={readOnly} />}>
      <AgentCodes unmapped={view.unmapped} mapped={view.mapped} members={view.members} carriers={view.carriers} readOnly={readOnly} show={show} />
    </DataInPage>
  );
}
