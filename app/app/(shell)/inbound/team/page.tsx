import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AgentFloor } from "@/components/app/agent-floor";
import { TransferInbox } from "@/components/app/transfer-inbox";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";

/**
 * Team (Inbound A, owner 2026-10-27; was the Agent Floor at /app/floor, which forwards here). Now:
 * what needs you first, the people, the calls and the callbacks due. All callers (?tab=all): every
 * transfer today with its filters, Today by partner and lost-transfer recovery (was /app/inbound).
 * The same people as before: owners, agents (managers act as agents) and screeners.
 */
export default async function InboundTeamPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const guard = await guardPage("inbound_transfers");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Inbound team" description="Who is taking calls, who is on one, and what needs you first." />;
  if (!actAsPage(guard, ["owner", "producer", "assistant"])) return <RoleGateNotice featureLabel="Inbound team" detail="Inbound callers are taken by owners, agents and screeners. Ask your owner if you should be one." />;
  const readOnly = guard.entitlement.status === "suspended" || guard.entitlement.status === "paused";
  const [{ tab }, solo] = await Promise.all([searchParams, isSoloWorkspace(guard.context.tenantId)]);
  // Solo mode (owner 2026-10-29): there is no team to watch. All callers (every transfer today, recovery)
  // is the workspace's own history, so it stays; Inbound links to it in place of Team.
  if (solo && tab !== "all") return <RoleGateNotice reason="solo" featureLabel="Inbound team" detail="You work alone, so every caller comes straight to you on Inbound." action={{ href: "/app/inbound", label: "Open Inbound" }} />;
  return (
    <>
      {tab === "all"
        ? <TransferInbox readOnly={readOnly} role={guard.role} />
        : <AgentFloor currentUserId={guard.context.userId} role={guard.role} readOnly={readOnly} />}
    </>
  );
}
