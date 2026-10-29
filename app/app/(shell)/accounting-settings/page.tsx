import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { listAccounts } from "@/lib/accounting/bankStore";
import { LOCKED, loadAccountingSettings, recentChanges, SettingsError } from "@/lib/accounting/settingsStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingSettingsBoard } from "@/components/app/accounting/accounting-settings-board";
import { SettingsRouteFrame } from "@/components/app/settings/settings-route-frame";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Money › Accounting settings (LA-7.9, Notion sprint). Everything LA-7 reads, in one place.
 * Owners change it; bookkeepers can read it.
 */
export default async function AccountingSettingsPage() {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Accounting settings" description="Thresholds, categories, periods and split rules." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Accounting settings" detail="Only owners and bookkeepers can see the agency's accounting settings." />;
  }
  const tenantId = guard.context.tenantId;
  let loaded: { settings: Awaited<ReturnType<typeof loadAccountingSettings>>; changes: Awaited<ReturnType<typeof recentChanges>>; accounts: Awaited<ReturnType<typeof listAccounts>> } | null = null;
  let problem: string | null = null;
  try {
    const [settings, changes, accounts] = await Promise.all([loadAccountingSettings(tenantId), recentChanges(tenantId), listAccounts(tenantId).catch(() => [])]);
    loaded = { settings, changes, accounts };
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    problem = error.message;
  }
  return (
    // The one Settings layout: header, breadcrumb and menu come from the frame (settings-shell plan,
    // Task 6); this page keeps its gates above and draws only its board.
    <SettingsRouteFrame sectionId="accounting">
      <div className="flex min-h-0 flex-grow flex-col gap-4">
      {loaded ? (
        <AccountingSettingsBoard initial={loaded.settings} locked={LOCKED} changes={loaded.changes} accounts={loaded.accounts} canEdit={guard.role === "owner" && guard.entitlement.access !== "read_only"} />
      ) : (
        <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
      )}
      </div>
    </SettingsRouteFrame>
  );
}
