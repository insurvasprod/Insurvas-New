import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { F, IOS } from "@/components/ui";
import { usePartnerSession } from "@/components/partner/session";

/** Board M7 for a partner: the same dark cover and Face ID / fingerprint circle, on the partner session. */
const COVER = "#0b1614";
const OLIVE = "#0d4037";
const GREEN = "#07d6a0";
const GREEN_INK = "#4fe3bb";
const refused = "Not unlocked. Try again, or use your password.";

export default function PartnerLocked() {
  const { unlock, signOut } = usePartnerSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const go = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const ok = await unlock();
      if (!ok) setMessage(refused);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn’t open the app. Try again.");
    } finally {
      setBusy(false);
    }
  }, [unlock]);

  // Ask once on arrival; tapping the circle asks again.
  useEffect(() => {
    unlock().then(
      (ok) => { if (!ok) setMessage(refused); },
      (e: unknown) => setMessage(e instanceof Error ? e.message : "Couldn’t open the app. Try again."),
    );
  }, [unlock]);

  return (
    <View style={{ flex: 1, backgroundColor: COVER, alignItems: "center", justifyContent: "center", gap: 18, paddingHorizontal: 32 }}>
      <StatusBar style="light" />
      <View style={{ width: 80, height: 80, borderRadius: 20, backgroundColor: OLIVE, alignItems: "center", justifyContent: "center" }}>
        <Logo size={52} />
      </View>
      <Text accessibilityRole="header" style={{ fontFamily: F.ds, fontSize: 24, color: "#ffffff" }}>Insurvas is locked</Text>
      <Pressable testID="partner-locked-unlock" accessibilityRole="button" accessibilityLabel={IOS ? "Unlock with Face ID" : "Unlock with fingerprint"} accessibilityState={{ busy }} disabled={busy} onPress={() => void go()} hitSlop={10}
        style={({ pressed }) => ({ marginTop: 10, width: 70, height: 70, borderRadius: 35, backgroundColor: pressed ? "rgba(7,214,160,0.24)" : "rgba(7,214,160,0.14)", alignItems: "center", justifyContent: "center" })}>
        {busy ? <ActivityIndicator color={GREEN} /> : <Icon name={IOS ? "face" : "finger"} size={38} color={GREEN} />}
      </Pressable>
      <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: "#ffffff", opacity: 0.7, textAlign: "center" }}>
        {message ?? (IOS ? "Look at your phone to unlock" : "Touch the sensor to unlock")}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void signOut()} hitSlop={10} style={{ marginTop: 30 }}>
        <Text style={{ fontFamily: F.s, fontSize: 16, color: GREEN_INK }}>Use password</Text>
      </Pressable>
    </View>
  );
}
