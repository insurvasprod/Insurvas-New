import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";

import { readQueue } from "@/components/applications/answer-queue";
import type { ApplicationRow } from "@/components/applications/types";
import { ChoiceSheet } from "@/components/menu/choice-sheet";
import { DangerRow } from "@/components/menu/danger-row";
import { initialsOf } from "@/components/menu/pages";
import { Avatar, Card, F, Group, Header, IOS, Row, Screen, Toggle } from "@/components/ui";
import { ApiError } from "@/lib/api";
import type { NavCounts } from "@/lib/counts";
import { registerForPush } from "@/lib/push";
import { callsPartsFor, ROLE_LABELS } from "@/lib/roles";
import { hoursToday, type WorkingHours } from "@/lib/work-hours";
import { KEYS, readSecret } from "@/lib/secure";
import { useSession } from "@/lib/session";
import type { SessionRow } from "@/lib/types";
import { setProducerTabs, useProducerTabs } from "@/lib/tab-choice";
import { useLoad } from "@/lib/use-load";
import { widgetsAvailable } from "@/widgets/available";
import { pinWidget } from "@/widgets/sync";
import { setAppearance, useAppearance, usePalette, type AppearanceChoice } from "@/theme/use-palette";

/**
 * Board J3 · Settings on the phone. Only what belongs to you and this phone: your profile, work
 * (taking calls, working hours), sign-in and security, notifications, appearance, what is saved for offline,
 * workspace and sign out. The board's rows are always there; a value the server has not answered shows no
 * figure. Agency settings stay on the computer.
 *
 * Appearance (Dark, Light, System) is this phone's own choice (theme/use-palette). Saved for offline counts the
 * application drafts whose answers wait on this phone for a signal (components/applications/answer-queue).
 */
const APPEARANCE: { key: AppearanceChoice; label: string }[] = [{ key: "dark", label: "Dark" }, { key: "light", label: "Light" }, { key: "system", label: "System" }];
const APPLICATION_ROLES = ["owner", "admin", "producer"];
export default function Settings() {
  const p = usePalette();
  const appearance = useAppearance();
  const [sheet, setSheet] = useState<null | "appearance">(null);
  const { me, api, biometricOn, setBiometricOn, signOut } = useSession();
  const [push, setPush] = useState<"on" | "off" | "denied" | "unavailable">("off");
  const sessions = useLoad(() => api<{ sessions: SessionRow[] | null; available: boolean }>("/api/app/profile/sessions"), []);
  const twoStep = useLoad(() => api<{ enabled: boolean }>("/api/app/profile/two-factor").catch(() => null), []);
  // Work (board J3): taking calls is the inbound presence (/api/app/agent-floor, read from the nav counts);
  // working hours are the person's own week (/api/app/availability). Each shows only when the server answers.
  const takesCalls = callsPartsFor(me?.role, me?.plan?.features).includes("incoming");
  const nav = useLoad(async () => (takesCalls ? api<NavCounts>("/api/app/nav/counts").catch(() => null) : null), [takesCalls]);
  const week = useLoad(() => api<{ members: { userId: string; timezone: string | null; hours: WorkingHours[] }[]; selfUserId: string }>("/api/app/availability").catch(() => null), []);
  // Saved for offline: the drafts this person can open whose answers are still on the phone.
  const appsRole = APPLICATION_ROLES.includes(me?.role ?? "");
  const waiting = useLoad(async () => {
    if (!appsRole) return 0;
    const list = await api<{ applications: ApplicationRow[] }>("/api/app/applications").catch(() => null);
    if (!list) return null;
    const cases = [...new Set(list.applications.filter((r) => r.status === "draft").map((r) => r.caseId))];
    const queued = await Promise.all(cases.map((id) => readQueue(id).then((q) => q.length > 0, () => false)));
    return queued.filter(Boolean).length;
  }, [appsRole]);
  const [presence, setPresence] = useState<string | null>(null);
  const status = presence ?? nav.data?.presence ?? null;
  const own = week.data?.members.find((m) => m.userId === week.data?.selfUserId);
  const hours = own ? hoursToday(own.hours, own.timezone, new Date().getDay()) : null;

  async function setTaking(on: boolean) {
    const next = on ? "ready" : "off";
    setPresence(next);
    try {
      await api("/api/app/agent-floor", { method: "POST", body: { action: "presence", status: next } });
    } catch (e) {
      setPresence(null);
      Alert.alert("Not changed", e instanceof ApiError ? e.message : "Try again.");
    }
  }

  useEffect(() => {
    (async () => {
      if (Platform.OS === "web") { setPush("unavailable"); return; }
      const [perm, token] = await Promise.all([Notifications.getPermissionsAsync(), readSecret(KEYS.pushToken)]);
      setPush(!perm.granted && perm.canAskAgain === false ? "denied" : token ? "on" : "off");
    })();
  }, []);

  /** Board H4. Push not allowed yet: ask the phone first (the A3 question, if Not now was chosen then). */
  async function openNotifications() {
    if (push === "denied") { void Linking.openSettings(); return; }
    if (push === "off") setPush(await registerForPush(api));
    router.push("/notifications" as never);
  }

  const role = me?.memberRole ?? me?.role ?? "";
  const who = me?.user.name ?? me?.user.email ?? "";
  const deviceCount = sessions.data?.available ? sessions.data.sessions?.length : undefined;
  const producerTabs = useProducerTabs();
  // A solo owner already has the tabs of their own work (lib/roles.ts), so there is nothing to switch.
  const ownerTabs = (role === "owner" || role === "admin") && !me?.solo;

  return (
    <>
      {/* The page draws the board's header (back to Menu, the large title), not the stack's. */}
      <Stack.Screen options={{ headerShown: false }} />
      <Screen header={<Header title="Settings" back="Menu" onBack={router.back} large />}>
        <View style={{ paddingHorizontal: 16 }}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Avatar initials={initialsOf(who)} size={64} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 18, color: p.ink }}>{who}</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{[me?.user.email, ROLE_LABELS[role] ?? role].filter(Boolean).join(" · ")}</Text>
              <Pressable testID="settings-edit-profile" accessibilityRole="link" onPress={() => router.push("/profile" as never)} hitSlop={6} style={{ marginTop: 4, alignSelf: "flex-start" }}>
                <Text style={{ fontFamily: F.s, fontSize: 14, color: p.greenInk }}>Edit profile</Text>
              </Pressable>
            </View>
          </Card>
        </View>

        <Group title="Work">
          {takesCalls ? (
            <Row first testID="settings-taking-calls" icon="phoneIn" title="Taking calls" meta="Transfers ring this phone"
              right={<Toggle label="Taking calls" value={status === "ready" || status === "on_call"} onChange={(v) => void setTaking(v)} />} />
          ) : null}
          <Row first={!takesCalls} testID="settings-working-hours" icon="clock" title="Working hours" right={hours ?? undefined}
            onPress={() => router.push({ pathname: "/computer", params: { path: "/app/calendar", title: "Working hours", why: "Your week, blocked time and how appointments book into it." } })} />
          {/* Board J3: an owner who also sells keeps Calls and Leads in the tab bar instead of Team and Money. */}
          {ownerTabs ? (
            <Row testID="settings-producer-tabs" icon="users" title="Use the producer tabs" meta="For owners who also sell"
              right={<Toggle label="Use the producer tabs" value={producerTabs} onChange={(v) => void setProducerTabs(v)} />} />
          ) : null}
        </Group>

        <Group title="Sign-in and security">
          <Row first icon={IOS ? "face" : "finger"} title={IOS ? "Face ID" : "Fingerprint"}
            right={<Toggle label={IOS ? "Face ID" : "Fingerprint"} value={biometricOn} onChange={(v) => void setBiometricOn(v)} />} />
          <Row testID="settings-two-step" icon="lock" title="Two-step sign-in" right={twoStep.data ? (twoStep.data.enabled ? "On" : "Off") : undefined} onPress={() => router.push("/two-step" as never)} />
          <Row testID="settings-devices" icon="laptop" title="Signed-in devices" right={deviceCount !== undefined ? String(deviceCount) : undefined} onPress={() => router.push("/devices")} />
        </Group>

        <Group title="This phone">
          <Row first testID="settings-notifications" icon="bell" title="Notifications"
            meta={push === "denied" ? "Off in the phone’s settings" : push === "unavailable" ? "Needs the installed app" : push === "off" ? "Off on this phone" : null}
            onPress={() => void openNotifications()} />
          <Row testID="settings-appearance" icon="moon" title="Appearance" right={APPEARANCE.find((a) => a.key === appearance)?.label} onPress={() => setSheet("appearance")} />
          <Row testID="settings-offline" icon="download" title="Saved for offline"
            right={waiting.data == null ? undefined : waiting.data === 0 ? "Nothing waiting" : `${waiting.data} draft${waiting.data === 1 ? "" : "s"}`}
            onPress={waiting.data ? () => router.push("/application" as never) : undefined} />
          {/* Board L1: the launcher's own "Add to home screen" card (Android builds with the widget module only). */}
          {widgetsAvailable ? (
            <Row testID="settings-add-widget" icon="grid" title="Add to home screen" meta="Today's callbacks at a glance"
              onPress={() => void pinWidget("Today").then((ok) => { if (!ok) Alert.alert("Not on this launcher", "Long-press your home screen, choose Widgets, then Insurvas."); })} />
          ) : null}
          {widgetsAvailable && ownerTabs ? (
            <Row testID="settings-add-agency-widget" icon="chart" title="Add the agency month" meta="Submitted premium on the home screen"
              onPress={() => void pinWidget("AgencyMonth").then((ok) => { if (!ok) Alert.alert("Not on this launcher", "Long-press your home screen, choose Widgets, then Insurvas."); })} />
          ) : null}
        </Group>

        <Group>
          <Row first testID="settings-workspace" icon="building" title="Switch workspace" right={me?.tenant.name} onPress={() => router.push("/workspaces")} />
          <DangerRow testID="settings-sign-out" icon="logout" title="Sign out"
            onPress={() => Alert.alert("Sign out?", "You’ll need your password, and the code if two-factor is on, to sign in again.", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => void signOut() }])} />
        </Group>
      </Screen>
      <ChoiceSheet visible={sheet === "appearance"} title="Appearance" selected={[appearance]} onClose={() => setSheet(null)}
        onPick={(k) => void setAppearance(k as AppearanceChoice)} options={APPEARANCE} />
    </>
  );
}
