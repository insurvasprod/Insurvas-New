import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView } from "react-native";
import { router } from "expo-router";

import { Icon } from "@/components/icon";
import { RouteSheet } from "@/components/menu/route-sheet";
import { Failed, Loading, Row } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { currentRefreshToken, useSession } from "@/lib/session";
import type { Workspace } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board J5 · Switch workspace, a sheet over the screen it was opened from (h 360): grab bar,
 * "Switch workspace", then one row per workspace (building icon, name, role); the open one is tinted
 * with the green check; another workspace says how many of your alerts wait there ("Owner · 2 alerts", the
 * server's count of your own unread alerts). The server decides (membership, suspension); the old session ends.
 * Partner workspaces (the board's handshake row) are not listed: a partner membership signs in to the partner
 * app with its own session.
 */
export default function Workspaces() {
  const p = usePalette();
  const { api, adoptTokens } = useSession();
  const list = useLoad(() => api<{ workspaces: (Workspace & { alerts?: number })[] }>("/api/app/auth/workspaces"), []);
  const [busy, setBusy] = useState<string | null>(null);

  async function open(tenantId: string) {
    setBusy(tenantId);
    try {
      const refresh = await currentRefreshToken();
      if (!refresh) throw new ApiError(401, { error: "Sign in again." });
      const t = await api<{ access: string; refresh: string; expiresAt: number }>("/api/app/auth/mobile/switch-workspace", { method: "POST", body: { tenantId, refresh } });
      await adoptTokens(t);
      router.dismissAll();
      router.replace("/");
    } catch (e) {
      Alert.alert("Not switched", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <RouteSheet title="Switch workspace" minHeight={360} testID="workspaces-sheet">
      {list.loading && !list.data ? <Loading rows={2} /> : list.error && !list.data ? <Failed message={list.error} onRetry={list.reload} /> : (
        <ScrollView>
          {(list.data?.workspaces ?? []).map((w, i) => (
            <Row key={w.tenantId} testID={`workspace-${w.tenantId}`} first={i === 0} icon="building" title={w.name} meta={[w.roleLabel, w.alerts ? `${w.alerts} alert${w.alerts === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")} selected={w.current} chevron={false}
              chip={w.current ? <Icon name="checkC" size={20} color={p.greenInk} /> : busy === w.tenantId ? <ActivityIndicator color={p.greenInk} /> : undefined}
              onPress={w.current || busy ? undefined : () => void open(w.tenantId)} />
          ))}
        </ScrollView>
      )}
    </RouteSheet>
  );
}
