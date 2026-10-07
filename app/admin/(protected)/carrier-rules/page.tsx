import { redirect } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { CarrierRulesWorkspace } from "@/components/app/carrier-rules-workspace";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { CARRIER_RULES_PENDING_MESSAGE, loadCarrierRules } from "@/lib/ingestion/carrierRulesStore";

/** LA-4.17 (Notion sprint) · the platform's default carrier rules and settings, for staff. */
export default async function AdminCarrierRulesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const view = await loadCarrierRules({ plane: "platform", adminId: admin.id });
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Carrier rules" subtitle="The platform's default save windows and carrier settings. An agency's own rule overrides these; nothing falls back to a guess." />
      {!view.available && <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{CARRIER_RULES_PENDING_MESSAGE}</div>}
      {view.available && <CarrierRulesWorkspace carriers={view.carriers} plane="platform" endpoint="/api/admin/carrier-rules" readOnly={false} asOf={view.asOf} />}
    </div>
  );
}
