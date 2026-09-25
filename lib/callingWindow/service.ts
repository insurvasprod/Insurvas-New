import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { SchemaGapError, isSchemaGap } from "@/lib/appointments/schemaGap";
import {
  DEFAULT_OPTIONS,
  FEDERAL_WINDOW,
  hoursFor,
  type CallingWindow,
  type CallingWindowOptions,
  type CallingWindowSettings,
  type MinuteWindow,
} from "./engine";

/**
 * LA-2.4 · reading and writing the hours this tenant is willing to dial in.
 *
 * `tenant_calling_windows` had grants for `tenant_app`, a constraint refusing inverted windows, a
 * reader inside `tenant_can_dial_now` — and no writer anywhere in the product. It was empty on
 * every tenant, so the `if found` branch in that function never ran and the tenant layer of a
 * four-layer tightening rule was permanently absent.
 *
 * That is not the same kind of hole as the disclosure table. Nothing broke: federal and state
 * rules still applied, and the effect of a missing tenant row is "no extra narrowing". The gap was
 * that an agency wanting to stop calling at 19:00 in every state had no way to say so, and no way
 * to see that the setting they believed they had was not there.
 *
 * Every layer may only narrow — `greatest(start)`, `least(end)`, in both the SQL and the
 * TypeScript engine. A tenant asking to dial 07:00–22:00 does not get it; the federal floor wins.
 * The screen has to say that plainly, because a settings field that silently does nothing is
 * worse than one that is absent.
 *
 * 20260924121000 adds minutes (7:30 pm), the agency's three switches and a reason per campaign.
 * Until it is applied, reads fall back to the hour-only shape and a write that needs the new
 * schema raises `SchemaGapError`, which the route turns into a 503 with a sentence.
 */

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };
type Row = Record<string, unknown>;
type Query = PromiseLike<Result<Row[]>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  gte(column: string, value: unknown): Query;
  limit(count: number): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  update(values: unknown): Query;
  delete(): Query;
  upsert(values: unknown, options?: { onConflict?: string }): Query;
  maybeSingle<T>(): Promise<Result<T>>;
};
type Db = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>>;
};

function db(): Db {
  return getSupabaseServiceClient() as unknown as Db;
}

export type { StateRuleInForce, CallingWindowSettings } from "./engine";
export { effectiveWindow } from "./engine";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const int = (value: unknown) => (value == null ? null : Number(value));

const TENANT_COLUMNS = "start_hour, end_hour, start_minute, end_minute";
const TENANT_LEGACY = "start_hour, end_hour";
const CAMPAIGN_COLUMNS =
  "id, name, calling_window_start_hour, calling_window_end_hour, calling_window_start_minute, calling_window_end_minute, calling_window_reason";
const CAMPAIGN_LEGACY = "id, name, calling_window_start_hour, calling_window_end_hour";

export async function getCallingWindows(tenantId: string): Promise<CallingWindowSettings> {
  const client = db();
  const readTenant = (columns: string) =>
    client.from("tenant_calling_windows").select(columns).eq("tenant_id", tenantId).maybeSingle<Row>();
  const readCampaigns = (columns: string) =>
    client.from("tenant_campaigns").select(columns).eq("tenant_id", tenantId).order("name", { ascending: true });
  const today = new Date().toISOString().slice(0, 10);

  const [firstTenant, firstCampaigns, rules, options, holidays, feed, leadStates, licensed, agencyLicences] = await Promise.all([
    readTenant(TENANT_COLUMNS),
    readCampaigns(CAMPAIGN_COLUMNS),
    client.rpc("calling_window_rules_in_force", {}),
    client
      .from("tenant_calling_window_options")
      .select("no_sunday, no_federal_holidays, campaign_overrides_enabled")
      .eq("tenant_id", tenantId)
      .maybeSingle<Row>(),
    // Federal holidays are the rows with no state. Read so the screen can say which dates the
    // "No federal holidays" switch will actually block, and when the calendar runs out.
    client
      .from("calling_window_holidays")
      .select("holiday_date, name")
      .is("state_code", null)
      .gte("holiday_date", today)
      .order("holiday_date", { ascending: true })
      .limit(12),
    // 20260924230100: when the state rules were last refreshed, and whether the dial check now
    // refuses because they are stale. Absent before that migration.
    client.rpc("calling_window_rules_freshness", {}),
    // The states this agency works: its live leads' states (20260924230100), its members' licensed
    // states (20260924110000) and the agency's own licences. Any may be absent; all are garnish.
    client.rpc("tenant_dialing_states", { p_tenant_id: tenantId }),
    client.from("tenant_user_licensed_states").select("state").eq("tenant_id", tenantId).limit(500),
    client.from("licenses").select("state").eq("tenant_id", tenantId).limit(500),
  ]);

  // Before 20260924121000 the minute and reason columns and the options table are absent. The page
  // still loads in the old shape and says which settings cannot be saved yet.
  const schemaReady = !isSchemaGap(firstTenant.error) && !isSchemaGap(firstCampaigns.error) && !isSchemaGap(options.error);
  const tenant = isSchemaGap(firstTenant.error) ? await readTenant(TENANT_LEGACY) : firstTenant;
  const campaigns = isSchemaGap(firstCampaigns.error) ? await readCampaigns(CAMPAIGN_LEGACY) : firstCampaigns;

  if (tenant.error) throw new Error(`Could not load your calling window: ${tenant.error.message}`);
  if (campaigns.error) throw new Error(`Could not load your campaigns: ${campaigns.error.message}`);
  if (options.error && !isSchemaGap(options.error))
    throw new Error(`Could not load your calling-window switches: ${options.error.message}`);

  const ruleRows = Array.isArray(rules.data) ? (rules.data as Row[]) : [];
  const feedRow = !feed.error && Array.isArray(feed.data) ? (feed.data as Row[])[0] : undefined;
  const workedStates = [
    ...(!leadStates.error && Array.isArray(leadStates.data) ? (leadStates.data as Row[]) : []),
    ...(!licensed.error ? licensed.data ?? [] : []),
    ...(!agencyLicences.error ? agencyLicences.data ?? [] : []),
  ]
    .map((row) => text(row.state).trim().toUpperCase())
    .filter((state) => /^[A-Z]{2}$/.test(state));
  const dialingStates =
    leadStates.error && licensed.error && agencyLicences.error ? null : [...new Set(workedStates)];

  return {
    federal: FEDERAL_WINDOW,
    tenant: tenant.data
      ? {
          startHour: Number(tenant.data.start_hour),
          endHour: Number(tenant.data.end_hour),
          startMinute: int(tenant.data.start_minute),
          endMinute: int(tenant.data.end_minute),
        }
      : null,
    campaigns: (campaigns.data ?? []).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      startHour: int(row.calling_window_start_hour),
      endHour: int(row.calling_window_end_hour),
      startMinute: int(row.calling_window_start_minute),
      endMinute: int(row.calling_window_end_minute),
      reason: text(row.calling_window_reason) || null,
    })),
    // A failing rules function means the state table is not deployed, not that no state has rules.
    // Reporting an empty list would tell an owner their agency is federal-only, which is a claim
    // about compliance and not one to make from a missing function.
    stateRulesAvailable: !rules.error,
    stateRules: ruleRows
      .map((row) => ({
        state: text(row.state),
        startHour: Number(row.start_hour),
        endHour: Number(row.end_hour),
        noSunday: row.no_sunday === true,
        noHolidays: row.no_holidays === true,
      }))
      .sort((a, b) => a.state.localeCompare(b.state)),
    options: options.data
      ? {
          noSunday: options.data.no_sunday === true,
          noFederalHolidays: options.data.no_federal_holidays === true,
          campaignOverrides: options.data.campaign_overrides_enabled !== false,
        }
      : { ...DEFAULT_OPTIONS },
    schemaReady,
    federalHolidays: holidays.error
      ? null
      : (holidays.data ?? []).map((row) => ({ date: text(row.holiday_date).slice(0, 10), name: text(row.name) })),
    rulesFeed: feedRow
      ? {
          lastRefreshedAt: text(feedRow.last_refreshed_at),
          source: text(feedRow.source),
          staleAfterDays: Number(feedRow.stale_after_days ?? 0),
          stale: feedRow.stale === true,
        }
      : null,
    dialingStates,
  };
}

/**
 * The dial check's own reason when the state rules are stale (20260924230100), or null when they
 * are fresh or the stamp does not exist yet. The dialer asks this only after the window refused,
 * so a fresh feed costs nothing on the ready path.
 */
export async function staleRulesReason(now = new Date()): Promise<string | null> {
  const feed = await db().rpc("calling_window_rules_freshness", {});
  if (feed.error || !Array.isArray(feed.data)) return null;
  const row = (feed.data as Row[])[0];
  if (!row || row.stale !== true) return null;
  const at = new Date(text(row.last_refreshed_at));
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  const when = Number.isNaN(at.getTime())
    ? "at an unknown time"
    : at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `Dialing is blocked because the state calling rules were last refreshed ${when}${Number.isFinite(days) ? `, ${days} days ago` : ""}. A stale feed refuses the dial rather than guessing.`;
}

const whole = (window: MinuteWindow) => window.start % 60 === 0 && window.end % 60 === 0;

export async function saveTenantCallingWindow(input: {
  tenantId: string;
  userId: string;
  window: MinuteWindow | null;
}): Promise<CallingWindow | null> {
  const client = db();

  if (input.window === null) {
    // Clearing means "add no narrowing of our own", which is the absence of a row — the same state
    // every tenant was stuck in before this file existed. It is a legitimate choice, so it deletes
    // rather than storing 8–21, which would look like a deliberate setting in the table.
    const removed = await client.from("tenant_calling_windows").delete().eq("tenant_id", input.tenantId);
    if (removed.error) throw new Error(`Could not clear your calling window: ${removed.error.message}`);
    return null;
  }

  const window = input.window;
  const hours = hoursFor(window);
  const write = (withMinutes: boolean) =>
    client
      .from("tenant_calling_windows")
      .upsert(
        {
          tenant_id: input.tenantId,
          start_hour: hours.startHour,
          end_hour: hours.endHour,
          ...(withMinutes ? { start_minute: window.start, end_minute: window.end } : {}),
          updated_at: new Date().toISOString(),
          updated_by: input.userId,
        },
        { onConflict: "tenant_id" },
      )
      .select("start_hour, end_hour")
      .maybeSingle<Row>();

  let saved = await write(true);
  if (isSchemaGap(saved.error)) {
    // Whole hours are exactly what the old columns hold, so they still save before the migration.
    if (!whole(window)) throw new SchemaGapError();
    saved = await write(false);
  }

  if (saved.error) {
    // `tenant_calling_windows_sane` is `start_hour < end_hour`. The route refuses this first, so
    // reaching here means something else sent it — and the constraint name is not a sentence.
    if (saved.error.message.includes("tenant_calling_windows_sane") || saved.error.message.includes("minutes_sane"))
      throw new Error("A calling window has to end after it starts.");
    throw new Error(`Could not save your calling window: ${saved.error.message}`);
  }
  if (!saved.data) throw new Error("The calling window did not save.");
  return { startHour: Number(saved.data.start_hour), endHour: Number(saved.data.end_hour) };
}

export async function saveCallingWindowOptions(input: {
  tenantId: string;
  userId: string;
  options: CallingWindowOptions;
}): Promise<void> {
  const saved = await db()
    .from("tenant_calling_window_options")
    .upsert(
      {
        tenant_id: input.tenantId,
        no_sunday: input.options.noSunday,
        no_federal_holidays: input.options.noFederalHolidays,
        campaign_overrides_enabled: input.options.campaignOverrides,
        updated_at: new Date().toISOString(),
        updated_by: input.userId,
      },
      { onConflict: "tenant_id" },
    )
    .select("tenant_id")
    .maybeSingle<Row>();
  if (isSchemaGap(saved.error)) throw new SchemaGapError();
  if (saved.error) throw new Error(`Could not save your calling-window switches: ${saved.error.message}`);
}

export async function saveCampaignCallingWindow(input: {
  tenantId: string;
  campaignId: string;
  window: MinuteWindow | null;
  reason?: string | null;
}): Promise<void> {
  const window = input.window;
  const hours = window ? hoursFor(window) : null;
  const reason = input.reason?.trim() || null;
  const write = (withNew: boolean) =>
    db()
      .from("tenant_campaigns")
      .update({
        calling_window_start_hour: hours?.startHour ?? null,
        calling_window_end_hour: hours?.endHour ?? null,
        ...(withNew
          ? {
              calling_window_start_minute: window?.start ?? null,
              calling_window_end_minute: window?.end ?? null,
              // Clearing the narrowing clears its reason: a reason for a limit that is gone is noise.
              calling_window_reason: window ? reason : null,
            }
          : {}),
      })
      .eq("tenant_id", input.tenantId)
      .eq("id", input.campaignId)
      .select("id")
      .maybeSingle<Row>();

  let result = await write(true);
  if (isSchemaGap(result.error)) {
    if (window && (!whole(window) || reason)) throw new SchemaGapError();
    result = await write(false);
  }

  if (result.error) throw new Error(`Could not save that campaign's calling window: ${result.error.message}`);
  if (!result.data) throw new Error("That campaign is not yours, or no longer exists.");
}
