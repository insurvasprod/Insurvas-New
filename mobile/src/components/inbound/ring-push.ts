/**
 * Board C2 · A transfer rings, outside the app (2026-11-26): the lock-screen notification's buttons.
 * Pure, so tested (components/inbound/__tests__/ring-push.test.ts); lib/push.ts registers the two
 * categories and carries out what `pushAction` decides.
 *
 *   transfer  Take call · Pass         Take call claims it on the server (the same race-safe claim as
 *                                      the in-app ringer) and opens Caller profile; Pass only clears it
 *                                      from this phone — the caller keeps waiting for everyone else.
 *   callback  Open · Snooze 10 min     Open goes where the alert links; Snooze rings it again here in
 *                                      ten minutes (a local notification; the callback is unchanged).
 *
 * What JS cannot do (needs a development build with native code): Android's full-screen call-style
 * notification over the lock screen (a full-screen intent) and iOS's Live Activity. The buttons show when the
 * server's push names its category (`categoryId`, set by lib/push/rules.ts `pushButtons` from the alert's kind).
 * Take call claims only the transfer the push names (`pushWorkItem`); without one, lib/push.ts opens Calls.
 */
export const RING_CATEGORIES = {
  transfer: [
    { identifier: "take", buttonTitle: "Take call", options: { opensAppToForeground: true } },
    { identifier: "pass", buttonTitle: "Pass", options: { opensAppToForeground: false, isDestructive: true } },
  ],
  callback: [
    { identifier: "open", buttonTitle: "Open", options: { opensAppToForeground: true } },
    { identifier: "snooze", buttonTitle: "Snooze 10 min", options: { opensAppToForeground: false } },
  ],
} as const;

export const SNOOZE_SECONDS = 600;

export type PushData = Record<string, unknown> | undefined;
export type PushDecision =
  | { kind: "claim"; workItemId: string | null }
  | { kind: "dismiss" }
  | { kind: "snooze"; seconds: number }
  | { kind: "open"; href: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The transfer a push names: data.workItemId, or the call page in its link (/app/inbound/call/<id>). */
export function pushWorkItem(data: PushData): string | null {
  const direct = typeof data?.workItemId === "string" ? data.workItemId : typeof data?.work_item_id === "string" ? data.work_item_id : null;
  if (direct && UUID.test(direct)) return direct;
  const href = typeof data?.href === "string" ? data.href : "";
  const m = /^\/app\/inbound\/call\/([0-9a-f-]{36})(?:[?#/]|$)/i.exec(href);
  return m && UUID.test(m[1]) ? m[1] : null;
}

/** What a tapped button (or the notification itself) does. Unknown buttons open, like a tap. */
export function pushAction(actionIdentifier: string, data: PushData): PushDecision {
  if (actionIdentifier === "take") return { kind: "claim", workItemId: pushWorkItem(data) };
  if (actionIdentifier === "pass") return { kind: "dismiss" };
  if (actionIdentifier === "snooze") return { kind: "snooze", seconds: SNOOZE_SECONDS };
  return { kind: "open", href: typeof data?.href === "string" ? data.href : null };
}
