import { PROTECTED_ALERT_EVENTS, type AgentAlertEvent } from "./presentation.ts";

/**
 * The agent bell as a notification centre (2026-10-09): grouping, filters and snooze, as pure
 * functions so the rules are tested. `components/app/app-top-bar.tsx` draws the result.
 *
 * READ STATE. The feed (`/api/app/notifications`) returns unread notifications only, and opening
 * one marks it read on the server. The bell keeps the ones read from it during this page's life so
 * "All" and "Unread" are different lists; a reload starts again from the server's unread set.
 *
 * SNOOZE is per browser (localStorage, keyed by user id). A snoozed notification leaves the list and
 * the badge until its time, then returns unread. It is NOT cross-device: that needs a table, which
 * cannot be applied from here. Proposed (not a migration — for whoever owns the schema):
 *
 *   create table public.agent_notification_snoozes (
 *     tenant_id         uuid        not null,
 *     notification_id   uuid        not null,
 *     recipient_user_id uuid        not null,
 *     snoozed_until     timestamptz not null,
 *     created_at        timestamptz not null default now(),
 *     primary key (tenant_id, notification_id),
 *     foreign key (tenant_id, notification_id)
 *       references public.agent_notifications (tenant_id, id) on delete cascade
 *   );
 *   create index agent_notification_snoozes_recipient_idx
 *     on public.agent_notification_snoozes (tenant_id, recipient_user_id, snoozed_until);
 *   alter table public.agent_notification_snoozes enable row level security;
 *   revoke all on public.agent_notification_snoozes from anon, authenticated, public;
 *   -- The recipient only, the same predicate as agent_notifications_user_scoped.
 *   create policy agent_notification_snoozes_user_scoped on public.agent_notification_snoozes
 *     for all to tenant_app
 *     using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
 *       and recipient_user_id = nullif((select current_setting('app.user_id', true)), '')::uuid)
 *     with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
 *       and recipient_user_id = nullif((select current_setting('app.user_id', true)), '')::uuid);
 *
 * The composite foreign key needs a unique (tenant_id, id) on agent_notifications; without one,
 * reference `agent_notifications(id)` alone and have the writer check tenant and recipient. The
 * route that writes it (a PATCH/POST on `/api/app/notifications` behind `requireTenant`) must
 * upsert only ids whose `agent_notifications` row has the caller as `recipient_user_id`, and
 * `listAgentAlerts` would leave out rows with `snoozed_until > now()`.
 */

export type BellKind = "action_needed" | "handoff" | "mention" | "partner_message" | "callback" | "servicing" | "other";

/**
 * The filter chips, in the order they are drawn. A kind chip appears only when that kind is present.
 * "Action needed" leads: the protected events (a reinstatement window, a DOI deadline, an expiring
 * E&O or licence, a failed plan payment) — the ones nobody can switch off.
 */
export const BELL_KINDS: readonly BellKind[] = ["action_needed", "handoff", "mention", "partner_message", "callback", "servicing", "other"];

export const BELL_KIND_LABEL: Record<BellKind, string> = {
  action_needed: "Action needed",
  handoff: "Transfers",
  mention: "Mentions",
  partner_message: "Partner messages",
  callback: "Callbacks",
  servicing: "Servicing",
  other: "Other",
};

export function bellKindOf(event: AgentAlertEvent): BellKind {
  if (PROTECTED_ALERT_EVENTS.includes(event)) return "action_needed";
  switch (event) {
    case "handoff_offered": return "handoff";
    case "mentioned": return "mention";
    case "partner_message": return "partner_message";
    case "callback_due": return "callback";
    case "servicing_failed": return "servicing";
    default: return "other";
  }
}

export type BellTone = "accent" | "success" | "warning" | "muted";

/** The dot colour a notification gets, in the bell and the top bar alike. Protected events and failures read as warnings. */
export function bellToneOf(event: AgentAlertEvent): BellTone {
  if (PROTECTED_ALERT_EVENTS.includes(event)) return "warning";
  switch (event) {
    case "handoff_offered": return "success";
    case "callback_due": return "warning";
    case "servicing_failed": return "warning";
    case "webhook_disabled": return "warning";
    case "allowance_near_cap": return "warning";
    case "partner_message": return "muted";
    default: return "accent";
  }
}

export type BellItem = {
  id: string;
  title: string;
  body: string;
  link: string;
  event_type: AgentAlertEvent;
  created_at: string;
  /** Read from the bell during this page's life; unread items come straight from the feed. */
  read: boolean;
};

export type BellGroup = {
  key: string;
  kind: BellKind;
  /** Newest first. The first member is the line the collapsed row shows. */
  members: BellItem[];
  newest: BellItem;
  count: number;
  unreadCount: number;
  /** Where the row's primary action goes: the newest member's link (the members' shared one, when they share it). */
  link: string;
};

/**
 * What "the same subject" means, per kind:
 *   · callbacks — every callback (and appointment) reminder is one row: they are one queue to work
 *     through, and the members each open their own lead;
 *   · partner messages, mentions, transfers and anything else — the same link. Partner messages
 *     all open the Partner chat page (the link names no channel), so they share one row; mentions
 *     group per lead note link; transfers per lead.
 */
export function bellGroupKey(item: Pick<BellItem, "event_type" | "link">): string {
  const kind = bellKindOf(item.event_type);
  if (kind === "callback") return "callback";
  return `${kind}:${item.link}`;
}

const newestFirst = (a: BellItem, b: BellItem) => b.created_at.localeCompare(a.created_at);

/** Collapses items into groups, newest group first. A group of one is just a row. */
export function groupBellItems(items: readonly BellItem[]): BellGroup[] {
  const byKey = new Map<string, BellItem[]>();
  for (const item of items) {
    const key = bellGroupKey(item);
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }
  const groups: BellGroup[] = [];
  for (const [key, list] of byKey) {
    const members = [...list].sort(newestFirst);
    const newest = members[0];
    groups.push({
      key,
      kind: bellKindOf(newest.event_type),
      members,
      newest,
      count: members.length,
      unreadCount: members.filter((member) => !member.read).length,
      link: newest.link,
    });
  }
  return groups.sort((a, b) => newestFirst(a.newest, b.newest));
}

/**
 * Which members opening `link` reads: every member that link opens. A partner-message row opens the
 * one chat page that holds them all; a callback row opens the newest callback's lead, which reads
 * that one and leaves the others waiting.
 */
export function idsReadByOpening(group: Pick<BellGroup, "members">, link: string): string[] {
  return group.members.filter((member) => !member.read && member.link === link).map((member) => member.id);
}

/** A short count line for a collapsed row: "3 callbacks due". */
export function bellGroupSummary(group: Pick<BellGroup, "kind" | "count">): string {
  const n = group.count;
  switch (group.kind) {
    case "callback": return `${n} callbacks due`;
    case "partner_message": return `${n} partner messages`;
    case "mention": return `${n} mentions`;
    case "handoff": return `${n} transfers`;
    case "action_needed": return `${n} need action`;
    case "servicing": return `${n} servicing requests failed`;
    default: return `${n} notifications`;
  }
}

// ---------------------------------------------------------------- filters

export type BellFilter = "all" | "unread" | "snoozed" | BellKind;

/**
 * The items a filter shows. Snoozed items appear under "Snoozed" only; every other filter leaves
 * them out until their time.
 */
export function filterBellItems(items: readonly BellItem[], filter: BellFilter, snoozedIds: ReadonlySet<string>): BellItem[] {
  if (filter === "snoozed") return items.filter((item) => snoozedIds.has(item.id));
  const awake = items.filter((item) => !snoozedIds.has(item.id));
  if (filter === "all") return awake;
  if (filter === "unread") return awake.filter((item) => !item.read);
  return awake.filter((item) => bellKindOf(item.event_type) === filter);
}

export type BellChip = { key: BellFilter; label: string; count: number | null };

/**
 * The chips: All, Unread, one per kind present (counting its unread, awake items), and Snoozed when
 * anything is. The active chip is always kept, so a filter that empties does not vanish under the
 * pointer — its list says it is empty instead.
 */
export function bellFilterChips(items: readonly BellItem[], snoozedIds: ReadonlySet<string>, active: BellFilter): BellChip[] {
  const awake = items.filter((item) => !snoozedIds.has(item.id));
  const unread = awake.filter((item) => !item.read);
  const chips: BellChip[] = [
    { key: "all", label: "All", count: null },
    { key: "unread", label: "Unread", count: unread.length },
  ];
  for (const kind of BELL_KINDS) {
    const present = awake.some((item) => bellKindOf(item.event_type) === kind);
    if (!present && active !== kind) continue;
    chips.push({ key: kind, label: BELL_KIND_LABEL[kind], count: unread.filter((item) => bellKindOf(item.event_type) === kind).length });
  }
  const snoozed = items.filter((item) => snoozedIds.has(item.id)).length;
  if (snoozed || active === "snoozed") chips.push({ key: "snoozed", label: "Snoozed", count: snoozed });
  return chips;
}

/** What an empty filter says. */
export function bellEmptyTitle(filter: BellFilter): string {
  if (filter === "all") return "Nothing addressed to you";
  if (filter === "unread") return "No unread notifications";
  if (filter === "snoozed") return "Nothing snoozed";
  if (filter === "other") return "No other notifications";
  return `No ${BELL_KIND_LABEL[filter].toLowerCase()}`;
}

// ---------------------------------------------------------------- snooze

export type SnoozeOption = "1h" | "3h" | "tomorrow9";
export const SNOOZE_OPTIONS: ReadonlyArray<{ key: SnoozeOption; label: string }> = [
  { key: "1h", label: "1 hour" },
  { key: "3h", label: "3 hours" },
  { key: "tomorrow9", label: "Tomorrow 9am" },
];

/** When a snooze ends, in the browser's own time zone for "Tomorrow 9am". */
export function snoozeUntil(option: SnoozeOption, now: Date): Date {
  if (option === "1h") return new Date(now.getTime() + 60 * 60_000);
  if (option === "3h") return new Date(now.getTime() + 3 * 60 * 60_000);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  return next;
}

/** id → ISO time the snooze ends. */
export type SnoozeMap = Record<string, string>;

/** Only the snoozes still running at `now`. An entry that cannot be read as a time is dropped. */
export function activeSnoozes(map: SnoozeMap, now: number): SnoozeMap {
  const out: SnoozeMap = {};
  for (const [id, until] of Object.entries(map)) {
    const at = Date.parse(until);
    if (Number.isFinite(at) && at > now) out[id] = until;
  }
  return out;
}

/** The next moment a snooze ends, so the bell can redraw then; null when nothing is snoozed. */
export function nextSnoozeExpiry(map: SnoozeMap, now: number): number | null {
  let next: number | null = null;
  for (const until of Object.values(map)) {
    const at = Date.parse(until);
    if (Number.isFinite(at) && at > now && (next === null || at < next)) next = at;
  }
  return next;
}

export function snoozeIds(map: SnoozeMap, ids: readonly string[], until: Date): SnoozeMap {
  const next = { ...map };
  for (const id of ids) next[id] = until.toISOString();
  return next;
}

export function unsnoozeIds(map: SnoozeMap, ids: readonly string[]): SnoozeMap {
  const next = { ...map };
  for (const id of ids) delete next[id];
  return next;
}

/** Parses the stored value; anything malformed reads as "nothing snoozed". */
export function parseSnoozeMap(raw: string | null): SnoozeMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SnoozeMap = {};
    for (const [id, until] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof until === "string") out[id] = until;
    }
    return out;
  } catch {
    return {};
  }
}

export const snoozeStorageKey = (userId: string) => `insurvas.bell.snooze.v1:${userId}`;

/** Splits ids into chunks the mark-read route accepts (it takes at most 100 ids per call). */
export function chunkIds(ids: readonly string[], size = 100): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
