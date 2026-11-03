import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ProducerCarrierForm } from "@/components/app/agency/producer-carriers-tab";
import { AgencyPage } from "@/components/app/agency/agency-page";
import { readProducerHeader } from "@/lib/agency/producerHeader";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AG-0.9 · one carrier on a producer's record: Agency › Producers › a producer › a carrier (foundation pass 2026-11-03;
 * it was a side panel on the Carriers tab). His level and writing number from a date, and his appointments. The
 * owner and admins edit, through the same routes as before.
 */
export default async function ProducerCarrierPage({ params }: { params: Promise<{ id: string; carrierId: string }> }) {
  const guard = await guardPage("team_hierarchy");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producers" description="Everyone who writes business under your contracts." />;
  if (!actAsPage(guard, ["owner"]) || guard.entitlement.access === "read_only") return <RoleGateNotice featureLabel="Producer carriers" detail="The owner and admins set producers' levels, writing numbers and appointments." />;
  const { id, carrierId } = await params;
  if (!UUID.test(id) || !UUID.test(carrierId)) notFound();
  const [producer, carrier] = await Promise.all([
    readProducerHeader(guard.context, id),
    getSupabaseServiceClient().from("carriers" as never).select("name").eq("id", carrierId).maybeSingle<{ name: string }>(),
  ]);
  if (!producer) notFound();
  return (
    <AgencyPage step="producers" title={`${carrier.data?.name ?? "Carrier"} · ${producer.displayName}`} facts="A change starts on its date; earlier rows are never edited. Two producers can never hold one writing number.">
      <ProducerCarrierForm producerId={id} carrierId={carrierId} />
    </AgencyPage>
  );
}
