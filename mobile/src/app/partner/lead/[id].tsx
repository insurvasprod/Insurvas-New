import { useLocalSearchParams } from "expo-router";

import { PartnerLead } from "@/components/partner/lead";

/** Board K3b · one lead the partner sent. */
export default function PartnerLeadRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PartnerLead id={id} />;
}
