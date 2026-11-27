import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CouldntLoad, Skeleton } from "@/components/states/states";
import { Chip, F, Group, Row } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { countWords } from "@/lib/answer-state";
import { currentRefreshToken, useSession } from "@/lib/session";
import type { Workspace } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board A7 · Pick a workspace, once, after the first sign-in of someone in more than one place. The
 * list is the server's (/api/app/auth/workspaces: name and role); the one this sign-in opened is marked.
 * Picking another re-issues the session for it (switch-workspace) — the server decides membership and
 * suspension. Switch later from Settings (J5).
 */
export default function PickWorkspace() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api, adoptTokens, finishSetup } = useSession();
  const list = useLoad(() => api<{ workspaces: Workspace[] }>("/api/app/auth/workspaces"), []);
  const [busy, setBusy] = useState<string | null>(null);
  const workspaces = list.data?.workspaces ?? [];

  async function pick(w: Workspace) {
    if (busy) return;
    if (w.current) { finishSetup("workspace"); return; }
    setBusy(w.tenantId);
    try {
      const refresh = await currentRefreshToken();
      if (!refresh) throw new ApiError(401, { error: "Sign in again." });
      const t = await api<{ access: string; refresh: string; expiresAt: number }>("/api/app/auth/mobile/switch-workspace", { method: "POST", body: { tenantId: w.tenantId, refresh } });
      await adoptTokens(t);
      finishSetup("workspace");
    } catch (e) {
      Alert.alert("Not switched", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.canvas }} contentContainerStyle={{ paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <Text accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 28, lineHeight: 33, letterSpacing: -0.56, color: p.ink }}>Where are you working?</Text>
        {workspaces.length ? <Text style={{ marginTop: 6, fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.muted }}>{`You have access to ${countWords(workspaces.length, "place")}.`}</Text> : null}
      </View>
      {list.loading && !list.data ? <Skeleton rows={2} /> : list.error && !list.data ? <CouldntLoad what="your workspaces" message={list.error} onRetry={list.reload} /> : (
        <Group title="Agencies">
          {workspaces.map((w, i) => (
            <Row key={w.tenantId} testID={`pick-${w.tenantId}`} first={i === 0} icon="building" title={w.name} meta={w.roleLabel}
              chip={busy === w.tenantId ? <ActivityIndicator color={p.greenInk} /> : w.current ? <Chip tone="brand">Last used</Chip> : undefined}
              onPress={() => void pick(w)} />
          ))}
        </Group>
      )}
    </ScrollView>
  );
}
