import { useLocalSearchParams } from "expo-router";

import { PartnerScreen } from "@/components/team/partner-screen";

/** Board I8 · a partner from the agency's side, opened from Partner quality (or the Menu's Partners). */
export default function PartnerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PartnerScreen id={id} />;
}
