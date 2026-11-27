import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { F, IOS } from "@/components/ui";
import { useSession } from "@/lib/session";

/**
 * Board M7 · Locked after a pause (and the lock A4 sets up). The board draws it on its own dark cover
 * in both themes, so the app switcher never shows client data: the isotype in its olive tile,
 * "Insurvas is locked", the Face ID / fingerprint circle (tap to ask again), and Use password, which
 * signs out to the password sign-in — keeping this person's unsent notes and outcomes for when they are back
 * (lib/outbox.ts; someone else signing in drops them). The check never opens the app on its own: a phone
 * with no screen lock goes to the password sign-in (lib/device-check.ts).
 */
const COVER = "#0b1614";
const OLIVE = "#0d4037";
const GREEN = "#07d6a0";
const GREEN_INK = "#4fe3bb";
const refused = "Not unlocked. Try again, or use your password.";

export default function Locked() {
  const { unlock, signOut } = useSession();
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

  // Ask for Face ID once on arrival; tapping the circle asks again.
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
      <Pressable testID="locked-unlock" accessibilityRole="button" accessibilityLabel={IOS ? "Unlock with Face ID" : "Unlock with fingerprint"} accessibilityState={{ busy }} disabled={busy} onPress={() => void go()} hitSlop={10}
        style={({ pressed }) => ({ marginTop: 10, width: 70, height: 70, borderRadius: 35, backgroundColor: pressed ? "rgba(7,214,160,0.24)" : "rgba(7,214,160,0.14)", alignItems: "center", justifyContent: "center" })}>
        {busy ? <ActivityIndicator color={GREEN} /> : <Icon name={IOS ? "face" : "finger"} size={38} color={GREEN} />}
      </Pressable>
      <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: "#ffffff", opacity: 0.7, textAlign: "center" }}>
        {message ?? (IOS ? "Look at your phone to unlock" : "Touch the sensor to unlock")}
      </Text>
      <Pressable testID="locked-use-password" accessibilityRole="button" onPress={() => void signOut({ keepToSend: true })} hitSlop={10} style={{ marginTop: 30 }}>
        <Text style={{ fontFamily: F.s, fontSize: 16, color: GREEN_INK }}>Use password</Text>
      </Pressable>
    </View>
  );
}
