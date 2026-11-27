import { Platform } from "react-native";

import { productName } from "@/components/inbound/model";
import type { Floor } from "@/components/inbound/types";

/**
 * Board L2 · A call in progress. One model for both calls the board names, each from the server's own record:
 *
 *   transfer  the floor's open call for you (GET /api/app/agent-floor: members[me].call and its onCalls row)
 *   dialer    your dialer call that was placed and has no outcome yet (GET /api/app/widget/call)
 *
 * The in-app card (components/inbound/on-call-bar.tsx) and Android's ongoing notification both draw it, and both
 * stop when the outcome is saved (the server then answers no open call). Pure parts are tested in
 * __tests__/ongoing-call.test.ts.
 */

/** GET /api/app/widget/call. */
export type DialCall = {
  attemptId: string; leadId: string; customer: string; state: string | null; productCode: string | null;
  attemptNumber: number | null; disclosureRead: boolean; startedAt: string;
};
export type DialCallAnswer = { call: DialCall | null };

export type OngoingCall = {
  kind: "transfer" | "dialer";
  /** The transfer's work item, or the dialer attempt. */
  id: string;
  leadId: string;
  customer: string;
  /** Board L2's second line: "Term life · TX · attempt 3 · disclosure read". */
  line: string;
  startedAt: string;
};

const stateOf = (s: string | null | undefined) => (s && s !== "—" ? s : null);

/** The call in progress for this person: a transfer first (it is the live one), else a placed dialer call. */
export function ongoingCall(floor: Floor | null | undefined, dial: DialCallAnswer | null | undefined, userId: string | null | undefined): OngoingCall | null {
  const mine = userId ? floor?.members.find((m) => m.id === userId && m.call) ?? null : null;
  if (mine?.call) {
    const call = mine.call;
    const detail = floor?.onCalls.find((c) => c.id === call.workItemId) ?? null;
    const line = [
      productName(detail?.productLine), stateOf(detail?.state), call.partnerName ? `from ${call.partnerName}` : null,
      detail?.verificationPercent != null ? `verification ${Math.round(detail.verificationPercent)}% done` : null,
    ].filter(Boolean).join(" · ");
    return { kind: "transfer", id: call.workItemId, leadId: call.leadId, customer: call.customer, line, startedAt: call.startedAt };
  }
  const d = dial?.call ?? null;
  if (!d) return null;
  const line = [productName(d.productCode), stateOf(d.state), d.attemptNumber ? `attempt ${d.attemptNumber}` : null, d.disclosureRead ? "disclosure read" : null].filter(Boolean).join(" · ");
  return { kind: "dialer", id: d.attemptId, leadId: d.leadId, customer: d.customer, line, startedAt: d.startedAt };
}

// ─── the card's three moves, from the card or the notification ──────────────────────────────────────────────────

export type OngoingMove = "outcome" | "note" | "callback";
export const ONGOING_MOVES: { id: OngoingMove; label: string }[] = [
  { id: "outcome", label: "Outcome" },
  { id: "note", label: "Add a note" },
  { id: "callback", label: "Callback" },
];
const CALLBACK_OUTCOME = "callback_scheduled";

/**
 * Where a move goes. A transfer's Outcome and Callback are the call page's Finish step (Callback with the callback
 * outcome chosen); everything else opens Calls, whose card takes the move (`oncall=`). Calls is reached through the
 * phone's tabs by the caller (a setter's Dialer tab), never assumed.
 */
export function moveHref(call: Pick<OngoingCall, "kind" | "id">, move: OngoingMove | null): string {
  if (call.kind === "transfer") {
    if (move === "outcome") return `/call/${call.id}?phase=finish`;
    if (move === "callback") return `/call/${call.id}?phase=finish&outcome=${CALLBACK_OUTCOME}`;
    if (move === "note") return "/calls?part=incoming&oncall=note";
    return `/call/${call.id}`;
  }
  return move ? `/calls?part=dialer&oncall=${move}` : "/calls?part=dialer";
}

// ─── Android's ongoing notification ─────────────────────────────────────────────────────────────────────────────

export const ONGOING_ID = "call-in-progress";
export const ONGOING_CHANNEL = "call-in-progress";
export const ONGOING_CATEGORY = "call-in-progress";

/** The notification's data: what lib/push.ts reads when it is tapped (`href` is a web path, as every push's). */
export type OngoingData = { ongoing: true; kind: OngoingCall["kind"]; id: string; leadId: string; href: string };

export function ongoingData(call: OngoingCall): OngoingData {
  // Without lib/push.ts reading `ongoing`, a tap still lands on Calls, where the card is: both web paths map there.
  return { ongoing: true, kind: call.kind, id: call.id, leadId: call.leadId, href: call.kind === "transfer" ? `/app/inbound/call/${call.id}` : "/app/dialer" };
}

/**
 * For lib/push.ts's tap handler: the app route a tap on the ongoing notification (or one of its buttons) opens, or
 * null when the push is not this notification.
 */
export function ongoingCallHref(actionIdentifier: string, data: Record<string, unknown> | null | undefined): string | null {
  if (!data || data.ongoing !== true || typeof data.id !== "string") return null;
  const kind = data.kind === "transfer" ? "transfer" : data.kind === "dialer" ? "dialer" : null;
  if (!kind) return null;
  const move = ONGOING_MOVES.find((m) => m.id === actionIdentifier)?.id ?? null;
  return moveHref({ kind, id: data.id }, move);
}

/** What the notification says. Android's header already reads "Insurvas · <time posted>". */
export function ongoingContent(call: OngoingCall) {
  return {
    title: call.customer,
    subtitle: "on a call",
    body: call.line || undefined,
    data: ongoingData(call),
    categoryIdentifier: ONGOING_CATEGORY,
    sticky: true,
    autoDismiss: false,
    sound: false as const,
  };
}

/** The key that changes only when what the notification says changes (not every second of the call). */
export function ongoingKey(call: OngoingCall | null): string {
  return call ? [call.kind, call.id, call.customer, call.line].join("|") : "";
}

type NotificationsModule = typeof import("expo-notifications");
let shown = "";
let prepared: Promise<void> | null = null;

function notifications(): NotificationsModule | null {
  if (Platform.OS !== "android") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-notifications") as NotificationsModule;
  } catch {
    return null;
  }
}

/** A quiet channel (no sound, no heads-up) and the three buttons, once per launch. */
function prepare(N: NotificationsModule): Promise<void> {
  prepared ??= (async () => {
    await N.setNotificationChannelAsync(ONGOING_CHANNEL, {
      name: "Call in progress", importance: N.AndroidImportance.LOW, sound: null, vibrationPattern: null, enableVibrate: false,
      showBadge: false, lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
    });
    await N.setNotificationCategoryAsync(ONGOING_CATEGORY, ONGOING_MOVES.map((m) => ({ identifier: m.id, buttonTitle: m.label, options: { opensAppToForeground: true } })));
  })().catch(() => { prepared = null; });
  return prepared;
}

/**
 * Show, update or clear Android's ongoing notification for this call (null clears it). Posts only when the words
 * change. Android only; never throws (a notification that can't be drawn is never the call's failure). It shows only
 * when the person allowed notifications; nothing here asks.
 */
export async function syncOngoingNotification(call: OngoingCall | null): Promise<void> {
  const N = notifications();
  if (!N) return;
  const key = ongoingKey(call);
  if (key === shown) return;
  shown = key;
  try {
    if (!call) {
      await N.dismissNotificationAsync(ONGOING_ID);
      return;
    }
    await prepare(N);
    await N.scheduleNotificationAsync({ identifier: ONGOING_ID, content: ongoingContent(call), trigger: { channelId: ONGOING_CHANNEL } });
  } catch {
    shown = "";
  }
}

/**
 * For the dialer's call sheet, the moment the server accepted the click and before the phone's dialer opens (the app
 * may not run again until the call ends): post the notification from the answers it already holds — the attempt the
 * server started, its number, the lead's name, state and product, the disclosure it just recorded.
 */
export function showDialCall(call: Omit<DialCall, "disclosureRead" | "startedAt"> & { startedAt?: string }): Promise<void> {
  return syncOngoingNotification(ongoingCall(null, { call: { ...call, disclosureRead: true, startedAt: call.startedAt ?? new Date().toISOString() } }, null));
}

/** Tests only: forget what was shown. */
export function resetOngoingForTests(): void {
  shown = "";
  prepared = null;
}
