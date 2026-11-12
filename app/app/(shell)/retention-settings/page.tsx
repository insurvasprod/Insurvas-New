import { guardPage } from "@/lib/entitlements/guardPage";
import { OPEN_STATUSES, REASONS, type Reason } from "@/lib/retention/cases/ladder";
import { loadFlaggedWords, loadLadderRules } from "@/lib/retention/cases/rulesStore";
import { HubError, loadHub, type Hub } from "@/lib/retention/settingsHubStore";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionSettingsBoard, type Tab } from "@/components/app/retention/retention-settings-board";
import { SettingsRouteFrame } from "@/components/app/settings/settings-route-frame";

/** The tabs in the address (kept here: a client module's functions cannot run on the server). */
const TABS: readonly Tab[] = ["ladder", "who", "requests", "winback", "radar"];
const isTab = (value: string | undefined): value is Tab => (TABS as readonly string[]).includes(value ?? "");

/**
 * Settings › Retention (LA-5.11, Notion sprint; round 7, owner pick 7·A, 2026-11-10). Every number the ladder, the
 * radar and the campaigns read, in one place, with an audit trail, as five tabs (?tab=): Ladder · Who works it ·
 * Requests · Win-back · Radar. Carrier windows are Insurvas's, never edited here. Owner only.
 */
export default async function RetentionSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [guard, query] = await Promise.all([guardPage("chargeback_radar"), searchParams]);
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Retention settings" description="The ladder, who works retention, cooling-off periods, the radar and the holdout." />;
  }
  if (guard.role !== "owner") {
    return <RoleGateNotice featureLabel="Retention settings" detail="Only the owner changes what puts a policy on the ladder and who works retention." />;
  }
  const tenantId = guard.context.tenantId;
  const hubRead = loadHub(tenantId).then(
    (hub) => ({ hub, problem: null as string | null }),
    (error: unknown) => {
      if (!(error instanceof HubError)) throw error;
      return { hub: null as Hub | null, problem: error.message };
    },
  );
  const [{ hub, problem }, ladder, words, openByReason] = await Promise.all([hubRead, loadLadderRules(tenantId), loadFlaggedWords(tenantId), openCasesByReason(tenantId)]);
  return (
    <SettingsRouteFrame sectionId="retention">
      <RetentionSettingsBoard hub={hub} hubProblem={problem} ladder={ladder} words={words} openByReason={openByReason} canEdit={guard.entitlement.access !== "read_only"} initialTab={isTab(query.tab) ? query.tab : "ladder"} />
    </SettingsRouteFrame>
  );
}

/**
 * The Ladder tab's "Open now": open cases per reason, one head count each (no rows read; retention_case_list_idx
 * narrows to the tenant's open cases). Null when the cases cannot be counted, and the column says "—".
 */
async function openCasesByReason(tenantId: string): Promise<Partial<Record<Reason, number>> | null> {
  try {
    // retention_case is not in the generated types yet; the cases store reads it untyped too.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getSupabaseServiceClient() as any;
    const counts = await Promise.all(REASONS.map(async (reason) => {
      const { count, error } = await db.from("retention_case").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("status", [...OPEN_STATUSES]).eq("reason", reason);
      if (error) throw error;
      return [reason, count ?? 0] as const;
    }));
    return Object.fromEntries(counts);
  } catch (error) {
    console.error("[retention-settings] open cases by reason", error);
    return null;
  }
}
