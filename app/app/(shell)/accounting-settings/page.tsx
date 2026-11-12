import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { listAccounts } from "@/lib/accounting/bankStore";
import { LOCKED, loadAccountingSettings, recentChanges, SettingsError } from "@/lib/accounting/settingsStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingSettingsBoard, type Tab } from "@/components/app/accounting/accounting-settings-board";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { SettingsRouteFrame } from "@/components/app/settings/settings-route-frame";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Money › Accounting settings (LA-7.9, Notion sprint). Everything LA-7 reads, in one place.
 * Owners change it; bookkeepers can read it.
 */
export default async function AccountingSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [guard, query] = await Promise.all([guardPage("profit_and_loss"), searchParams]);
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Accounting settings" description="Thresholds, categories, periods and split rules." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Accounting settings" detail="Only owners and bookkeepers can see the agency's accounting settings." />;
  }
  const tenantId = guard.context.tenantId;
  // Started before the frame renders, so the Settings frame's own reads (loadSettingsFrame) run beside these rather
  // than after them (perf pass 2026-11-09). Settled here, decided in AccountingSettingsBody: the same board or notice.
  const loaded: Promise<Loaded> = Promise.all([loadAccountingSettings(tenantId), recentChanges(tenantId).then(withNames), listAccounts(tenantId).catch(() => [])])
    .then(([settings, changes, accounts]) => ({ ok: true as const, settings, changes, accounts }), (error: unknown) => ({ ok: false as const, error }));
  const initialTab = isTab(query.tab) ? query.tab : "books";
  return (
    // The one Settings layout: header, breadcrumb and menu come from the frame (settings-shell plan,
    // Task 6); this page keeps its gates above and draws only its board.
    <SettingsRouteFrame sectionId="accounting">
      <AccountingSettingsBody loaded={loaded} canEdit={guard.role === "owner" && guard.entitlement.access !== "read_only"} canSeeHistory={guard.role === "owner"} initialTab={initialTab} />
    </SettingsRouteFrame>
  );
}

/** The six tabs in the address (kept here: a client module's functions cannot run on the server). */
const TABS: readonly Tab[] = ["books", "bank", "bills", "payouts", "producers", "tax"];
const isTab = (value: string | undefined): value is Tab => (TABS as readonly string[]).includes(value ?? "");

type Changes = Awaited<ReturnType<typeof recentChanges>>;
/**
 * The Changed column's "who": each change's person by name (users.name, else their email). The ids come from this
 * agency's own change rows. A name that cannot be read leaves the column on "yours · date".
 */
async function withNames(changes: Changes): Promise<(Changes[number] & { name: string | null })[]> {
  const ids = [...new Set(changes.map((c) => c.by).filter(Boolean))];
  if (!ids.length) return changes.map((c) => ({ ...c, name: null }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getSupabaseServiceClient() as any).from("users").select("id, name, email").in("id", ids);
  if (error) console.error("[accounting-settings] change names could not be read", error.message);
  const names = new Map(((data ?? []) as { id: string; name: string | null; email: string | null }[]).map((u) => [u.id, (u.name ?? "").trim() || u.email || null]));
  return changes.map((c) => ({ ...c, name: names.get(c.by) ?? null }));
}

type Loaded =
  | { ok: true; settings: Awaited<ReturnType<typeof loadAccountingSettings>>; changes: Awaited<ReturnType<typeof withNames>>; accounts: Awaited<ReturnType<typeof listAccounts>> }
  | { ok: false; error: unknown };

async function AccountingSettingsBody({ loaded, canEdit, canSeeHistory, initialTab }: { loaded: Promise<Loaded>; canEdit: boolean; canSeeHistory: boolean; initialTab: Tab }) {
  const result = await loaded;
  if (!result.ok && !(result.error instanceof SettingsError)) throw result.error;
  return (
      <div className="flex min-h-0 flex-grow flex-col gap-4">
      {result.ok ? (
        <AccountingSettingsBoard initial={result.settings} locked={LOCKED} changes={result.changes} accounts={result.accounts} canEdit={canEdit} canSeeHistory={canSeeHistory} initialTab={initialTab} />
      ) : (
        <TableCard><EmptyState title="Not switched on yet" hint={(result.error as SettingsError).message ?? ""} /></TableCard>
      )}
      </div>
  );
}
