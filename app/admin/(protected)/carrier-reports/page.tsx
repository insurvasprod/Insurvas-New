import { redirect } from "next/navigation";

import { CarrierFactReports } from "@/components/admin/carrier-fact-reports";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { FACT_REPORTS_PENDING_MESSAGE } from "@/lib/carriers/factReportConstants";
import { listFactReportQueue } from "@/lib/carriers/factReports";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";

/** Catalog › Fact reports (20261027200000): wrong carrier facts reported by agencies. Carrier-library access. */
export default async function CarrierReportsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const loaded = await listFactReportQueue();
  return <CarrierFactReports initialReports={loaded.reports} notice={loaded.available ? undefined : `${FACT_REPORTS_PENDING_MESSAGE} Agencies' Tell us opens an email until then.`} />;
}
