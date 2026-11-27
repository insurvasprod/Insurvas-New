import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, F, Field, TextLink } from "@/components/ui";
import { Logo } from "@/components/logo";
import { usePartnerSession } from "@/components/partner/session";
import { API_URL, ApiError } from "@/lib/api";
import { usePalette } from "@/theme/use-palette";

/**
 * The partner's sign-in on the phone, drawn as board A1 with the partner's words. The portal's own
 * sign-in decides everything (password, lockout, an agency account refused, a suspended agency, the
 * agency's partner feature); the server's own words come back on a refusal. Partners have no code step.
 * "Forgot your password?" opens the portal's own page, as the agents' sign-in opens theirs.
 */
export default function PartnerSignIn() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { signIn } = usePartnerSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in did not finish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.canvas }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, gap: 18 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Logo size={42} tile />
        <View>
          <Text accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: p.ink }}>Partner sign in</Text>
          <Text style={{ marginTop: 4, fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.muted }}>What you sent, what it became, and what you’re owed.</Text>
        </View>
        <Field testID="partner-sign-in-email" label="Email" leadIcon="mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" returnKeyType="next" placeholder="you@company.com" />
        <Field testID="partner-sign-in-password" label="Password" leadIcon="lock" trailIcon="eye" trailLabel={show ? "Hide password" : "Show password"} onTrail={() => setShow((s) => !s)}
          value={password} onChangeText={setPassword} secureTextEntry={!show} autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} error={error} />
        <Button testID="partner-sign-in-submit" label="Sign in" onPress={submit} busy={busy} />
        <TextLink label="I work at the agency" onPress={() => (router.canGoBack() ? router.back() : router.replace("/sign-in" as never))} />
        <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 20 }}>
          <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/partner/login`)} hitSlop={6}>
            <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>Forgot your password?</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
