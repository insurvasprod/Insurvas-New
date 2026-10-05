import "server-only";

import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { listDueCallbacks } from "@/lib/callbacks/service";
import { getQueueSlaSettings } from "@/lib/queueSla/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { TenantRole } from "@/lib/tenantAuth/roles";

import { hourHeatmap, leaderboard, outcomeMix, type AttemptRow, type Heatmap, type Leader, type Outcome } from "./insights";
import { contactRate, endOfToday, greeting, lastDays, longDate, NOT_A_CONTACT } from "./todayMath";

/**
 * The dashboard's "Today" hero and "Needs you today" strip: what happened today, the last fourteen
 * days of dialling, the next callback, and the four things that cost money when nobody looks.
 *
 * Scope follows the reader. An owner sees the agency; everyone else sees their own dials and
 * appointments ("Your day"), because a producer's dashboard crediting them with the floor's
 * numbers is flattery, not information. Every figure is a head count or one row, and each block
 * is independent: a figure whose read fails is null and the screen says "—", rather than the whole
 * hero failing over one number. Features gate what is read at all — a plan without inbound
 * transfers is not asked about SLA breaches.
 */
export type DashboardToday = {
  scope: "agency" | "you";
  greeting: string;
  /** The reader's first name, for "Good afternoon, Ray"; null when the account has none. */
  firstName: string | null;
  dateLabel: string;
  zone: string;
  dialsToday: number | null;
  dialsYesterday: number | null;
  contactsToday: number | null;
  contactRatePct: number | null;
  /** Appointments that START today (agency day), not rows created today (LA-2.11-8). */
  appointmentsToday: number | null;
  /** Today's appointments themselves, earliest first (at most TODAY_LIST_LIMIT). */
  appointmentsTodayList: TodayAppointment[] | null;
  queueReady: number | null;
  series: Array<{ key: string; label: string; weekday: string; dials: number | null; contacts: number | null; isToday: boolean }>;
  nextCallback: { name: string; atUtc: string; customerTimezone: string } | null;
  needs: {
    slaBreaching: number | null;
    slaMinutes: number | null;
    callbacksOverdue: number | null;
    callbacksToday: number | null;
    lapsing: number | null;
    licences: { expired: number; expiring: number; states: string[] } | null;
  };
  /** The analysis panels, from the last seven days of attempts (at most SAMPLE_LIMIT of them). */
  insights: {
    outcomes: Outcome[];
    heat: Heatmap;
    /** Agency scope only: the team's standings. */
    leaders: Leader[] | null;
    /** True when the week held more attempts than were read, so the panels show the latest slice. */
    sampled: boolean;
  } | null;
  appointmentsWeek: number | null;
  /** Policies written in the last 30 days and their annual premium; null without the book. */
  policies30: { count: number; premiumCents: number } | null;
};

const SAMPLE_LIMIT = 5000;

export type TodayAppointment = {
  id: string;
  customerName: string;
  startsAtUtc: string;
  customerTimezone: string;
  agentName: string;
  status: string;
};

/** The dashboard's list is the nudge; the calendar is the list. */
const TODAY_LIST_LIMIT = 6;
/** Every appointment that is on today's diary: not cancelled, not moved to another slot. */
const ON_THE_DIARY = ["booked", "confirmed", "pending", "showed", "no_show"];

type Result = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>;
type Chain = Result & {
  eq(column: string, value: unknown): Chain;
  in(column: string, values: string[]): Chain;
  is(column: string, value: null): Chain;
  not(column: string, op: string, value: unknown): Chain;
  gte(column: string, value: string): Chain;
  lt(column: string, value: string): Chain;
  lte(column: string, value: string): Chain;
  order(column: string, options: { ascending: boolean }): Chain;
  limit(count: number): Chain;
};
type Loose = { from(table: string): { select(columns: string, options?: { count: "exact"; head: true }): Chain } };

const db = () => getSupabaseServiceClient() as unknown as Loose;
const count = async (query: Chain) => { const result = await query; return result.error ? null : result.count ?? 0; };
const NOT_A_CONTACT_LIST = `(${NOT_A_CONTACT.join(",")})`;
const leadName = (values: Record<string, unknown> | null | undefined) => {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const v = values ?? {};
  return text(v.full_name) || text(v.name) || [text(v.first_name), text(v.last_name)].filter(Boolean).join(" ") || "A customer";
};

export async function getDashboardToday(input: { tenantId: string; userId: string; role: TenantRole; available: readonly string[]; now?: number }): Promise<DashboardToday> {
  const now = input.now ?? Date.now();
  const zone = (await getWorkspaceTimezone(input.tenantId).catch(() => null)) ?? "America/New_York";
  const scope = input.role === "owner" ? "agency" : "you";
  const days = lastDays(now, zone, 14);
  const today = days[days.length - 1];
  const yesterdayStart = days[days.length - 2].start;
  const has = (feature: string) => input.available.includes(feature);
  const dialing = has("outbound_dialing");

  const attempts = () => {
    const query = db().from("tenant_call_attempts").select("id", { count: "exact", head: true }).eq("tenant_id", input.tenantId);
    return scope === "you" ? query.eq("agent_id", input.userId) : query;
  };
  const contacts = (query: Chain) => query.not("disposition", "is", null).not("disposition", "in", NOT_A_CONTACT_LIST);

  // Fourteen days of dials and contacts, one head count each — bounded work whatever the volume.
  const seriesReads = dialing
    ? days.map((day) => Promise.all([
      count(attempts().gte("attempted_at", day.start).lt("attempted_at", day.end)),
      count(contacts(attempts().gte("attempted_at", day.start).lt("attempted_at", day.end))),
    ]))
    : [];
  // Yesterday up to this time of day, so the comparison is like for like.
  const sameTimeYesterday = new Date(Date.parse(today.end) - 86_400_000).toISOString();

  const weekStart = days[days.length - 7].start;

  // One bounded read feeds the outcome mix, the heatmap and the standings: the newest attempts of
  // the last seven days, capped, rather than a group-by per panel.
  const insightsRead = dialing ? (async () => {
    let query = db().from("tenant_call_attempts").select("attempted_at, disposition, agent_id").eq("tenant_id", input.tenantId).gte("attempted_at", weekStart);
    if (scope === "you") query = query.eq("agent_id", input.userId);
    const [attemptsResult, labelsResult] = await Promise.all([
      query.order("attempted_at", { ascending: false }).limit(SAMPLE_LIMIT),
      db().from("dispositions").select("disposition_key, label").eq("tenant_id", input.tenantId),
    ]);
    if (attemptsResult.error) return null;
    const rows = (attemptsResult.data ?? []) as AttemptRow[];
    const labels = Object.fromEntries(((labelsResult.error ? [] : labelsResult.data ?? []) as Array<{ disposition_key: string; label: string }>).map((item) => [item.disposition_key, item.label]));
    let leaders: Leader[] | null = null;
    if (scope === "agency") {
      const ids = [...new Set(rows.map((item) => item.agent_id).filter((id): id is string => Boolean(id)))];
      const people = ids.length ? await db().from("users").select("id, name").in("id", ids.slice(0, 200)) : { data: [], error: null };
      const names = Object.fromEntries(((people.error ? [] : people.data ?? []) as Array<{ id: string; name: string | null }>).map((item) => [item.id, item.name?.trim() || "Unnamed member"]));
      leaders = leaderboard(rows, names, 5);
    }
    return { outcomes: outcomeMix(rows, labels), heat: hourHeatmap(rows, zone, days.slice(-7)), leaders, sampled: rows.length >= SAMPLE_LIMIT };
  })().catch(() => null) : Promise.resolve(null);

  const appointmentsWeekRead = dialing ? (() => {
    const query = db().from("tenant_appointments").select("id", { count: "exact", head: true }).eq("tenant_id", input.tenantId).gte("created_at", weekStart).not("status", "in", "(cancelled)");
    return count(scope === "you" ? query.eq("booked_by", input.userId) : query);
  })() : Promise.resolve(null);

  // LA-2.11-8 · today's appointments: the ones on today's diary (starting between the agency's
  // midnight and the next), not the ones somebody booked today for next week. Scope as everywhere
  // on this screen: the owner sees the agency, a producer their own diary, a setter what they booked.
  const todayEnd = endOfToday(now, zone);
  const appointmentsTodayRead = dialing ? (async () => {
    let query = db().from("tenant_appointments").select("id, lead_id, agent_user_id, starts_at_utc, customer_timezone, status")
      .eq("tenant_id", input.tenantId).in("status", ON_THE_DIARY).gte("starts_at_utc", today.start).lt("starts_at_utc", todayEnd);
    if (scope === "you") query = input.role === "setter" ? query.eq("booked_by", input.userId) : query.eq("agent_user_id", input.userId);
    const result = await query.order("starts_at_utc", { ascending: true }).limit(200);
    if (result.error) return null;
    const rows = (result.data ?? []) as Array<{ id: string; lead_id: string; agent_user_id: string; starts_at_utc: string; customer_timezone: string; status: string }>;
    const shown = rows.slice(0, TODAY_LIST_LIMIT);
    const leadIds = [...new Set(shown.map((row) => row.lead_id))];
    const agentIds = [...new Set(shown.map((row) => row.agent_user_id))];
    const [leads, agents] = await Promise.all([
      leadIds.length ? db().from("agent_leads").select("id, values").eq("tenant_id", input.tenantId).in("id", leadIds) : Promise.resolve({ data: [], error: null }),
      agentIds.length ? db().from("users").select("id, name").in("id", agentIds) : Promise.resolve({ data: [], error: null }),
    ]);
    const leadValues = new Map(((leads.error ? [] : leads.data ?? []) as Array<{ id: string; values: Record<string, unknown> | null }>).map((row) => [row.id, row.values]));
    const agentName = new Map(((agents.error ? [] : agents.data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name?.trim() || "Agent"]));
    return {
      count: rows.length,
      list: shown.map((row): TodayAppointment => ({
        id: row.id,
        customerName: leadName(leadValues.get(row.lead_id)),
        startsAtUtc: row.starts_at_utc,
        customerTimezone: row.customer_timezone,
        agentName: agentName.get(row.agent_user_id) ?? "Agent",
        status: row.status,
      })),
    };
  })().catch(() => null) : Promise.resolve(null);

  const policiesRead = has("book_of_business") ? (async () => {
    let query = db().from("tenant_policies").select("annual_premium_cents").eq("tenant_id", input.tenantId).gte("created_at", new Date(now - 30 * 86_400_000).toISOString());
    if (scope === "you") query = query.eq("created_by", input.userId);
    const result = await query.limit(5000);
    if (result.error) return null;
    const rows = (result.data ?? []) as Array<{ annual_premium_cents: number | string | null }>;
    return { count: rows.length, premiumCents: rows.reduce((sum, item) => sum + Number(item.annual_premium_cents ?? 0), 0) };
  })().catch(() => null) : Promise.resolve(null);

  const [person, series, dialsYesterday, appointmentsToday, queueReady, nextCallback, due, slaBlock, lapsing, licences, insights, appointmentsWeek, policies30] = await Promise.all([
    db().from("users").select("name").eq("id", input.userId).limit(1),
    Promise.all(seriesReads),
    dialing ? count(attempts().gte("attempted_at", yesterdayStart).lt("attempted_at", sameTimeYesterday)) : Promise.resolve(null),
    appointmentsTodayRead,
    dialing ? count(db().from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", input.tenantId).eq("status", "unclaimed").is("partner_id", null)) : Promise.resolve(null),
    has("callback_calendar") ? (async () => {
      const result = await db().from("tenant_callbacks").select("scheduled_at_utc, customer_timezone, lead:agent_leads!tenant_callbacks_lead_id_fkey(values)").eq("tenant_id", input.tenantId).in("status", ["scheduled", "due"]).gte("scheduled_at_utc", new Date(now).toISOString()).order("scheduled_at_utc", { ascending: true }).limit(1);
      const row = ((result.error ? [] : result.data ?? []) as Array<{ scheduled_at_utc: string; customer_timezone: string; lead: { values: Record<string, unknown> | null } | Array<{ values: Record<string, unknown> | null }> | null }>)[0];
      if (!row) return null;
      const lead = Array.isArray(row.lead) ? row.lead[0] : row.lead;
      return { name: leadName(lead?.values), atUtc: row.scheduled_at_utc, customerTimezone: row.customer_timezone };
    })().catch(() => null) : Promise.resolve(null),
    has("callback_calendar") ? listDueCallbacks(input.tenantId).catch(() => null) : Promise.resolve(null),
    has("inbound_transfers") ? (async () => {
      const sla = await getQueueSlaSettings(input.tenantId);
      const cutoff = new Date(now - sla.escalate_after_seconds * 1000).toISOString();
      const breaching = await count(db().from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", input.tenantId).eq("status", "unclaimed").not("partner_id", "is", null).lt("queued_at", cutoff));
      return { breaching, minutes: Math.round(sla.escalate_after_seconds / 60) };
    })().catch(() => ({ breaching: null, minutes: null })) : Promise.resolve({ breaching: null, minutes: null }),
    has("chargeback_radar") ? count(db().from("tenant_policy_lapse_signals").select("id", { count: "exact", head: true }).eq("tenant_id", input.tenantId).is("resolved_at", null)) : Promise.resolve(null),
    input.role === "owner" || input.role === "producer" ? (async () => {
      const horizon = new Date(now + 30 * 86_400_000).toISOString();
      const result = await db().from("licenses").select("state, expires_at").eq("tenant_id", input.tenantId).lte("expires_at", horizon);
      if (result.error) return null;
      const rows = (result.data ?? []) as Array<{ state: string; expires_at: string | null }>;
      const expired = rows.filter((row) => row.expires_at && Date.parse(row.expires_at) < now);
      const expiring = rows.filter((row) => row.expires_at && Date.parse(row.expires_at) >= now);
      return { expired: expired.length, expiring: expiring.length, states: [...new Set([...expired, ...expiring].map((row) => row.state))].sort() };
    })().catch(() => null) : Promise.resolve(null),
    insightsRead,
    appointmentsWeekRead,
    policiesRead,
  ]);

  const todayPair = series[series.length - 1];
  const dialsToday = todayPair ? todayPair[0] : null;
  const contactsToday = todayPair ? todayPair[1] : null;
  const dueList = due as Awaited<ReturnType<typeof listDueCallbacks>> | null;

  return {
    scope,
    greeting: greeting(now, zone),
    firstName: ((person.error ? [] : person.data ?? []) as Array<{ name: string | null }>)[0]?.name?.trim().split(/\s+/)[0] || null,
    dateLabel: longDate(now, zone),
    zone,
    dialsToday,
    dialsYesterday,
    contactsToday,
    contactRatePct: dialsToday === null || contactsToday === null ? null : contactRate(dialsToday, contactsToday),
    appointmentsToday: appointmentsToday ? appointmentsToday.count : null,
    appointmentsTodayList: appointmentsToday ? appointmentsToday.list : null,
    queueReady,
    series: days.map((day, index) => ({ key: day.key, label: day.label, weekday: day.weekday, dials: series[index]?.[0] ?? null, contacts: series[index]?.[1] ?? null, isToday: day.isToday })),
    nextCallback,
    needs: {
      slaBreaching: slaBlock.breaching,
      slaMinutes: slaBlock.minutes,
      callbacksOverdue: dueList ? dueList.filter((item) => item.isOverdue).length : null,
      callbacksToday: dueList ? dueList.filter((item) => !item.isOverdue).length : null,
      lapsing,
      licences,
    },
    insights,
    appointmentsWeek,
    policies30,
  };
}
