import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { Failed, F, Group, Header, IOS, Loading, Row, Screen, Toggle } from "@/components/ui";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { usePartnerSession } from "./session";
import type { PartnerAlertEvent, PartnerAlertSettings } from "./types";

/**
 * Account › Notifications (board K4's "Notifications" row): what this person is told about, from the partner
 * portal's own alert settings (GET /api/partner/notifications; PATCH saves the whole set, the route's own
 * rule). The words are the web's partner preferences' (components/partner/partner-notification-preferences.tsx),
 * with Account changes and Do not disturb, which the web keeps in its alert controls. Each switch saves at once.
 */
const EVENTS: [PartnerAlertEvent, string][] = [
  ["lead_status_changed", "Lead status updates"],
  ["partner_message", "New messages"],
  ["team_access_changed", "Team invitation activity"],
  ["partner_account_changed", "Account changes"],
];

export function PartnerNotifications() {
  const p = usePalette();
  const { api } = usePartnerSession();
  const data = useLoad(() => api<{ settings: PartnerAlertSettings }>("/api/partner/notifications").then((a) => a.settings), []);
  const [draft, setDraft] = useState<PartnerAlertSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/partner/account" as never));
  const header = <Header title="Notifications" large={false} back={IOS ? "Account" : undefined} onBack={back} />;

  if (data.loading && !data.data) return <Screen header={header}><Loading rows={5} /></Screen>;
  if (data.error && !data.data) return <Screen header={header}><Failed message={data.error} onRetry={data.refresh} what="your notification settings" /></Screen>;
  const settings = draft ?? data.data!;

  const save = async (next: PartnerAlertSettings) => {
    const before = settings;
    setDraft(next);
    setError(null);
    try {
      const r = await api<{ settings: PartnerAlertSettings }>("/api/partner/notifications", { method: "PATCH", body: next });
      setDraft(r.settings);
    } catch (e) {
      setDraft(before);
      setError(e instanceof Error ? e.message : "That didn’t save. Try again.");
    }
  };

  return (
    <Screen header={header}>
      <Group title="Tell me about">
        {EVENTS.map(([key, label], i) => (
          <Row key={key} testID={`alert-${key}`} first={i === 0} title={label} chevron={false}
            right={<Toggle label={label} value={settings.enabled_events[key]} onChange={(v) => void save({ ...settings, enabled_events: { ...settings.enabled_events, [key]: v } })} />} />
        ))}
      </Group>
      <Group>
        <Row first testID="alert-dnd" title="Do not disturb" meta="Hold every alert until you turn this off" chevron={false}
          right={<Toggle label="Do not disturb" value={settings.do_not_disturb} onChange={(v) => void save({ ...settings, do_not_disturb: v })} />} />
      </Group>
      {error ? <View style={{ paddingHorizontal: 16 }}><Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{error}</Text></View> : null}
    </Screen>
  );
}
