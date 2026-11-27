import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Logo } from "@/components/logo";
import { Button, F } from "@/components/ui";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

/**
 * Board A0 · First open. Only before the first sign-in on this phone; after that the app opens on Sign
 * in. Starting an agency and choosing a plan stay on the web (a plan sold in the app would have to go
 * through Apple's and Google's payments). An invite arrives by email: "I have an invite" opens the mail
 * app, where the link opens Accept an invite (A5) on this phone.
 */
export default function Welcome() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { firstOpen } = useSession();
  if (!firstOpen) return <Redirect href={"/sign-in" as never} />;

  function openMail() {
    void Linking.openURL(Platform.OS === "ios" ? "message://" : "mailto:").catch(() => undefined);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.canvas }} contentContainerStyle={{ paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }} showsVerticalScrollIndicator={false}>
      <View accessibilityRole="image" accessibilityLabel="Insurvas" style={{ width: 72, height: 72, borderRadius: 18, backgroundColor: "#0d4037", alignItems: "center", justifyContent: "center" }}>
        <Logo size={48} />
      </View>
      <Text accessibilityRole="header" style={{ marginTop: 28, fontFamily: F.db, fontSize: 36, lineHeight: 39, letterSpacing: -0.72, color: p.ink }}>Your calls, leads and book. In your pocket.</Text>
      <Text style={{ marginTop: 12, fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.muted }}>For agents, agencies and the partners who send them leads.</Text>
      <View style={{ marginTop: 150, gap: 12 }}>
        <Button testID="welcome-sign-in" label="Sign in" onPress={() => router.push("/sign-in" as never)} />
        <Button testID="welcome-invite" kind="outline" label="I have an invite" icon="mail" onPress={openMail} />
        <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "center", flexWrap: "wrap" }}>
          <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>New to Insurvas? Start your agency at </Text>
          <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync("https://insurvas.com")} hitSlop={6}>
            <Text style={{ fontFamily: F.s, fontSize: 12.5, color: p.greenInk }}>insurvas.com</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
