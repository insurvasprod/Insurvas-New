import { useEffect } from "react";
import { Alert, Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";

import { pushAction, RING_CATEGORIES, type PushData } from "@/components/inbound/ring-push";
import { ONGOING_ID, ongoingCallHref } from "@/components/native/ongoing-call";

import { ApiError } from "./api";
import { appHrefFor, currentTabs, reachable } from "./links";
import type { ClaimAnswer } from "./types";
import { KEYS, readSecret, writeSecret } from "./secure";
import { useSession } from "./session";

/**
 * Push (2026-11-24). The bell is the one place alerts land; on the phone the bell is the Inbox tab and
 * push. Transfers and callbacks due ring through the "calls" channel; everything else is quiet.
 * A tapped push opens the exact screen its bell row links to.
 *
 * Board C2 (2026-11-26): the "calls" channel shows on the lock screen in full, and two categories give
 * the lock-screen buttons — a transfer's Take call / Pass and a callback's Open / Snooze 10 min
 * (components/inbound/ring-push.ts decides what each does). A full-screen call-style notification needs
 * a development build; this is what JS can do.
 */
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    // Board L2: the ongoing-call notification sits quietly in the shade; everything else alerts as before.
    handleNotification: async (n) => (n.request.identifier === ONGOING_ID
      ? { shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }
      : { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

async function ensureChannels() {
  if (Platform.OS !== "android") return;
  // AndroidImportance is a re-exported enum the import plugin can't follow; tsc checks it.
  /* eslint-disable import/namespace */
  await Notifications.setNotificationChannelAsync("calls", { name: "Transfers and callbacks", importance: Notifications.AndroidImportance.MAX, sound: "default", vibrationPattern: [0, 250, 250, 250], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC });
  await Notifications.setNotificationChannelAsync("default", { name: "Alerts", importance: Notifications.AndroidImportance.DEFAULT });
  /* eslint-enable import/namespace */
}

/** The lock-screen buttons (C2). Both platforms; a push uses them when it names the category. */
async function ensureCategories() {
  if (Platform.OS === "web") return;
  await Promise.all(Object.entries(RING_CATEGORIES).map(([id, actions]) =>
    Notifications.setNotificationCategoryAsync(id, actions.map((a) => ({ identifier: a.identifier, buttonTitle: a.buttonTitle, options: { ...a.options } }))).catch(() => null)));
}

/** Ask once after sign-in, then tell the server where to reach this phone. Quietly does nothing on web or without an EAS project. */
export async function registerForPush(api: <T>(path: string, init?: { method?: "POST" | "DELETE"; body?: unknown }) => Promise<T>): Promise<"on" | "denied" | "unavailable"> {
  if (Platform.OS === "web") return "unavailable";
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return "unavailable";
  await ensureChannels();
  await ensureCategories();
  const current = await Notifications.getPermissionsAsync();
  const asked = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!asked.granted) return "denied";
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api("/api/app/push-devices", { method: "POST", body: { token, platform: Platform.OS === "ios" ? "ios" : "android" } });
    await writeSecret(KEYS.pushToken, token);
    return "on";
  } catch {
    return "unavailable";
  }
}

/**
 * Re-tells the server where to reach this phone, only when the person already allowed alerts. The
 * question itself is asked once by board A3 (Turn on alerts) or from Settings, never on its own.
 */
export async function registerIfAllowed(api: <T>(path: string, init?: { method?: "POST" | "DELETE"; body?: unknown }) => Promise<T>): Promise<void> {
  if (Platform.OS === "web") return;
  const current = await Notifications.getPermissionsAsync().catch(() => null);
  if (current?.granted) await registerForPush(api);
}

export async function turnPushOff(api: <T>(path: string, init?: { method?: "POST" | "DELETE"; body?: unknown }) => Promise<T>) {
  const token = await readSecret(KEYS.pushToken);
  if (token) await api("/api/app/push-devices", { method: "DELETE", body: { token } }).catch(() => undefined);
  await writeSecret(KEYS.pushToken, null);
}

/** Mounted once while signed in: registers this phone and opens the screen a tapped push names. */
export function usePush() {
  const { status, api } = useSession();
  useEffect(() => {
    // The web preview has no push (expo-notifications throws there); phones only.
    if (status !== "signedIn" || Platform.OS === "web") return;
    void registerIfAllowed(api);
    void ensureCategories();
    const open = (data: Record<string, unknown> | undefined) => {
      const href = appHrefFor(typeof data?.href === "string" ? data.href : null, currentTabs()) ?? "/inbox";
      router.push(href as never);
    };
    // C2 Take call: the same race-safe claim as the in-app ringer, then Caller profile. A push that names no
    // transfer is never turned into a claim of someone else (claim-next would take the longest waiting caller,
    // not the one this push rang for): it opens Calls › Incoming, where the caller is claimed by name.
    const take = async (workItemId: string | null) => {
      if (!workItemId) { router.push(reachable("/calls?part=incoming", currentTabs()) as never); return; }
      try {
        const answer = await api<ClaimAnswer>("/api/app/inbound/claim", { method: "POST", body: { work_item_id: workItemId } });
        router.push(`/call/${answer.claim.work_item_id ?? workItemId}` as never);
      } catch (e) {
        router.push(reachable("/calls?part=incoming", currentTabs()) as never);
        Alert.alert("Not claimed", e instanceof ApiError ? e.message : "Try again from Calls.");
      }
    };
    const respond = (r: Notifications.NotificationResponse) => {
      const content = r.notification.request.content;
      // Board L2: the ongoing call's Outcome / Add a note / Callback (and a tap on it) open that move.
      const ongoing = ongoingCallHref(r.actionIdentifier, content.data as Record<string, unknown>);
      if (ongoing) { router.push(reachable(ongoing, currentTabs()) as never); return; }
      const data = content.data as PushData;
      const decision = pushAction(r.actionIdentifier, data);
      if (decision.kind === "claim") void take(decision.workItemId);
      else if (decision.kind === "dismiss") void Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => undefined);
      else if (decision.kind === "snooze") {
        void Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => undefined);
        void Notifications.scheduleNotificationAsync({
          content: { title: content.title ?? "Callback", body: content.body ?? undefined, data: content.data, categoryIdentifier: "callback", sound: "default" },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: decision.seconds, channelId: "calls" },
        }).catch(() => undefined);
      } else open(data);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) { respond(last); Notifications.clearLastNotificationResponse(); }
    const sub = Notifications.addNotificationResponseReceivedListener(respond);
    return () => sub.remove();
  }, [status, api]);
}
