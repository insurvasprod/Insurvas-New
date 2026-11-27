import { useLocalSearchParams } from "expo-router";

import { FunnelListScreen } from "@/components/team/report-screens";

/** Board I4 · the leads behind one bar of "From lead to policy". */
export default function FunnelListRoute() {
  const { stage, from, to, title, product } = useLocalSearchParams<{ stage: string; from: string; to: string; title?: string; product?: string }>();
  return <FunnelListScreen stage={stage} from={from} to={to} title={title || "Leads"} product={product || undefined} />;
}
