import { useEffect, useState } from "react";
import { View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";

import { T } from "@/components/ui";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

/**
 * DEVELOPMENT ONLY. Signs the emulator / simulator in with tokens minted by
 * `node --env-file=.env.local scripts/mint-session.mjs tenant --email <test account> --app`, so the
 * signed-in screens can be tested (by hand or by Maestro) without typing anyone's password.
 *
 *   exp://127.0.0.1:8081/--/dev-sign-in?access=…&refresh=…&expiresAt=…
 *
 * A release build has __DEV__ = false: this screen only redirects to Sign in, and the tokens it
 * would accept are signed by the server's secret anyway — it can't make a session the server refuses.
 */
export default function DevSignIn() {
  const p = usePalette();
  const { adoptTokens } = useSession();
  const params = useLocalSearchParams<{ access?: string; refresh?: string; expiresAt?: string }>();
  const [message, setMessage] = useState("Signing in for testing…");

  useEffect(() => {
    if (!__DEV__ || !params.access || !params.refresh) return;
    adoptTokens({ access: params.access, refresh: params.refresh, expiresAt: Number(params.expiresAt ?? 0) })
      // A screen opened from a link stays on top when the guard flips; go Home explicitly.
      .then(() => router.replace("/"))
      .catch((e: unknown) => setMessage(e instanceof Error ? e.message : "Those test tokens were refused."));
  }, [adoptTokens, params.access, params.refresh, params.expiresAt]);

  if (!__DEV__) return <Redirect href="/sign-in" />;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: p.canvas, padding: 24 }}>
      <T>{params.access ? message : "Open this link with access, refresh and expiresAt."}</T>
    </View>
  );
}
