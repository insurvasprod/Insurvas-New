import { useLocalSearchParams } from "expo-router";

import { CaseScreen } from "@/components/retention/case-screen";

/** Board F4 · one retention case. */
export default function RetentionCaseRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CaseScreen id={id} />;
}
