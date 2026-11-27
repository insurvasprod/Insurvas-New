import { useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { Button, F, Header, IOS } from "@/components/ui";
import { ApiError, rawRequest } from "@/lib/api";
import { usePalette } from "@/theme/use-palette";

/**
 * Board A6 · Check your email, after "Email me a sign-in link" on Sign in. The server never says
 * whether the address has an account, so neither does this page. Send it again asks for a new link.
 */
export default function CheckEmail() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string; remember?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace("/sign-in");
  }

  async function again() {
    if (!email) { back(); return; }
    setBusy(true);
    setError(null);
    try {
      await rawRequest("/api/app/auth/sign-in-link", { method: "POST", body: { email, remember: params.remember !== "0" } });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The link could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function openMail() {
    // iOS opens the Mail inbox; Android has no inbox address, so it opens the mail app's compose.
    void Linking.openURL(Platform.OS === "ios" ? "message://" : "mailto:").catch(() => setError("No mail app is set up on this phone."));
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
      <Header title="" large={false} back={IOS ? "Sign in" : undefined} onBack={back} />
      <ScrollView contentContainerStyle={{ alignItems: "center", paddingTop: 70, paddingHorizontal: 30, paddingBottom: insets.bottom + 24, gap: 10 }}>
        <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: p.surf2, alignItems: "center", justifyContent: "center" }}>
          <Icon name="mail" size={30} color={p.greenInk} />
        </View>
        <Text accessibilityRole="header" style={{ marginTop: 6, fontFamily: F.db, fontSize: 20, color: p.ink, textAlign: "center" }}>Check your email</Text>
        <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.muted, textAlign: "center" }}>
          {email ? <>If <Text style={{ fontFamily: F.b, color: p.ink }}>{email}</Text> has an Insurvas account, a sign-in link is on its way.</> : "If that address has an Insurvas account, a sign-in link is on its way."} It works once, for 15 minutes.
        </Text>
        <View style={{ width: 260, gap: 10, marginTop: 16 }}>
          <Button testID="check-email-open-mail" label="Open Mail" icon="mail" onPress={openMail} />
          <Button testID="check-email-again" kind="outline" label={sent ? "Sent again" : "Send it again"} onPress={() => void again()} busy={busy} disabled={sent} />
        </View>
        {error ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.bad, textAlign: "center" }}>{error}</Text> : null}
        <Pressable accessibilityRole="link" onPress={back} hitSlop={8} style={{ marginTop: 14 }}>
          <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted, textAlign: "center" }}>Wrong address? Go back and change it.</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
