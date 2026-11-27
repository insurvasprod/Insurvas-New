import { Stack, useLocalSearchParams } from "expo-router";

import { VendorScreen } from "@/components/home3/vendor-screen";

/** Board D10 · one lead vendor (web /app/campaigns/vendors/<id>); `?name=` shows the name before the report answers. */
export default function VendorRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <VendorScreen id={String(id)} name={typeof name === "string" ? name : undefined} />
    </>
  );
}
