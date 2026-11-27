import { useLocalSearchParams } from "expo-router";

import { PolicyScreen } from "@/components/book/policy";

/** Board F2 · Policy: a carrier's policy is its carrier and its number, as on the web (/app/policies/carrier/…). */
export default function PolicyRoute() {
  const { carrierId, policyNumber } = useLocalSearchParams<{ carrierId: string; policyNumber: string }>();
  return <PolicyScreen carrierId={String(carrierId)} policyNumber={String(policyNumber)} />;
}
