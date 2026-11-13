import "server-only";

import { after } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { busyTimeSource, decryptToken, encryptToken } from "./linkedCalendars";
import { appointmentIdOf, canWriteEvents, eventBody, eventIdFor, leadName, lengthChange, mirrorAction, type MirroredAppointment } from "./calendarMirrorCore";
import { BUSY_HORIZON_DAYS } from "./linkedCalendarsShared";

/**
 * Meetings booked in Insurvas appear in the agent's linked Google Calendar (owner, 2026-11-13).
 *
 * The agent's calendar mirrors the appointment: booked or confirmed puts the meeting there at its
 * current time, a cancellation or a move takes it out (the move's new appointment adds its own). The
 * pure rules are calendarMirrorCore.ts; this file reads the rows and talks to Google.
 *
 * It never decides a booking. Every call runs after the booking is saved, and a Google failure is
 * logged and left for the next pass: Insurvas is the record, the calendar is a copy. Three things
 * trigger it:
 *  - the booking routes, right after they answer (scheduleCalendarMirror);
 *  - a newly linked calendar, for everything already upcoming (mirrorAgentUpcoming);
 *  - the 15-minute calendar pass, for anything changed elsewhere: close-out, the vault, a script
 *    (mirrorRecentlyChanged).
 * Only Google connections that granted calendar.events write; older links keep reading busy time
 * only, until the agent reconnects.
 */

type Row = Record<string, unknown>;
type Result<T> = { data: T; error: { message: string } | null };
type Query = PromiseLike<Result<Row[]>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  gte(column: string, value: unknown): Query;
  or(filters: string): Query;
  update(values: Row): Query;
};
const db = () => getSupabaseServiceClient() as unknown as { from(table: string): Query };
const text = (value: unknown) => (typeof value === "string" ? value : "");

const APPOINTMENT_COLUMNS = "id, tenant_id, lead_id, agent_user_id, starts_at_utc, ends_at_utc, duration_minutes, status, notes";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.insurvas.com").trim();
}

export type MirrorReport = { written: number; removed: number; skipped: number; failed: number };
const emptyReport = (): MirrorReport => ({ written: 0, removed: 0, skipped: 0, failed: 0 });

/** Runs the mirror after the response, so a slow Google never slows a booking. */
export function scheduleCalendarMirror(appointmentIds: Array<string | null | undefined>): void {
  const ids = [...new Set(appointmentIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const run = () => mirrorAppointments(ids).catch((error) => console.error("[calendar-mirror] failed", error instanceof Error ? error.message : error));
  try {
    after(run);
  } catch {
    // Outside a request (a script or a test): run it now, still without blocking the caller.
    void run();
  }
}

/** Writes or removes the Google event for each appointment, for agents whose calendar accepts it. */
export async function mirrorAppointments(appointmentIds: string[]): Promise<MirrorReport> {
  if (appointmentIds.length === 0) return emptyReport();
  // A move marks the old appointment "rescheduled" and books a new one pointing back at it.
  const [direct, successors] = await Promise.all([
    db().from("tenant_appointments").select(APPOINTMENT_COLUMNS).in("id", appointmentIds),
    db().from("tenant_appointments").select(APPOINTMENT_COLUMNS).in("rescheduled_from", appointmentIds),
  ]);
  if (direct.error) throw new Error(`Could not read appointments: ${direct.error.message}`);
  const rows = [...(direct.data ?? []), ...(successors.error ? [] : successors.data ?? [])];
  return mirrorRows(rows);
}

/** A calendar was just linked: put the agent's upcoming meetings on it. */
export async function mirrorAgentUpcoming(tenantId: string, userId: string): Promise<MirrorReport> {
  const rows = await db()
    .from("tenant_appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("agent_user_id", userId)
    .in("status", ["booked", "confirmed"])
    .gte("starts_at_utc", new Date().toISOString());
  if (rows.error) throw new Error(`Could not read upcoming appointments: ${rows.error.message}`);
  return mirrorRows(rows.data ?? []);
}

/** The scheduled pass: everything created or changed since `sinceIso`, whichever screen changed it. */
export async function mirrorRecentlyChanged(sinceIso: string): Promise<MirrorReport> {
  const rows = await db()
    .from("tenant_appointments")
    .select(APPOINTMENT_COLUMNS)
    .or(`updated_at.gte."${sinceIso}",created_at.gte."${sinceIso}"`);
  if (rows.error) throw new Error(`Could not read changed appointments: ${rows.error.message}`);
  return mirrorRows(rows.data ?? []);
}

async function mirrorRows(rows: Row[]): Promise<MirrorReport> {
  const report = emptyReport();
  const work = rows.filter((row) => mirrorAction(text(row.status)) !== "keep");
  report.skipped += rows.length - work.length;
  if (work.length === 0) return report;

  // Only agents with a Google calendar that accepts events.
  const agentKeys = [...new Set(work.map((row) => `${text(row.tenant_id)}:${text(row.agent_user_id)}`))];
  const connections = await db()
    .from("tenant_connected_calendars")
    .select("id, tenant_id, user_id, status, refresh_token_ciphertext, scopes")
    .eq("provider", "google")
    .in("user_id", [...new Set(work.map((row) => text(row.agent_user_id)))]);
  if (connections.error) throw new Error(`Could not read linked calendars: ${connections.error.message}`);
  const calendarByAgent = new Map<string, Row>();
  for (const connection of connections.data ?? []) {
    const scopes = Array.isArray(connection.scopes) ? (connection.scopes as string[]) : [];
    if (!text(connection.refresh_token_ciphertext) || !canWriteEvents(scopes)) continue;
    if (text(connection.status) !== "connected" && text(connection.status) !== "error") continue;
    calendarByAgent.set(`${text(connection.tenant_id)}:${text(connection.user_id)}`, connection);
  }

  const leadIds = [...new Set(work.map((row) => text(row.lead_id)).filter(Boolean))];
  const leads = leadIds.length ? await db().from("agent_leads").select("id, values").in("id", leadIds) : { data: [] as Row[], error: null };
  const nameByLead = new Map((leads.data ?? []).map((lead) => [text(lead.id), leadName(lead.values)]));

  for (const key of agentKeys) {
    const rowsForAgent = work.filter((row) => `${text(row.tenant_id)}:${text(row.agent_user_id)}` === key);
    const connection = calendarByAgent.get(key);
    if (!connection) {
      report.skipped += rowsForAgent.length;
      continue;
    }
    let token: string;
    try {
      token = await accessToken(connection);
    } catch (error) {
      console.error("[calendar-mirror] could not refresh the calendar token", text(connection.id), error instanceof Error ? error.message : error);
      report.failed += rowsForAgent.length;
      continue;
    }
    for (const row of rowsForAgent) {
      try {
        if (mirrorAction(text(row.status)) === "remove") {
          if (await removeEvent(token, text(row.id))) report.removed += 1;
          else report.skipped += 1;
        } else {
          await upsertEvent(token, {
            appointmentId: text(row.id),
            leadId: text(row.lead_id),
            customerName: nameByLead.get(text(row.lead_id)) ?? "a lead",
            startsAtUtc: text(row.starts_at_utc),
            endsAtUtc: text(row.ends_at_utc) || null,
            durationMinutes: Number(row.duration_minutes ?? 0),
            notes: text(row.notes) || null,
          });
          report.written += 1;
        }
      } catch (error) {
        console.error("[calendar-mirror] appointment", text(row.id), error instanceof Error ? error.message : error);
        report.failed += 1;
      }
    }
  }
  return report;
}

/**
 * Google → Insurvas: a meeting of ours made longer or shorter in Google takes that length here, so the
 * Insurvas calendar covers the whole of it (owner, 2026-11-13). Only the length: a meeting dragged to
 * another start is left alone, since moving it is a reschedule with every booking rule. Run before the
 * mirror pushes, so a change made in Google is read rather than written over.
 *
 * `scope`: one person's calendar (the Refresh buttons) or, omitted, every writable Google calendar
 * (the 15-minute pass). Returns how many meetings changed length.
 */
export async function pullMeetingLengths(scope: { tenantId: string; userId: string } | null = null): Promise<{ changed: number; failed: number }> {
  let query = db()
    .from("tenant_connected_calendars")
    .select("id, tenant_id, user_id, status, refresh_token_ciphertext, scopes")
    .eq("provider", "google");
  if (scope) query = query.eq("tenant_id", scope.tenantId).eq("user_id", scope.userId);
  const connections = await query;
  if (connections.error) throw new Error(`Could not read linked calendars: ${connections.error.message}`);

  let changed = 0;
  let failed = 0;
  const now = Date.now();
  for (const connection of connections.data ?? []) {
    const scopes = Array.isArray(connection.scopes) ? (connection.scopes as string[]) : [];
    if (!text(connection.refresh_token_ciphertext) || !canWriteEvents(scopes) || text(connection.status) === "pending") continue;
    try {
      const token = await accessToken(connection);
      const events: Array<Record<string, unknown>> = [];
      let pageToken = "";
      for (let page = 0; page < 10; page += 1) {
        const query = new URLSearchParams({
          timeMin: new Date(now - 86_400_000).toISOString(),
          timeMax: new Date(now + BUSY_HORIZON_DAYS * 86_400_000).toISOString(),
          singleEvents: "true",
          maxResults: "2500",
        });
        if (pageToken) query.set("pageToken", pageToken);
        const response = await google(`${EVENTS_URL}?${query.toString()}`, token);
        if (!response.ok) return refused(response, "Reading the calendar");
        const body = (await response.json()) as { items?: Array<Record<string, unknown>>; nextPageToken?: string };
        events.push(...(body.items ?? []).filter((event) => appointmentIdOf(text(event.id))));
        pageToken = body.nextPageToken ?? "";
        if (!pageToken) break;
      }
      if (events.length === 0) continue;

      const ids = events.map((event) => appointmentIdOf(text(event.id)) as string);
      const rows = await db()
        .from("tenant_appointments")
        .select("id, starts_at_utc, duration_minutes, status")
        .eq("tenant_id", text(connection.tenant_id))
        .eq("agent_user_id", text(connection.user_id))
        .in("id", ids);
      if (rows.error) throw new Error(rows.error.message);
      const byId = new Map((rows.data ?? []).map((row) => [text(row.id), row]));
      for (const event of events) {
        const row = byId.get(appointmentIdOf(text(event.id)) as string);
        if (!row || mirrorAction(text(row.status)) !== "upsert") continue;
        const minutes = lengthChange(event as Parameters<typeof lengthChange>[0], { startsAtUtc: text(row.starts_at_utc), durationMinutes: Number(row.duration_minutes ?? 0) });
        if (minutes == null) continue;
        // The table's trigger moves ends_at_utc and the occupied range with it; an overlap with the
        // agent's next booking is refused by the exclusion constraint and left as it was.
        const saved = await db().from("tenant_appointments").update({ duration_minutes: minutes }).eq("id", text(row.id));
        if (saved.error) {
          console.error("[calendar-mirror] could not take the new length", text(row.id), saved.error.message);
          failed += 1;
        } else changed += 1;
      }
    } catch (error) {
      console.error("[calendar-mirror] reading meeting lengths", text(connection.id), error instanceof Error ? error.message : error);
      failed += 1;
    }
  }
  return { changed, failed };
}

async function accessToken(connection: Row): Promise<string> {
  const tokens = await busyTimeSource("google").refresh(decryptToken(text(connection.refresh_token_ciphertext)));
  if (tokens.refreshToken) {
    await db().from("tenant_connected_calendars").update({ refresh_token_ciphertext: encryptToken(tokens.refreshToken) }).eq("id", text(connection.id));
  }
  return tokens.accessToken;
}

async function google(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
}

async function refused(response: Response, what: string): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  throw new Error(`${what} refused (${response.status}): ${body.error?.message ?? "no detail"}`.slice(0, 500));
}

/** Update the event if it exists (a deleted one comes back), otherwise create it with our id. */
async function upsertEvent(token: string, appointment: MirroredAppointment): Promise<void> {
  const body = eventBody(appointment, appUrl());
  const id = eventIdFor(appointment.appointmentId);
  const updated = await google(`${EVENTS_URL}/${id}?sendUpdates=none`, token, { method: "PUT", body: JSON.stringify(body) });
  if (updated.ok) return;
  if (updated.status !== 404) return refused(updated, "Updating the meeting");
  const created = await google(`${EVENTS_URL}?sendUpdates=none`, token, { method: "POST", body: JSON.stringify(body) });
  if (created.ok) return;
  // 409: it exists after all (created by a pass running at the same moment). Update it.
  if (created.status === 409) {
    const retried = await google(`${EVENTS_URL}/${id}?sendUpdates=none`, token, { method: "PUT", body: JSON.stringify(body) });
    if (retried.ok) return;
    return refused(retried, "Updating the meeting");
  }
  return refused(created, "Adding the meeting");
}

/** True when an event was removed; false when there was none (never written, or already gone). */
async function removeEvent(token: string, appointmentId: string): Promise<boolean> {
  const response = await google(`${EVENTS_URL}/${eventIdFor(appointmentId)}?sendUpdates=none`, token, { method: "DELETE" });
  if (response.ok) return true;
  if (response.status === 404 || response.status === 410) return false;
  return refused(response, "Removing the meeting");
}
