import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

/**
 * Board C9 "Remind me 5 minutes before": a reminder this phone keeps for itself (a local notification),
 * set when the callback is saved. The server stores no reminder preference, so it lives on the phone
 * that booked it; the server's own "callback due" alert is unchanged.
 *
 * Answers whether the reminder was set: false when notifications are off for the app, the time is
 * less than five minutes away, or the platform cannot schedule one (the web).
 */
export const REMIND_BEFORE_MS = 5 * 60_000;

export async function remindBefore(at: Date, customerName: string, theirTime: string, now = Date.now()): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const fireAt = at.getTime() - REMIND_BEFORE_MS;
  if (!Number.isFinite(fireAt) || fireAt <= now) return false;
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: { title: "Callback in 5 minutes", body: `${customerName} · ${theirTime}` },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(fireAt) },
    });
    return true;
  } catch {
    return false;
  }
}

type CallbackApi = <T>(path: string, init?: { method?: "POST" | "PATCH"; body?: unknown }) => Promise<T>;

/**
 * Board C9's two switches, after the server booked the callback: "Anyone on the team can take it" hands it to the
 * queue (PATCH /api/app/callbacks hand_over → queue, the web Callbacks page's own action; the lead's open callback is
 * read when the booking's answer didn't name it) and "Remind me 5 minutes before" sets this phone's reminder.
 * Answers what didn't happen ("not handed to the team", "no reminder set"); the booking stands either way.
 */
export async function afterBooking(api: CallbackApi, o: {
  leadId: string; callbackId?: string | null; team: boolean; remind: boolean; at: Date; customerName: string; theirTime: string;
}): Promise<string[]> {
  const missed: string[] = [];
  if (o.team) {
    const handed = await (async () => {
      const id = o.callbackId ?? (await api<{ lead: { open: { id: string } | null } }>(`/api/app/callbacks?lead_id=${o.leadId}`)).lead.open?.id ?? null;
      if (!id) return false;
      await api("/api/app/callbacks", { method: "PATCH", body: { action: "hand_over", callback_ids: [id], to: "queue" } });
      return true;
    })().catch(() => false);
    if (!handed) missed.push("not handed to the team");
  }
  if (o.remind && !(await remindBefore(o.at, o.customerName, o.theirTime))) missed.push("no reminder set");
  return missed;
}
