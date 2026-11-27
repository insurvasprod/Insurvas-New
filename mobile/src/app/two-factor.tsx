import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OtpBoxes } from "@/components/getting-in/otp";
import { dayMonth } from "@/components/home/when";
import { Between, Button, F, Field, Header, IOS, TextLink, Toggle } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

const TRUST_DAYS = 30;

/**
 * Board A2 · Your sign-in code. The six code boxes, "Trust this phone for 30 days" with the date it
 * runs to, Verify, and "Use a backup code instead" (the web's recovery codes). The subtitle names the
 * account the code is for, as drawn (the email typed on Sign in, passed along). The server decides; its own
 * words come back on a refusal.
 */
export default function TwoFactor() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { verifyCode } = useSession();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const account = typeof email === "string" && email.includes("@") ? email : null;
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [trust, setTrust] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [until] = useState(() => dayMonth(new Date(Date.now() + TRUST_DAYS * 86_400_000)));

  async function submit(given?: string) {
    const value = (given ?? code).trim();
    if (!recovery && !/^\d{6}$/.test(value)) { setError("Enter the 6-digit code from your authenticator app."); return; }
    if (recovery && value.length < 10) { setError("Enter one of your backup codes."); return; }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode(recovery ? { recoveryCode: value, trust } : { code: value, trust });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "That code is not right, or has been used.";
      setError(message);
      if (/too long|Sign in again/i.test(message)) setTimeout(() => router.replace("/sign-in"), 1200);
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setRecovery((r) => !r);
    setCode("");
    setError(null);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
      <Header title="" large={false} back={IOS ? "Back" : undefined} onBack={() => (router.canGoBack() ? router.back() : router.replace("/sign-in"))} />
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, gap: 20 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View>
          <Text accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 28, lineHeight: 34, letterSpacing: -0.56, color: p.ink }}>{recovery ? "Use a backup code" : "Enter your code"}</Text>
          <Text style={{ marginTop: 6, fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.muted }}>
            {recovery ? "Each backup code works once." : account ? `Enter the 6-digit code your authenticator app shows for ${account}.` : "Open your authenticator app and enter the 6-digit code for Insurvas."}
          </Text>
        </View>
        {recovery ? (
          <Field testID="two-factor-backup" label="Backup code" value={code} onChangeText={setCode} autoFocus autoCapitalize="none" autoCorrect={false} maxLength={20} returnKeyType="go" onSubmitEditing={() => void submit()} error={error} />
        ) : (
          <View style={{ gap: 8 }}>
            <OtpBoxes testID="two-factor-code" value={code} onChange={(v) => { setCode(v); if (error) setError(null); }} onFilled={(v) => void submit(v)} error={Boolean(error)} />
            {error ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.bad, textAlign: "center" }}>{error}</Text> : null}
          </View>
        )}
        <Between>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.r, fontSize: 15, color: p.ink }}>Trust this phone for 30 days</Text>
            <Text style={{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted }}>{trust ? `You won’t be asked for a code here until ${until}.` : "You’ll be asked for a code each time you sign in."}</Text>
          </View>
          <Toggle label="Trust this phone for 30 days" value={trust} onChange={setTrust} />
        </Between>
        <Button testID="two-factor-verify" label="Verify" onPress={() => void submit()} busy={busy} />
        <TextLink label={recovery ? "Use the 6-digit code instead" : "Use a backup code instead"} onPress={switchMode} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
