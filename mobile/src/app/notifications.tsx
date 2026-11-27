import { useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";

import { ChoiceSheet } from "@/components/menu/choice-sheet";
import { LoadState, useBarMarks } from "@/components/states/states";
import { Group, Header, Row, Screen, Toggle } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clockWords } from "@/lib/answer-state";
import { boardGroups, PREFS_PATH, QUIET_TIMES, rowChanges, type BoardPref, type PrefsAnswer, type Quiet } from "@/lib/notification-prefs";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/**
 * Board H4 · Notification settings: per kind of alert, whether it reaches this phone (the push channel of the
 * web's Settings › Notifications, LA-8.4), in the board's groups and with its row names (lib/notification-prefs
 * `boardGroups`: exactly the board's rows, each drawn when the server has its events for this person; a row that
 * stands for two events saves both; locked ones show on and can't be switched off).
 * Quiet hours are set here: on or off, and the start and end, in half hours. They hold back push, never the
 * Inbox; locked alerts ignore them. The board's "Let transfers through" is not drawn: quiet hours are one on/off
 * and two times on the server (user_notification_settings), with no exception to save, and the transfer alert is
 * held back with the rest.
 */
type Sheet = null | "quiet" | "start" | "end";

export default function Notifications() {
  const { api } = useSession();
  const marks = useBarMarks();
  const prefs = useLoad(() => api<PrefsAnswer>(PREFS_PATH), []);
  const [saving, setSaving] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);

  async function save(body: Record<string, unknown> | Record<string, unknown>[], key: string) {
    setSaving(key);
    try {
      for (const one of Array.isArray(body) ? body : [body]) {
        const next = await api<PrefsAnswer>(PREFS_PATH, { method: "PUT", body: one });
        prefs.setData(next);
      }
    } catch (e) {
      Alert.alert("Not saved", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setSaving(null);
    }
  }

  const data = prefs.data;
  const q = data?.quiet;
  const saveQuiet = (patch: Partial<Quiet>) => { if (q) void save({ quiet: { ...q, ...patch } }, "quiet"); };
  return (
    <>
      <Screen onRefresh={prefs.refresh} refreshing={prefs.refreshing}
        header={<Header title="Notifications" back="Settings" onBack={router.back} large actions={marks} />}>
        <LoadState loading={prefs.loading} hasData={Boolean(data)} error={prefs.error} errorCode={prefs.errorCode} onRetry={prefs.reload} what="your notification settings" />
        {data ? boardGroups(data.events, { callbackMinutes: data.callbackReminderMinutes }).map((g) => (
          <Group key={g.title} title={g.title}>
            {g.rows.map((r: BoardPref, i) => (
              <Row key={r.id} testID={`pref-${r.events[0].key}`} first={i === 0} title={r.label} meta={r.meta}
                right={<Toggle label={r.label} value={r.on} disabled={r.locked} onChange={(v) => { const body = rowChanges(r, v); if (!r.locked && saving !== r.id && body.length) void save(body, r.id); }} />} />
            ))}
          </Group>
        )) : null}
        {data && data.available && q ? (
          <Group title="Quiet hours" footer="Alerts still wait in the Inbox during quiet hours.">
            <Row first testID="pref-quiet" title={`From ${clockWords(q.start)} to ${clockWords(q.end)}`} right={q.enabled ? "On" : "Off"} onPress={() => setSheet("quiet")} />
          </Group>
        ) : null}
      </Screen>
      {q ? (
        <>
          <ChoiceSheet visible={sheet === "quiet"} title="Quiet hours" selected={[]} onClose={() => setSheet(null)}
            onPick={(key) => { if (key === "toggle") saveQuiet({ enabled: !q.enabled }); else setTimeout(() => setSheet(key as Sheet), 0); }}
            options={[
              { key: "toggle", label: q.enabled ? "Turn quiet hours off" : "Turn quiet hours on" },
              { key: "start", label: `Starts at ${clockWords(q.start)}` },
              { key: "end", label: `Ends at ${clockWords(q.end)}` },
            ]} />
          <ChoiceSheet visible={sheet === "start"} title="Quiet hours start" selected={[q.start]} onClose={() => setSheet(null)}
            onPick={(t) => saveQuiet({ start: t })} options={QUIET_TIMES.map((t) => ({ key: t, label: clockWords(t) }))} />
          <ChoiceSheet visible={sheet === "end"} title="Quiet hours end" selected={[q.end]} onClose={() => setSheet(null)}
            onPick={(t) => saveQuiet({ end: t })} options={QUIET_TIMES.map((t) => ({ key: t, label: clockWords(t) }))} />
        </>
      ) : null}
    </>
  );
}
