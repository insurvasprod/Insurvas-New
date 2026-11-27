import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CouldntLoad, Skeleton } from "@/components/states/states";
import { Between, Button, F, Field, IOS, TextLink, Toggle } from "@/components/ui";
import { API_URL, ApiError, rawRequest } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board A5 · Accept an invite. The invite link (insurvas://accept-invite?token=…) opens here. What the
 * page shows is the server's reading of the link (GET /api/app/auth/set-password): the workspace, the
 * role, the address. A new account chooses its password (POST set-password) and is signed in with it;
 * someone who already has an Insurvas account just accepts (POST accept-invite) and signs in as usual.
 * The same rules as the web decide (expired, used, maintenance); their words come back.
 *
 * As drawn: the role sentence (what the role will see) and the password's strength under the field. The board's
 * inviter ("Dana invited you to …" with Dana's initials) is not drawn: the set-password route does not say who
 * sent the invitation.
 */
type Invite = { valid: true; email: string; name: string | null; purpose: "invite" | "password_reset"; organization: string | null; role: string | null; hasAccount: boolean };

const PASSWORD_MIN = 12;

/** Board A5's role sentence: what the role will see, by the server's role label (TENANT_ROLE_LABELS). */
const ROLE_SEES: Record<string, string> = {
  Owner: "You’ll see the whole agency: its people, book and money.",
  Admin: "You’ll see the whole agency except billing and the plan.",
  Producer: "You’ll see your own leads, calls, sales and pay.",
  Assistant: "You’ll take incoming callers and help with callbacks.",
  Bookkeeper: "You’ll see the book, commissions and the agency’s money.",
  Setter: "You’ll dial leads and book appointments for the agents.",
  "Retention rep": "You’ll work the policies at risk and the ones to win back.",
};

/**
 * The password hint as drawn ("At least 12 characters. Strong."): the length rule until it is met, then how strong
 * the password is by its length and the kinds of character in it. Only a hint: the server's rule decides.
 */
function passwordHint(password: string): string {
  const rule = `At least ${PASSWORD_MIN} characters.`;
  if (password.length < PASSWORD_MIN) return rule;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const strength = kinds >= 3 || password.length >= 20 ? "Strong" : kinds === 2 || password.length >= 16 ? "Fair" : "Weak";
  return `${rule} ${strength}.`;
}

export default function AcceptInvite() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const { status, setup, signIn, setBiometricOn } = useSession();
  const invite = useLoad(() => (token ? rawRequest<Invite>(`/api/app/auth/set-password?token=${encodeURIComponent(token)}`) : Promise.reject(new ApiError(400, { error: "This invitation link is invalid or has expired" }))), [token]);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [bio, setBio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  const data = invite.data;
  const where = data?.organization ?? "Insurvas";
  const reset = data?.purpose === "password_reset";

  async function join() {
    if (!data) return;
    if (!data.hasAccount && password.length < PASSWORD_MIN) { setError(`Password must be at least ${PASSWORD_MIN} characters`); return; }
    setBusy(true);
    setError(null);
    try {
      if (data.hasAccount) {
        await rawRequest("/api/app/auth/accept-invite", { method: "POST", body: { token } });
        router.replace((status === "signedIn" ? "/workspaces" : "/sign-in") as never);
        return;
      }
      await rawRequest("/api/app/auth/set-password", { method: "POST", body: { token, password } });
      await setBiometricOn(bio);
      const result = await signIn(data.email, password, true);
      if ("twoFactor" in result) router.replace("/two-factor" as never);
      else setJoined(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const legal = (type: "tos" | "privacy") => () => void WebBrowser.openBrowserAsync(`${API_URL}/legal/${type}`);

  // This page sits outside the sign-in doors, so nothing moves it on by itself: once signed in, Home
  // (the layout opens the first-sign-in steps A7 / A3 itself when they apply).
  if (joined && status === "signedIn" && setup !== "workspace" && setup !== "alerts") return <Redirect href={"/" as never} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.canvas }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24, paddingHorizontal: data ? 24 : 0, gap: 18 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!data ? (
          invite.loading ? <Skeleton rows={3} /> : (
            <>
              <CouldntLoad what="this invitation" message={invite.error ?? "This invitation link is invalid or has expired"} onRetry={invite.reload} />
              <TextLink label="Go to Sign in" onPress={() => router.replace("/sign-in" as never)} />
            </>
          )
        ) : (
          <>
            <View>
              <Text accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 28, lineHeight: 33, letterSpacing: -0.56, color: p.ink }}>
                {reset ? "Choose a new password" : `You’re invited to ${where}`}
              </Text>
              {data.role && !reset ? (
                <Text style={{ marginTop: 6, fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.muted }}>
                  You’ll join as {/^[aeiou]/i.test(data.role) ? "an" : "a"} <Text style={{ fontFamily: F.b, color: p.ink }}>{data.role}</Text>.{ROLE_SEES[data.role] ? ` ${ROLE_SEES[data.role]}` : ""}
                </Text>
              ) : null}
            </View>
            <Field testID="invite-email" label="Email" leadIcon="mail" value={data.email} editable={false} />
            {data.hasAccount ? null : (
              <Field testID="invite-password" label={reset ? "New password" : "Create a password"} leadIcon="lock" trailIcon="eye" trailLabel={show ? "Hide password" : "Show password"} onTrail={() => setShow((s) => !s)}
                value={password} onChangeText={setPassword} secureTextEntry={!show} autoComplete="new-password" textContentType="newPassword" autoFocus
                hint={error ? undefined : passwordHint(password)} error={error} returnKeyType="go" onSubmitEditing={() => void join()} />
            )}
            {data.hasAccount ? null : (
              <Between>
                <Text style={{ fontFamily: F.r, fontSize: 15, color: p.ink }}>{IOS ? "Use Face ID next time" : "Use fingerprint next time"}</Text>
                <Toggle label={IOS ? "Use Face ID next time" : "Use fingerprint next time"} value={bio} onChange={setBio} />
              </Between>
            )}
            {data.hasAccount && error ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{error}</Text> : null}
            <Button testID="invite-join" label={reset ? "Save password" : `Join ${where}`} onPress={() => void join()} busy={busy} />
            {reset ? null : (
              <Text style={{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted, textAlign: "center" }}>
                By joining you accept the <Text accessibilityRole="link" onPress={legal("tos")}>terms</Text> and <Text accessibilityRole="link" onPress={legal("privacy")}>privacy policy</Text>.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
