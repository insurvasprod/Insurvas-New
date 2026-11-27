import { useLocalSearchParams } from "expo-router";

import { ProducerScreen } from "@/components/team/producer-screen";

/** Board I2 · one producer, opened from the Team tab. */
export default function ProducerRoute() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  return <ProducerScreen userId={userId} />;
}
