import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { SchemaGapError, isSchemaGap } from "@/lib/appointments/schemaGap";
import {
  callingRuleErrorMessage,
  hhmm,
  type AddHolidayInput,
  type CallingHoliday,
  type CallingRulesBoard,
  type PublishRuleInput,
  type StateRuleVersion,
} from "./rulesModel";

/**
 * LA-2.4-2 / LA-2.4-3 · the super-admin side of the state calling rules.
 *
 * Reads every version of every state's rule and the holiday calendar; writes only through the four
 * security-definer functions of 20260929201000 (publish / withdraw a rule, add / remove a holiday),
 * which keep one rule per state per day and refuse a backdated or wider-than-federal rule. Before
 * that migration is applied the reads fall back to the old columns and every write raises
 * SchemaGapError, which the routes answer with 503.
 */

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };
type Row = Record<string, unknown>;
type Query = PromiseLike<Result<Row[]>> & {
  select(columns: string): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
};
type Db = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result<unknown>>;
};

const db = () => getSupabaseServiceClient() as unknown as Db;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const day = (value: unknown) => text(value).slice(0, 10);

const RULE_COLUMNS = "id, state_code, effective_from, effective_to, start_local, end_local, allowed_weekdays, block_holidays, source, notes";
const RULE_NEW = ", sunday_start_local, sunday_end_local, created_at";
const HOLIDAY_COLUMNS = "id, state_code, holiday_date, name, blocked";
const HOLIDAY_NEW = ", source";

export class CallingRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallingRuleError";
  }
}

function toVersion(row: Row): StateRuleVersion {
  return {
    id: text(row.id),
    state: text(row.state_code),
    effectiveFrom: day(row.effective_from),
    effectiveTo: row.effective_to ? day(row.effective_to) : null,
    startLocal: hhmm(text(row.start_local)) ?? "08:00",
    endLocal: hhmm(text(row.end_local)) ?? "21:00",
    allowedWeekdays: Array.isArray(row.allowed_weekdays) ? (row.allowed_weekdays as unknown[]).map(Number) : [0, 1, 2, 3, 4, 5, 6],
    sundayStartLocal: hhmm(text(row.sunday_start_local)),
    sundayEndLocal: hhmm(text(row.sunday_end_local)),
    blockHolidays: row.block_holidays !== false,
    source: text(row.source),
    notes: text(row.notes) || null,
    createdAt: text(row.created_at) || null,
  };
}

function toHoliday(row: Row): CallingHoliday {
  return {
    id: text(row.id),
    state: text(row.state_code) || null,
    date: day(row.holiday_date),
    name: text(row.name),
    source: text(row.source) || null,
    blocked: row.blocked !== false,
  };
}

export type { CallingRulesBoard } from "./rulesModel";

export async function getCallingRulesBoard(): Promise<CallingRulesBoard> {
  const client = db();
  const readRules = (columns: string) => client.from("calling_window_state_rules").select(columns).order("effective_from", { ascending: true });
  const readHolidays = (columns: string) => client.from("calling_window_holidays").select(columns).order("holiday_date", { ascending: true });

  const [zones, firstRules, firstHolidays, feed] = await Promise.all([
    client.from("calling_window_state_timezones").select("state_code, timezone").order("state_code", { ascending: true }),
    readRules(RULE_COLUMNS + RULE_NEW),
    readHolidays(HOLIDAY_COLUMNS + HOLIDAY_NEW),
    client.rpc("calling_window_rules_freshness", {}),
  ]);
  const schemaReady = !isSchemaGap(firstRules.error) && !isSchemaGap(firstHolidays.error);
  const rules = isSchemaGap(firstRules.error) ? await readRules(RULE_COLUMNS) : firstRules;
  const holidays = isSchemaGap(firstHolidays.error) ? await readHolidays(HOLIDAY_COLUMNS) : firstHolidays;

  if (zones.error) throw new Error(`Could not load the states: ${zones.error.message}`);
  if (rules.error) throw new Error(`Could not load the state rules: ${rules.error.message}`);
  if (holidays.error) throw new Error(`Could not load the holidays: ${holidays.error.message}`);

  const feedRow = !feed.error && Array.isArray(feed.data) ? (feed.data as Row[])[0] : undefined;
  return {
    states: (zones.data ?? []).map((row) => ({ state: text(row.state_code), timezone: text(row.timezone) || null })),
    versions: (rules.data ?? []).map(toVersion),
    holidays: (holidays.data ?? []).map(toHoliday),
    feed: feedRow
      ? {
          lastRefreshedAt: text(feedRow.last_refreshed_at),
          source: text(feedRow.source),
          staleAfterDays: Number(feedRow.stale_after_days ?? 0),
          stale: feedRow.stale === true,
        }
      : null,
    schemaReady,
  };
}

const missingFunction = (error: { message: string; code?: string }) =>
  isSchemaGap(error) || /could not find the function|PGRST202/i.test(`${error.code ?? ""} ${error.message}`);

async function call<T>(name: string, args: Record<string, unknown>, map: (row: Row) => T): Promise<T> {
  const result = await db().rpc(name, args);
  if (result.error) {
    if (missingFunction(result.error)) throw new SchemaGapError();
    throw new CallingRuleError(callingRuleErrorMessage(result.error.message));
  }
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as Row | null;
  if (!row) throw new CallingRuleError("The database did not return the saved row.");
  return map(row);
}

const time = (value: string | null) => (value ? `${value}:00` : null);

export function publishStateRule(input: PublishRuleInput, adminId: string): Promise<StateRuleVersion> {
  return call(
    "publish_calling_window_state_rule",
    {
      p_state: input.state,
      p_effective_from: input.effectiveFrom,
      p_start: time(input.startLocal),
      p_end: time(input.endLocal),
      p_allowed_weekdays: [...new Set(input.allowedWeekdays)].sort((a, b) => a - b),
      p_sunday_start: time(input.sundayStartLocal),
      p_sunday_end: time(input.sundayEndLocal),
      p_block_holidays: input.blockHolidays,
      p_source: input.source,
      p_notes: input.notes ?? null,
      p_admin_id: adminId,
    },
    toVersion,
  );
}

export function withdrawStateRule(id: string): Promise<StateRuleVersion> {
  return call("withdraw_calling_window_state_rule", { p_id: id }, toVersion);
}

export function addHoliday(input: AddHolidayInput, adminId: string): Promise<CallingHoliday> {
  return call(
    "add_calling_window_holiday",
    { p_state: input.state, p_date: input.date, p_name: input.name, p_source: input.source ?? null, p_admin_id: adminId },
    toHoliday,
  );
}

export function removeHoliday(id: string): Promise<CallingHoliday> {
  return call("remove_calling_window_holiday", { p_id: id }, toHoliday);
}

/**
 * The reviewer confirms the rules as they stand. Stamps the rules feed (20260924230100), which the
 * dial check refuses every call without once it is older than its limit.
 */
export async function markRulesReviewed(adminId: string): Promise<string> {
  const result = await db().rpc("mark_calling_window_rules_refreshed", { p_source: `Reviewed in the calling rules editor by admin ${adminId}` });
  if (result.error) {
    if (missingFunction(result.error)) throw new SchemaGapError();
    throw new CallingRuleError(result.error.message);
  }
  return text(result.data);
}
