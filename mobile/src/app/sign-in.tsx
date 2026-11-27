import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Between, Button, F, Field, IOS, TextLink, Toggle } from "@/components/ui";
import { Logo } from "@/components/logo";
import { API_URL, ApiError, rawRequest } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

/**
 * Board A1 · Sign in. Drawn to the mockup: the isotype in its 64px olive tile, "Sign in to Insurvas",
 * Email and Password with their icons, Keep me signed in, Sign in, the Face ID / fingerprint button,
 * "Email me a sign-in link", and Forgot your password? · Help. The web's rules decide (lockout, partner
 * door, suspension, two-factor); the server's own words come back on a refusal.
 */
export default function SignIn() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(email.trim(), password, remember);
      if ("twoFactor" in result) router.push({ pathname: "/two-factor", params: { email: email.trim() } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in did not finish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function emailLink() {
    if (!email.trim()) { setError("Enter your email first, then ask for the link."); return; }
    setError(null);
    try {
      await rawRequest("/api/app/auth/sign-in-link", { method: "POST", body: { email: email.trim(), remember } });
      router.push({ pathname: "/check-email", params: { email: email.trim(), remember: remember ? "1" : "0" } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The link could not be sent. Try again.");
    }
  }

  function biometric() {
    // Face ID / the fingerprint opens a session this phone already holds (the lock screen, board A4).
    Alert.alert(IOS ? "Face ID" : "Fingerprint", `Sign in once with your password on this phone; after that ${IOS ? "Face ID" : "your fingerprint"} opens Insurvas.`);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.canvas }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, gap: 18 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Logo size={42} tile />
        <View>
          <Text accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: p.ink }}>Sign in to Insurvas</Text>
          <Text style={{ marginTop: 4, fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.muted }}>Your calls, leads and book, wherever you are.</Text>
        </View>
        <Field testID="sign-in-email" label="Email" leadIcon="mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" returnKeyType="next" placeholder="you@agency.com" />
        <Field testID="sign-in-password" label="Password" leadIcon="lock" trailIcon="eye" trailLabel={show ? "Hide password" : "Show password"} onTrail={() => setShow((s) => !s)}
          value={password} onChangeText={setPassword} secureTextEntry={!show} autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} error={error} />
        <Between>
          <Text style={{ fontFamily: F.r, fontSize: 15, color: p.ink }}>Keep me signed in</Text>
          <Toggle label="Keep me signed in" value={remember} onChange={setRemember} />
        </Between>
        <Button testID="sign-in-submit" label="Sign in" onPress={submit} busy={busy} />
        <Button kind="outline" label={IOS ? "Sign in with Face ID" : "Sign in with fingerprint"} icon={IOS ? "face" : "finger"} onPress={biometric} />
        <TextLink label="Email me a sign-in link" onPress={emailLink} />
        <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 20 }}>
          <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/app/login`)} hitSlop={6}>
            <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>Forgot your password?</Text>
          </Pressable>
          <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}> · </Text>
          <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/app/docs`)} hitSlop={6}>
            <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>Help</Text>
          </Pressable>
        </View>
        {/* Board K0: publishers, marketing and affiliate partners have their own door and their own app screens. */}
        <Pressable testID="sign-in-partner" accessibilityRole="link" onPress={() => router.push("/partner/sign-in" as never)} hitSlop={6} style={{ alignSelf: "center", marginTop: 12 }}>
          <Text style={{ fontFamily: F.s, fontSize: 13, color: p.greenInk }}>Sign in as a partner</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
