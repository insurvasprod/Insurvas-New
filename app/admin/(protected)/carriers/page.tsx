import { redirect } from "next/navigation";

import { CarrierNewButton } from "@/components/admin/catalog/carrier-new-button";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { CarriersTable } from "@/components/admin/carriers-table";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { listPlatformCarriers, readCarrierUsage } from "@/lib/carriers/adminService";
import { readSetupInputs } from "@/lib/carriers/record";
import { carrierSetup, type CarrierSetup } from "@/lib/carriers/setup";
import { USAGE_UNKNOWN_TITLE, type CarrierUsageSnapshot } from "@/lib/carriers/usage";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";

const count = (n: number) => n.toLocaleString("en-US");

/**
 * Catalog › Carriers (admin round 1, docs/design/admin-r1/catalog.html screen 7), inside the Catalog frame: the
 * platform carrier library, with each carrier's eight set-up facets as dots (portal facts, rules, layouts, status
 * words, field maps, portal guide, servicing, fact reports) and a "Missing" filter. A carrier opens its record.
 */
export default async function CarriersPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");

  // The platform library only (organization_id is null) — the rows tenants actually pick from.
  const [carriers, inputs] = await Promise.all([listPlatformCarriers(), readSetupInputs(admin.id)]);
  // Usage is garnish for the table but the guard's evidence for the figures: a failed read shows
  // "unknown", never a 0 that would read as "safe to deactivate".
  let usage: CarrierUsageSnapshot = { available: false };
  try {
    usage = await readCarrierUsage();
  } catch (error) {
    console.error("carrier usage read failed", error);
  }
  const setup: Record<string, CarrierSetup> = Object.fromEntries(carriers.map((carrier) => [carrier.id, carrierSetup(carrier.id, inputs)]));

  const canOverride = admin.role === "super_admin";
  const active = carriers.filter((carrier) => carrier.is_active);
  const inactive = carriers.length - active.length;
  const inUseCount = usage.available ? carriers.filter((carrier) => (usage.byCarrier[carrier.id]?.tenants ?? 0) > 0).length : null;
  const blockedCount = usage.available ? carriers.filter((carrier) => carrier.is_active && (usage.byCarrier[carrier.id]?.tenants ?? 0) > 0).length : null;
  const unknown = "—";

  return (
    <CatalogPage
      step="carriers"
      info="The platform carrier library agencies pick from for contracts, appointments and commission files. A carrier opens its record: everything about it, as tabs."
      actions={<CarrierNewButton />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Carriers at a glance">
          <StatTile label="Carriers" value={count(carriers.length)} footnote={`${count(inactive)} inactive`} href={inactive > 0 ? "/admin/carriers?state=inactive" : undefined} />
          <StatTile
            label="In use"
            value={inUseCount === null ? unknown : count(inUseCount)}
            footnote={usage.available ? `by ${count(usage.totals.tenants)} ${usage.totals.tenants === 1 ? "tenant" : "tenants"}` : "usage not available yet"}
            labelTitle={usage.available ? "Carriers with at least one tenant holding an active contract or an open appointment" : USAGE_UNKNOWN_TITLE}
            href={usage.available ? "/admin/carriers?usage=in_use" : undefined}
          />
          <StatTile
            label="Appointments recorded"
            value={usage.available ? count(usage.totals.appointments) : unknown}
            footnote={usage.available ? `across all tenants · ${count(usage.totals.openAppointments)} open` : "across all tenants"}
            labelTitle={usage.available ? `${count(usage.totals.openAppointments)} open, the rest terminated` : USAGE_UNKNOWN_TITLE}
          />
          <StatTile
            label="Deactivations blocked"
            value={blockedCount === null ? unknown : count(blockedCount)}
            footnote="active carriers tenants still use"
            labelTitle={usage.available ? (canOverride ? "Deactivating one of these needs a recorded reason" : "Only a super admin can deactivate one of these, with a recorded reason") : USAGE_UNKNOWN_TITLE}
            href={usage.available ? "/admin/carriers?state=active&usage=in_use" : undefined}
          />
        </StatStrip>

        <CarriersTable carriers={carriers} usage={usage} setup={setup} canOverride={canOverride} />
      </div>
    </CatalogPage>
  );
}
