import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/states/states";
import { Button, Card, F, Row, TextLink, Toggle } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { alertKinds, pushChanges, PREFS_PATH, type PrefsAnswer } from "@/lib/notification-prefs";
import { registerForPush } from "@/lib/push";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board A3 · Turn on alerts, once, after the first sign-in and before the system's own question. The
 * rows are the board's alert kinds (lib/notification-prefs `alertKinds`, the same mapping as Settings ›
 * Notifications), each drawn when the server has its events for this person, with its push switch as saved;
 * locked events are left out — they reach the phone whatever is chosen. "A case changes at the carrier" has no
 * server event, so it is not drawn.
 * Turn on alerts saves the switches, then asks the phone; Not now asks nothing (Settings › Notifications
 * changes it later).
 */
export default function TurnOnAlerts() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api, finishSetup } = useSession();
  const prefs = useLoad(() => api<PrefsAnswer>(PREFS_PATH), []);
  const [wanted, setWanted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const events = (prefs.data?.events ?? []).filter((e) => !e.protected);
  const kinds = alertKinds(events, { callbackMinutes: prefs.data?.callbackReminderMinutes });

  async function turnOn() {
    setBusy(true);
    try {
      for (const body of pushChanges(events, wanted)) await api(PREFS_PATH, { method: "PUT", body });
    } catch (e) {
      Alert.alert("Not all saved", `${e instanceof ApiError ? e.message : "Try again."} Change it any time in Settings › Notifications.`);
    }
    try {
      await registerForPush(api);
    } finally {
      setBusy(false);
      finishSetup("alerts");
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.canvas }} contentContainerStyle={{ paddingTop: insets.top + 30, paddingBottom: insets.bottom + 24, paddingHorizontal: 20, gap: 16 }} showsVerticalScrollIndicator={false}>
      <View style={{ width: 60, height: 60, borderRadius: 16, backgroundColor: p.greenSoft, alignItems: "center", justifyContent: "center" }}>
        <Icon name="bell" size={30} color={p.greenInk} />
      </View>
      <View>
        <Text accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 28, lineHeight: 33, letterSpacing: -0.56, color: p.ink }}>Know the moment it matters</Text>
        <Text style={{ marginTop: 6, fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.muted }}>Pick what reaches your phone. You can change this any time in Settings › Notifications.</Text>
      </View>
      {prefs.loading && !prefs.data ? <Skeleton rows={4} /> : kinds.length ? (
        <Card pad={false} style={{ overflow: "hidden" }}>
          {kinds.map((k, i) => {
            // A row that stands for two events sets both; it reads on while the first is wanted on.
            const on = wanted[k.events[0].key] ?? k.on;
            return (
              <Row key={k.id} testID={`alert-kind-${k.events[0].key}`} first={i === 0} icon={k.icon} iconTone={k.tone} title={k.label} meta={k.meta}
                right={<Toggle label={k.label} value={on} onChange={(v) => setWanted((w) => ({ ...w, ...Object.fromEntries(k.events.map((e) => [e.key, v])) }))} />} />
            );
          })}
        </Card>
      ) : null}
      <Button testID="alerts-turn-on" label="Turn on alerts" onPress={() => void turnOn()} busy={busy} />
      <TextLink label="Not now" onPress={() => finishSetup("alerts")} />
    </ScrollView>
  );
}
