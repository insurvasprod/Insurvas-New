import { useLocalSearchParams } from "expo-router";

import { PartnerThread } from "@/components/partner/messages";

/** A conversation from K5 (drawn as H3), optionally opened with a draft (K3b: "Message the agency about Ida"). */
export default function PartnerThreadRoute() {
  const { id, draft } = useLocalSearchParams<{ id: string; draft?: string }>();
  return <PartnerThread id={id} draft={draft} />;
}
