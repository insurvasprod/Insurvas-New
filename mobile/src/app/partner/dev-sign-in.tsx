import { useEffect, useState } from "react";
import { View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";

import { usePartnerSession } from "@/components/partner/session";
import { T } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * DEVELOPMENT ONLY. The partner app's copy of app/dev-sign-in.tsx: signs the emulator in as a test partner with
 * tokens minted by `node --env-file=.env.local scripts/mint-session.mjs partner --email <test partner> --app`,
 * so the partner screens can be walked without typing anyone's password. A release build only redirects to
 * Partner sign in, and the server checks every token it is handed either way.
 */
export default function PartnerDevSignIn() {
  const p = usePalette();
  const { adoptTokens } = usePartnerSession();
  const params = useLocalSearchParams<{ access?: string; refresh?: string; expiresAt?: string }>();
  const [message, setMessage] = useState("Signing in for testing…");

  useEffect(() => {
    if (!__DEV__ || !params.access || !params.refresh) return;
    adoptTokens({ access: params.access, refresh: params.refresh, expiresAt: Number(params.expiresAt ?? 0) })
      .then(() => router.replace("/partner" as never))
      .catch((e: unknown) => setMessage(e instanceof Error ? e.message : "Those test tokens were refused."));
  }, [adoptTokens, params.access, params.refresh, params.expiresAt]);

  if (!__DEV__) return <Redirect href={"/partner/sign-in" as never} />;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: p.canvas, padding: 24 }}>
      <T>{params.access ? message : "Open this link with access, refresh and expiresAt."}</T>
    </View>
  );
}
