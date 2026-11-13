import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { SchemaGapError, isSchemaGap } from "@/lib/appointments/schemaGap";
import type { DayOff } from "./week";

/**
 * Settings › Calling windows round 8 — the agency's week and its own days off (20261112300000).
 *
 * Both tables are new. Before that migration is applied every read answers `ready: false` with no
 * rows (the week is the base hours on every day, there are no days off) and every write that needs
 * them raises `SchemaGapError`, which the route turns into "needs a database update".
 */

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };
type Row = Record<string, unknown>;
type Query = PromiseLike<Result<Row[]>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  insert(values: unknown): Query;
  delete(): Query;
};
type Db = { from(table: string): Query };

const db = () => getSupabaseServiceClient() as unknown as Db;
const int = (value: unknown) => (value == null ? null : Number(value));

export type DayRow = { weekday: number; closed: boolean; start: number | null; end: number | null };
export type WeekStore = { ready: boolean; days: DayRow[]; daysOff: DayOff[] };

export async function readWeek(tenantId: string, today = new Date().toISOString().slice(0, 10)): Promise<WeekStore> {
  const client = db();
  const [days, off] = await Promise.all([
    client.from("tenant_calling_window_days").select("weekday, closed, start_minute, end_minute").eq("tenant_id", tenantId),
    client.from("tenant_calling_days_off").select("day, from_minute, label").eq("tenant_id", tenantId).gte("day", today).order("day", { ascending: true }).limit(100),
  ]);
  if (isSchemaGap(days.error) || isSchemaGap(off.error)) return { ready: false, days: [], daysOff: [] };
  if (days.error) throw new Error(`Could not load your calling week: ${days.error.message}`);
  if (off.error) throw new Error(`Could not load your days off: ${off.error.message}`);
  return {
    ready: true,
    days: (days.data ?? []).map((row) => ({ weekday: Number(row.weekday), closed: row.closed === true, start: int(row.start_minute), end: int(row.end_minute) })),
    daysOff: (off.data ?? []).map((row) => ({ date: String(row.day).slice(0, 10), fromMinute: int(row.from_minute), label: typeof row.label === "string" ? row.label : "" })),
  };
}

/** Replace the agency's per-day rows. An empty list means every day keeps the base hours. */
export async function saveWeekDays(input: { tenantId: string; userId: string; rows: DayRow[] }): Promise<void> {
  const client = db();
  const removed = await client.from("tenant_calling_window_days").delete().eq("tenant_id", input.tenantId);
  if (isSchemaGap(removed.error)) {
    if (input.rows.length === 0) return;
    throw new SchemaGapError();
  }
  if (removed.error) throw new Error(`Could not save your calling week: ${removed.error.message}`);
  if (input.rows.length === 0) return;
  const now = new Date().toISOString();
  const inserted = await client.from("tenant_calling_window_days").insert(
    input.rows.map((row) => ({
      tenant_id: input.tenantId,
      weekday: row.weekday,
      closed: row.closed,
      start_minute: row.closed ? null : row.start,
      end_minute: row.closed ? null : row.end,
      updated_at: now,
      updated_by: input.userId,
    })),
  );
  if (inserted.error) throw new Error(`Could not save your calling week: ${inserted.error.message}`);
}

/** Replace the agency's upcoming days off (past ones stay as they were). */
export async function saveDaysOff(input: { tenantId: string; userId: string; daysOff: DayOff[]; today?: string }): Promise<void> {
  const client = db();
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const removed = await client.from("tenant_calling_days_off").delete().eq("tenant_id", input.tenantId).gte("day", today);
  if (isSchemaGap(removed.error)) {
    if (input.daysOff.length === 0) return;
    throw new SchemaGapError();
  }
  if (removed.error) throw new Error(`Could not save your days off: ${removed.error.message}`);
  const upcoming = input.daysOff.filter((day) => day.date >= today);
  if (upcoming.length === 0) return;
  const inserted = await client.from("tenant_calling_days_off").insert(
    upcoming.map((day) => ({ tenant_id: input.tenantId, day: day.date, from_minute: day.fromMinute, label: day.label.slice(0, 80), created_by: input.userId })),
  );
  if (inserted.error) {
    if (inserted.error.message.includes("one_per_day")) throw new Error("Each date can only be one day off.");
    throw new Error(`Could not save your days off: ${inserted.error.message}`);
  }
}
