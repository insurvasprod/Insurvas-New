import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import * as Device from "expo-device";
import { router, Stack } from "expo-router";

import { Button, Chip, Empty, F, Failed, Group, Header, Loading, Row, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { ago } from "@/lib/format";
import { currentRefreshToken, useSession } from "@/lib/session";
import type { SessionRow } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board J3c · Signed-in devices. Every place you're signed in, this phone marked; sign out a lost
 * phone from anywhere, or every other session at once. (The board's "trusted till 24 Dec" is not drawn: a
 * trusted-device pass lives in that browser's cookie, and the server keeps no end date per session.)
 */
export default function Devices() {
  const p = usePalette();
  const { api, adoptTokens } = useSession();
  const list = useLoad(() => api<{ sessions: SessionRow[] | null; available: boolean }>("/api/app/profile/sessions"), []);
  const [busy, setBusy] = useState<string | null>(null);

  async function end(id: string | null) {
    setBusy(id ?? "all");
    try {
      const refresh = await currentRefreshToken();
      if (!refresh) throw new ApiError(401, { error: "Sign in again." });
      const answer = await api<{ ok: boolean; access?: string; refresh?: string; expiresAt?: number }>("/api/app/auth/mobile/sessions", { method: "POST", body: id ? { action: "end", id, refresh } : { action: "end_others", refresh } });
      // Ending the others moves the session version: this phone gets tokens for its re-issued session.
      if (answer.access && answer.refresh && answer.expiresAt) await adoptTokens({ access: answer.access, refresh: answer.refresh, expiresAt: answer.expiresAt });
      await list.reload();
    } catch (e) {
      Alert.alert("Not signed out", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setBusy(null);
    }
  }

  // This phone first (board J3c), then the most recently used.
  const sessions = [...(list.data?.sessions ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  const others = sessions.filter((s) => !s.current);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen header={<Header title="Signed-in devices" back="Settings" onBack={router.back} large />} onRefresh={list.refresh} refreshing={list.refreshing}>
        {list.loading && !list.data ? <Loading rows={3} /> : list.error && !list.data ? <Failed message={list.error} onRetry={list.reload} /> : !list.data?.available ? <Empty icon="smartphone" title="Not available yet" /> : (
          <>
            <Group>
              {sessions.map((s, i) => (
                <Row key={s.id} testID={`device-${s.id}`} first={i === 0} icon={/app|iPhone|iPad|Android|Pixel/i.test(s.device) ? "smartphone" : "laptop"} title={s.current ? `${Device.modelName ?? s.device} · this phone` : s.device}
                  meta={[s.location, s.current ? "now" : ago(s.lastSeenAt)].filter(Boolean).join(" · ")}
                  chip={s.current ? <Chip tone="ok">This one</Chip> : busy === s.id ? <ActivityIndicator color={p.bad} /> : (
                    <Pressable testID={`device-sign-out-${s.id}`} accessibilityRole="button" accessibilityLabel={`Sign out ${s.device}`} disabled={Boolean(busy)} hitSlop={8}
                      onPress={() => Alert.alert("Sign out this device?", `${s.device} will be signed out on its next step.`, [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => void end(s.id) }])}>
                      <Text style={{ fontFamily: F.s, fontSize: 14, color: p.bad }}>Sign out</Text>
                    </Pressable>
                  )} />
              ))}
            </Group>
            {/* Board J3c: always there; with nowhere else signed in there is nothing for it to do. */}
            <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
              <Button testID="devices-sign-out-others" kind="outline" icon="logout" label="Sign out everywhere else" busy={busy === "all"} disabled={Boolean(busy) || !others.length}
                onPress={() => Alert.alert("Sign out everywhere else?", "Every other phone and browser is signed out now. This phone stays signed in.", [{ text: "Cancel", style: "cancel" }, { text: "Sign them out", style: "destructive", onPress: () => void end(null) }])} />
            </View>
          </>
        )}
      </Screen>
    </>
  );
}
