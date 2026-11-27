/**
 * Push to the phone app (2026-11-24) — pure rules, shared by the sender, the route and the tests.
 *
 * The owner's rule (no notices on the page) makes the bell the one place alerts land. On the phone the
 * bell is the Inbox tab and push: every bell alert that names a person also goes to that person's
 * phones, with the same words and a link to the same place.
 */

export type PushPlatform = "ios" | "android";

/** Expo push tokens look like ExponentPushToken[xxxx] (or ExpoPushToken[xxxx]). */
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && token.length <= 300 && /^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{8,}\]$/.test(token);
}

/** The Expo API takes at most 100 messages a request. */
export const PUSH_BATCH = 100;

export function chunk<T>(items: T[], size = PUSH_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Android channels the app creates at start. A channel the phone does not have drops the alert, so only these. */
export const PUSH_CHANNELS = { calls: "calls", default: "default" } as const;
export type PushChannel = (typeof PUSH_CHANNELS)[keyof typeof PUSH_CHANNELS];

/** Alerts that must ring through: a transfer waiting, a callback due now. Everything else is a normal alert. */
// new_unclaimed_lead is the intake alert Settings › Inbound calls "new transfer" (alertNewTransfer).
const URGENT = /transfer|inbound|callback_due|callback-due|live_transfer|new_unclaimed_lead/i;

export type PushInput = { title: string; body?: string | null; href?: string | null; category?: string | null; notificationId?: string | null };

export type ExpoMessage = {
  to: string;
  title: string;
  body?: string;
  data: { href: string | null; notificationId: string | null; category: string | null };
  sound: "default" | null;
  priority: "high" | "normal";
  channelId: PushChannel;
  /** The phone's button set (ring-push.ts RING_CATEGORIES). */
  categoryId?: "transfer" | "callback";
};

/**
 * One alert as an Expo message. Text is trimmed to what a lock screen shows; the link must be an app
 * path (/app/...), so a push can never carry the phone somewhere else.
 */
export function toExpoMessage(token: string, input: PushInput): ExpoMessage {
  const urgent = URGENT.test(input.category ?? "");
  const href = typeof input.href === "string" && input.href.startsWith("/app/") ? input.href.slice(0, 500) : null;
  const body = (input.body ?? "").trim().slice(0, 178);
  return {
    to: token,
    title: input.title.trim().slice(0, 80) || "Insurvas",
    ...(body ? { body } : {}),
    data: { href, notificationId: input.notificationId ?? null, category: input.category ?? null },
    sound: urgent ? "default" : null,
    priority: urgent ? "high" : "normal",
    channelId: urgent ? PUSH_CHANNELS.calls : PUSH_CHANNELS.default,
    // Board C2 (2026-11-26): the phone's lock-screen buttons (mobile/src/components/inbound/ring-push.ts):
    // a transfer gets Take call · Pass, a due callback Open · Snooze 10 min.
    ...(pushButtons(input.category) ? { categoryId: pushButtons(input.category)! } : {}),
  };
}

/** The phone's notification button set for an alert category, if it has one. */
export function pushButtons(category: string | null | undefined): "transfer" | "callback" | null {
  if (/callback_due|callback-due/i.test(category ?? "")) return "callback";
  if (/transfer|inbound|live_transfer|new_unclaimed_lead/i.test(category ?? "")) return "transfer";
  return null;
}

/** Tokens Expo's tickets say are gone, in send order. */
export function unregisteredFromTickets(tokens: string[], tickets: unknown): string[] {
  if (!Array.isArray(tickets)) return [];
  return tickets.flatMap((t, i) => {
    const ticket = t as { status?: string; details?: { error?: string } };
    return ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered" && tokens[i] ? [tokens[i]] : [];
  });
}
