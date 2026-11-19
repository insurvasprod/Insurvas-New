import { Suspense } from "react";

import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
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
  // Frame first (UI-CONSISTENCY §7a): the title line, its tabs and Add agent code draw at once; the counts and the codes
  // stream in. Until they land the tabs have no counts, as on Needs you.
  const view = loadMatching(guard.context.tenantId);
  const { show: asked } = await searchParams;
  const readOnly = guard.entitlement.access === "read_only";
  const info = <InfoTip label="About agent codes" side="right">The writing-agent code a carrier prints on each policy, and the person in your agency it belongs to. A code nobody owns leaves its policies unassigned: no producer gets the credit, and their commissions can&apos;t be split. Open a code on <b>To map</b> to choose its person, or press <b>Map one by one</b>.</InfoTip>;
  const picked: AgentCodesShow | null = asked === "unmapped" || asked === "mapped" || asked === "all" ? asked : null;

  return (
    <DataInPage step="agent-codes"
      chip={info}
      tabs={<Suspense fallback={<Tabs show={picked ?? "unmapped"} />}><CountedTabs read={view} picked={picked} /></Suspense>}
      actions={<Suspense fallback={<AgentCodesActions unmapped={[]} members={[]} carriers={[]} readOnly />}><Actions read={view} readOnly={readOnly} /></Suspense>}
    >
      <StreamSection shape="table"><Codes read={view} picked={picked} readOnly={readOnly} /></StreamSection>
    </DataInPage>
  );
}

type View = ReturnType<typeof loadMatching>;
type Ready = Extract<Awaited<View>, { available: true }>;

/** No ?show: To map while any code is unmapped, else All. */
const showOf = (view: Ready, picked: AgentCodesShow | null): AgentCodesShow => picked ?? (view.unmapped.length ? "unmapped" : "all");

function Tabs({ show, view }: { show: AgentCodesShow; view?: Ready }) {
  return (
    <ViewTabs<AgentCodesShow>
      label="Agent codes"
      value={show}
      tabs={[
        { key: "unmapped", label: "To map", count: view ? view.unmapped.length : null, tone: "danger", href: `${AGENT_CODES_HREF}?show=unmapped` },
        { key: "mapped", label: "Mapped", count: view ? view.mapped.length : null, href: `${AGENT_CODES_HREF}?show=mapped` },
        { key: "all", label: "All", count: view ? view.unmapped.length + view.mapped.length : null, href: `${AGENT_CODES_HREF}?show=all` },
      ]}
    />
  );
}

async function CountedTabs({ read, picked }: { read: View; picked: AgentCodesShow | null }) {
  const view = await read;
  // Board 3·2: while the matching update is pending, no tabs (the card says so).
  if (!view.available) return null;
  return <Tabs show={showOf(view, picked)} view={view} />;
}

async function Actions({ read, readOnly }: { read: View; readOnly: boolean }) {
  const view = await read;
  if (!view.available) return null;
  return <AgentCodesActions unmapped={view.unmapped} members={view.members} carriers={view.carriers} readOnly={readOnly} />;
}

async function Codes({ read, picked, readOnly }: { read: View; picked: AgentCodesShow | null; readOnly: boolean }) {
  const view = await read;
  // Board 3·2: the pending state sits inside the card, never a callout.
  if (!view.available) return <TableCard><EmptyState title={MATCHING_PENDING_MESSAGE} hint="Agent codes open here once it is applied." /></TableCard>;
  return <AgentCodes unmapped={view.unmapped} mapped={view.mapped} members={view.members} carriers={view.carriers} readOnly={readOnly} show={showOf(view, picked)} />;
}
