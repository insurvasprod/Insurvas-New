import type { TenantRole } from "../tenantAuth/roles.ts";

/**
 * LA-8.4 (Notion sprint) · the notification event registry. Every alert the product sends an agent
 * is registered here, by the module that sends it, with its defaults — the same mechanism as LA-8.1's
 * settings sections. The preference centre draws whatever is here; adding an event changes no screen.
 *
 * `is_protected` is set here, by the platform, and no tenant can change it. Four events qualify, and
 * the test is narrow on purpose — missing it causes irreversible harm. Adding a fifth needs that
 * test: if a dozen are unmuteable, people filter the whole domain and none of them reach anyone.
 *
 * "push" is the browser (desktop) notification the bell raises while Insurvas is open, for someone who
 * allowed browser alerts — there is no mobile push service. The events that already raised one before
 * LA-8.4 default to on, so nobody loses an alert they had.
 *
 * How email is delivered:
 *   "outbox"  the event's in-app row (agent_notifications, written by TS or SQL) is emailed by the
 *             notifications job (lib/notifications/outbox.ts) according to the person's choice.
 *   "sender"  the module sends its own email and asks shouldEmail() first.
 *
 * Transactional account email — invitations, password resets, security notices (LA-8.2), the
 * client's welcome pack — is not a notification and is not here: it cannot be switched off because
 * it is not a choice.
 */

export type NotificationChannel = "in_app" | "email" | "push";
export type DigestCadence = "immediate" | "daily" | "weekly" | "off";
export const NOTIFICATION_GROUPS = ["Money", "Retention", "Compliance", "Acquisition", "Account"] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export type NotificationEvent = {
  key: string;
  label: string;
  description: string;
  group: NotificationGroup;
  owned_by_module: string;
  defaults: Record<NotificationChannel, boolean>;
  /** High-volume events may be batched into a daily or weekly email instead. */
  supports_digest: boolean;
  is_protected: boolean;
  /** Why it cannot be switched off — shown beside the lock. */
  protected_reason?: string;
  required_feature: string | null;
  /** Who can receive it at all; absent means every role. */
  roles?: readonly TenantRole[];
  /** The agent_notifications kinds that are this event's in-app rows. */
  kinds: readonly string[];
  email: "outbox" | "sender";
};

const OWNER: readonly TenantRole[] = ["owner"];
const on = (in_app: boolean, email: boolean, push = false) => ({ in_app, email, push });

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  // ── Acquisition ──────────────────────────────────────────────────────────────────────────────
  { key: "new_lead", label: "New lead waiting", description: "A lead arrived that nobody has claimed yet.", group: "Acquisition", owned_by_module: "LA-1.23", defaults: on(true, false, true), supports_digest: true, is_protected: false, required_feature: "book_of_business", roles: ["owner", "producer", "assistant"], kinds: ["new_unclaimed_lead"], email: "outbox" },
  { key: "handoff_offered", label: "Handoff offered to you", description: "A colleague asks you to pick up a live caller.", group: "Acquisition", owned_by_module: "LA-1.14", defaults: on(true, false, true), supports_digest: false, is_protected: false, required_feature: null, roles: ["owner", "producer", "assistant"], kinds: ["handoff_offered"], email: "outbox" },
  { key: "unclaimed_escalation", label: "Unclaimed lead escalated", description: "A lead has waited past your response ladder.", group: "Acquisition", owned_by_module: "LA-1.23", defaults: on(true, true, true), supports_digest: false, is_protected: false, required_feature: "book_of_business", roles: OWNER, kinds: ["unclaimed_sla_escalation"], email: "sender" },
  { key: "callback_due", label: "Callback due", description: "A callback you booked is coming up.", group: "Acquisition", owned_by_module: "LA-1.22", defaults: on(true, true, true), supports_digest: false, is_protected: false, required_feature: null, kinds: ["callback_reminder"], email: "sender" },
  { key: "appointment_due", label: "Appointment due", description: "An appointment on your calendar is coming up.", group: "Acquisition", owned_by_module: "LA-2.11", defaults: on(true, true, true), supports_digest: false, is_protected: false, required_feature: null, kinds: ["appointment_reminder"], email: "sender" },
  { key: "mentioned", label: "You were mentioned", description: "Someone named you in a lead note or a partner chat.", group: "Acquisition", owned_by_module: "LA-1.21", defaults: on(true, false, true), supports_digest: true, is_protected: false, required_feature: null, kinds: ["lead_note_mention", "partner_message_mention"], email: "outbox" },
  { key: "partner_message", label: "Partner message", description: "A partner wrote in the shared chat.", group: "Acquisition", owned_by_module: "LA-1.16", defaults: on(true, false, true), supports_digest: true, is_protected: false, required_feature: "inbound_transfers", roles: ["owner", "producer", "assistant", "bookkeeper"], kinds: ["partner_message"], email: "outbox" },
  // ── Money ────────────────────────────────────────────────────────────────────────────────────
  { key: "carrier_status_unmapped", label: "Carrier status needs mapping", description: "A carrier file used a policy status the layout does not know.", group: "Money", owned_by_module: "LA-4.6", defaults: on(false, true), supports_digest: true, is_protected: false, required_feature: "statement_ingestion", roles: ["owner", "bookkeeper"], kinds: [], email: "sender" },
  // ── Retention ────────────────────────────────────────────────────────────────────────────────
  { key: "servicing_failed", label: "Servicing request failed", description: "A billing or payment change for a client did not go through.", group: "Retention", owned_by_module: "LA-5.4", defaults: on(true, true), supports_digest: true, is_protected: false, required_feature: "payment_repair", kinds: ["servicing_failed"], email: "outbox" },
  {
    key: "reinstatement_closing", label: "Reinstatement window closing", description: "A lapsed policy's last chance to be reinstated is close.", group: "Retention", owned_by_module: "LA-5.6",
    defaults: on(true, true, true), supports_digest: false, is_protected: true, protected_reason: "The only deadline in retention that does not come back.", required_feature: "winback", kinds: ["reinstatement_closing"], email: "outbox",
  },
  // ── Compliance ───────────────────────────────────────────────────────────────────────────────
  {
    key: "doi_deadline", label: "DOI complaint deadline", description: "A regulator complaint is close to its statutory response date.", group: "Compliance", owned_by_module: "LA-6.4",
    defaults: on(true, true, true), supports_digest: false, is_protected: true, protected_reason: "Statutory: a missed response escalates toward the licence.", required_feature: "tcpa_checker", kinds: ["doi_deadline"], email: "sender",
  },
  { key: "retention_dry_run", label: "Record purge dry run ready", description: "What the next record purge would delete, for review.", group: "Compliance", owned_by_module: "LA-6.6", defaults: on(false, true), supports_digest: false, is_protected: false, required_feature: "tcpa_checker", roles: OWNER, kinds: [], email: "sender" },
  { key: "compliance_monthly", label: "Monthly compliance summary", description: "The month's consent, screening and complaint figures.", group: "Compliance", owned_by_module: "LA-6.7", defaults: on(false, true), supports_digest: false, is_protected: false, required_feature: "tcpa_checker", roles: OWNER, kinds: [], email: "sender" },
  // ── Account ──────────────────────────────────────────────────────────────────────────────────
  {
    key: "credential_expiring", label: "E&O or licence expiring", description: "The agency's errors-and-omissions cover or a state licence is about to lapse.", group: "Account", owned_by_module: "LA-0.5",
    defaults: on(true, true), supports_digest: false, is_protected: true, protected_reason: "Writing business uninsured or unlicensed.", required_feature: "appointment_vault", roles: OWNER, kinds: ["credential_expiring"], email: "outbox",
  },
  {
    key: "plan_payment_failed", label: "Payment failed on your plan", description: "Your Insurvas subscription payment did not go through.", group: "Account", owned_by_module: "LA-8.5",
    defaults: on(true, true), supports_digest: false, is_protected: true, protected_reason: "Otherwise the account suspends without warning.", required_feature: null, roles: OWNER, kinds: ["plan_payment_failed"], email: "outbox",
  },
  // LA-8.7: a webhook whose deliveries kept failing was turned off. Never silent — something downstream is now wrong.
  { key: "webhook_disabled", label: "Webhook turned off", description: "A webhook kept failing and was turned off; nothing is being sent to it.", group: "Account", owned_by_module: "LA-8.7", defaults: on(true, true), supports_digest: false, is_protected: false, required_feature: null, roles: OWNER, kinds: ["webhook_disabled"], email: "outbox" },
  // SA-2.5: a plan allowance (dialer minutes, DNC lookups, …) crossed the usage warning threshold, 80% by default. Written once per meter per billing period by the usage_totals trigger (20261015601000).
  { key: "allowance_near_cap", label: "Allowance nearly used", description: "A usage allowance on your plan is close to its limit for this billing period.", group: "Account", owned_by_module: "SA-2.5", defaults: on(true, true), supports_digest: false, is_protected: false, required_feature: null, roles: OWNER, kinds: ["allowance_near_cap"], email: "outbox" },
];

export const PROTECTED_EVENT_KEYS = NOTIFICATION_EVENTS.filter((e) => e.is_protected).map((e) => e.key);

export function eventByKey(key: string, events: readonly NotificationEvent[] = NOTIFICATION_EVENTS): NotificationEvent | null {
  return events.find((e) => e.key === key) ?? null;
}

export function eventForKind(kind: string, events: readonly NotificationEvent[] = NOTIFICATION_EVENTS): NotificationEvent | null {
  return events.find((e) => e.kinds.includes(kind)) ?? null;
}

/** The events this person may receive at all: absent, not greyed out, when the feature or role is missing. */
export function visibleEvents(granted: Iterable<string>, role: TenantRole, events: readonly NotificationEvent[] = NOTIFICATION_EVENTS): NotificationEvent[] {
  const have = new Set(granted);
  return events.filter((e) => (!e.required_feature || have.has(e.required_feature)) && (!e.roles || e.roles.includes(role)));
}

export type PreferenceRow = { event_key: string; in_app: boolean; email: boolean; push: boolean; digest: DigestCadence };
export type Delivery = { in_app: boolean; email: boolean; push: boolean; digest: DigestCadence; protected: boolean };

/**
 * What one person gets for one event. No row: the registry default — absent is not off. A protected
 * event is on everywhere and immediate, whatever is stored. A digest choice is honoured only for an
 * event that supports one; "off" means no email at all.
 */
export function resolveDelivery(event: NotificationEvent, row: Pick<PreferenceRow, "in_app" | "email" | "push" | "digest"> | null | undefined): Delivery {
  if (event.is_protected) return { in_app: true, email: true, push: event.defaults.push, digest: "immediate", protected: true };
  if (!row) return { ...event.defaults, digest: "immediate", protected: false };
  const digest = event.supports_digest ? row.digest : "immediate";
  return { in_app: row.in_app, email: row.email && digest !== "off", push: row.push, digest, protected: false };
}

/** "HH:MM" of `now` in `timeZone` (falls back to UTC for an unknown zone). */
export function localClock(now: Date, timeZone: string | null): { minutes: number; weekday: number; date: string } {
  let zone = timeZone ?? "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch { zone = "UTC"; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday, date: `${parts.year}-${parts.month}-${parts.day}` };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Inside quiet hours, in the person's own timezone. A window may cross midnight (21:00 → 08:00). */
export function inQuietHours(now: Date, timeZone: string | null, quiet: { enabled: boolean; start: string; end: string }): boolean {
  if (!quiet.enabled) return false;
  const { minutes } = localClock(now, timeZone);
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Digests go at 08:00 in the person's timezone; weekly ones on Mondays. */
export const DIGEST_HOUR = 8;

/**
 * Is a digest due? Once per local day (daily) or local week (weekly), at or after 08:00 local, and
 * only if the last one went before today's 08:00. Whether there is anything to send is decided by the
 * caller: an empty digest is not sent.
 */
export function digestDue(cadence: "daily" | "weekly", now: Date, timeZone: string | null, lastSentAt: string | null): boolean {
  const clock = localClock(now, timeZone);
  if (clock.minutes < DIGEST_HOUR * 60) return false;
  if (cadence === "weekly" && clock.weekday !== 1) return false;
  if (!lastSentAt) return true;
  const last = localClock(new Date(lastSentAt), timeZone);
  return last.date !== clock.date;
}
