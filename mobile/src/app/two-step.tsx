import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Text, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { LoadState } from "@/components/states/states";
import { Button, F, Fact, Field, Group, Header, Row, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board J3's "Two-step sign-in" row, set on the phone (GET/POST /api/app/profile/two-factor, LA-8.2): an
 * authenticator app, never SMS. Turning it on adds Insurvas to the authenticator on this phone (its otpauth
 * link) or by the key, then takes the first six-digit code and shows the recovery codes once. Turning it off,
 * or replacing the codes, needs a current code; the server holds the lockout.
 */
type Status = { enabled: boolean; enabledAt: string | null; pending: boolean; recoveryCodesLeft: number; required?: boolean };
type Enrol = { uri: string; secret: string };

export default function TwoStep() {
  const p = usePalette();
  const { api } = useSession();
  const status = useLoad(() => api<Status>("/api/app/profile/two-factor"), []);
  const [enrol, setEnrol] = useState<Enrol | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function act(action: "start" | "confirm" | "disable" | "recovery_codes") {
    setBusy(action);
    setError(null);
    try {
      const body = action === "start" ? { action } : { action, code: code.trim() };
      const answer = await api<{ uri?: string; secret?: string; recoveryCodes?: string[] }>("/api/app/profile/two-factor", { method: "POST", body });
      if (action === "start" && answer.uri && answer.secret) setEnrol({ uri: answer.uri, secret: answer.secret });
      if (answer.recoveryCodes) setCodes(answer.recoveryCodes);
      if (action !== "start") { setCode(""); setEnrol(null); status.reload(); }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn’t work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const s = status.data;
  const codeField = (label: string) => (
    <Field testID="two-step-code" label={label} value={code} onChangeText={setCode} keyboardType={label.includes("recovery") ? "default" : "number-pad"} autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={20} />
  );
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.canvas }}>
      <Screen header={<Header title="Two-step sign-in" back="Settings" onBack={router.back} large />} onRefresh={status.refresh} refreshing={status.refreshing}>
        <LoadState loading={status.loading} hasData={Boolean(s)} error={status.error} errorCode={status.errorCode} onRetry={status.reload} what="your two-step sign-in" />
        {codes ? (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.body }}>Keep these recovery codes somewhere safe. Each one signs you in once if you lose this phone. They are shown only now.</Text>
            <Group>{codes.map((c, i) => <Fact key={c} first={i === 0} label={`Code ${i + 1}`} value={c} />)}</Group>
            <Button testID="two-step-copy" kind="outline" icon="copy" label={copied ? "Copied" : "Copy the codes"} onPress={() => void Clipboard.setStringAsync(codes.join("\n")).then(() => setCopied(true))} />
            <Button testID="two-step-done" label="Done" onPress={() => setCodes(null)} />
          </View>
        ) : s && !s.enabled ? (
          enrol ? (
            <View style={{ paddingHorizontal: 16, gap: 14 }}>
              <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.body }}>Add Insurvas to your authenticator app, then type the six-digit code it shows.</Text>
              <Button testID="two-step-open-app" kind="outline" icon="key" label="Open my authenticator app" onPress={() => void Linking.openURL(enrol.uri).catch(() => setError("No authenticator app on this phone took the link. Type the key into it instead."))} />
              <Group title="Or type this key"><Row first title={enrol.secret} chevron={false} right={<Text onPress={() => void Clipboard.setStringAsync(enrol.secret)} style={{ fontFamily: F.s, fontSize: 14, color: p.greenInk }}>Copy</Text>} /></Group>
              {codeField("Six-digit code")}
              {error ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{error}</Text> : null}
              <Button write testID="two-step-confirm" label="Turn on" busy={busy === "confirm"} disabled={!/^\d{6}$/.test(code.trim())} onPress={() => void act("confirm")} />
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, gap: 14 }}>
              <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.body }}>{s.required ? "Your role needs two-step sign-in to see protected details." : "A code from an authenticator app, as well as your password, when you sign in on a new device."}</Text>
              {error ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{error}</Text> : null}
              <Button testID="two-step-start" label="Set up two-step sign-in" icon="lock" busy={busy === "start"} onPress={() => void act("start")} />
            </View>
          )
        ) : s ? (
          <View style={{ gap: 14 }}>
            <Group>
              <Fact first label="Two-step sign-in" value="On" />
              <Fact label="Recovery codes left" value={String(s.recoveryCodesLeft)} />
            </Group>
            <View style={{ paddingHorizontal: 16, gap: 12 }}>
              {codeField("A code from your app, or a recovery code")}
              {error ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{error}</Text> : null}
              <Button testID="two-step-new-codes" kind="outline" label="New recovery codes" busy={busy === "recovery_codes"} disabled={!/^\d{6}$/.test(code.trim()) || Boolean(busy)} onPress={() => void act("recovery_codes")} />
              <Button write testID="two-step-disable" kind="danger" label="Turn off" busy={busy === "disable"} disabled={!code.trim() || Boolean(busy)} onPress={() => void act("disable")} />
            </View>
          </View>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
