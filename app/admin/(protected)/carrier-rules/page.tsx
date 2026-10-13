import { redirect } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { CarrierRulesWorkspace } from "@/components/app/carrier-rules-workspace";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { CARRIER_RULES_PENDING_MESSAGE, loadCarrierRules } from "@/lib/ingestion/carrierRulesStore";

/** LA-4.17 (Notion sprint) · the platform's default carrier rules and settings, for staff. */
export default async function AdminCarrierRulesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const view = await loadCarrierRules({ plane: "platform", adminId: admin.id });
  const withGap = view.carriers.filter((carrier) => carrier.gaps.length > 0).length;
  const gaps = view.carriers.reduce((sum, carrier) => sum + carrier.gaps.length, 0);
  const rules = view.carriers.flatMap((carrier) => Object.values(carrier.rules).filter((rule) => rule !== null));
  const unverified = rules.filter((rule) => !rule.verified).length;
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Carrier rules" subtitle="The platform's default save windows and carrier settings. An agency's own rule overrides these; nothing falls back to a guess." />
      {view.available && (
        <StatStrip label="Carrier rule totals">
          <StatTile label="Carriers" value={view.carriers.length.toLocaleString("en-US")} footnote="active in the library" />
          <StatTile label="Missing a rule" labelTitle="Active carriers with at least one kind of save that has no window set" value={withGap.toLocaleString("en-US")} valueTone={withGap > 0 ? "warning" : undefined} footnote={gaps > 0 ? `${gaps.toLocaleString("en-US")} windows not set` : "every window set"} />
          <StatTile label="Rules set" value={rules.length.toLocaleString("en-US")} reserveFootnote />
          <StatTile label="Unverified" value={unverified.toLocaleString("en-US")} valueTone={unverified > 0 ? "warning" : undefined} footnote={rules.length > 0 ? `of ${rules.length.toLocaleString("en-US")} rules` : "no rules yet"} />
        </StatStrip>
      )}
      {!view.available && <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{CARRIER_RULES_PENDING_MESSAGE}</div>}
      {view.available && <CarrierRulesWorkspace carriers={view.carriers} plane="platform" endpoint="/api/admin/carrier-rules" readOnly={false} asOf={view.asOf} />}
    </div>
  );
}
