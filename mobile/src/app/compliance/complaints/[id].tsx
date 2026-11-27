import { useLocalSearchParams } from "expo-router";

import { ComplaintScreen } from "@/components/team/complaints-screens";

/** Board I6b · one complaint. */
export default function ComplaintRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ComplaintScreen id={id} />;
}
