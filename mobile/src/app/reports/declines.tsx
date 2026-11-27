import { useLocalSearchParams } from "expo-router";

import { DeclinesScreen } from "@/components/team/report-screens";

/** Board I4 · the applications behind one "Why carriers declined" reason. */
export default function DeclinesRoute() {
  const { key, title, ...rest } = useLocalSearchParams<{ key: string; title?: string; from?: string; to?: string; carrier?: string; product?: string; producer?: string }>();
  const query = Object.entries(rest).filter(([k, v]) => ["from", "to", "carrier", "product", "producer"].includes(k) && typeof v === "string" && v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return <DeclinesScreen reasonKey={key} query={query} title={title || "Declined"} />;
}
