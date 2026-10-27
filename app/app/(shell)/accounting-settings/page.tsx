import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { listAccounts } from "@/lib/accounting/bankStore";
import { LOCKED, loadAccountingSettings, recentChanges, SettingsError } from "@/lib/accounting/settingsStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingSettingsBoard } from "@/components/app/accounting/accounting-settings-board";
import { SettingsSectionHeader, SettingsSectionProvider } from "@/components/app/settings/primitives";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { SettingsPageFrame } from "@/components/app/settings/settings-page-frame";
import { SETTINGS_SECTIONS } from "@/lib/settings/sections";
import { visibleSections } from "@/lib/settings/registry";
import { effectiveFeatures } from "@/lib/features/killSwitch";

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
  const granted = await effectiveFeatures(guard.entitlement.features, tenantId);
  const settingsSections = visibleSections(SETTINGS_SECTIONS, granted, guard.role);
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
    <SettingsPageFrame sections={settingsSections} activeId="accounting">
      {/* LA-8.8: who last changed a setting here, beside the values — the owner reads the log it links into. */}
      <SettingsSectionProvider value={{ title: "Accounting settings", description: "Thresholds, categories, periods and split rules.", id: "accounting", history: guard.role === "owner" }}>
        <SettingsSectionHeader />
      </SettingsSectionProvider>
      {loaded ? (
        <AccountingSettingsBoard initial={loaded.settings} locked={LOCKED} changes={loaded.changes} accounts={loaded.accounts} canEdit={guard.role === "owner" && guard.entitlement.access !== "read_only"} />
      ) : (
        <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
      )}
    </SettingsPageFrame>
  );
}
