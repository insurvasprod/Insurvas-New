import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/appointments/schemaGap";
import { DEFAULT_CADENCE, DEFAULT_CEILING, PREFERRED_TIMES, isDayPart, parseInterval, type CadenceRow, type PreferredTime } from "./engine";

/**
 * LA-2.7 · reading and writing the cadence rows that decide when a lead is dialled again.
 *
 * `tenant_cadence_rules` shipped with the cadence migration and, until this file, **nothing in the
 * product wrote it**. Its only readers are two SQL functions — `schedule_next_attempt` and the
 * serving query — and both are written to fall back to a hard-coded default table when they find
 * no row. So the table was empty on every tenant, the fallback ran every time, and the effect was
 * a product where every tenant dialled on the same fixed schedule while the schema, the engine in
 * `engine.ts` and the acceptance criterion all described a cadence you could change.
 *
 * Nothing looked broken, which is what made it survive: the fallback is a sensible cadence, so the
 * dialer behaved reasonably and the only symptom was that editing it was impossible.
 *
 * Criterion 2 is "cadence rows can be added, edited and deleted, per campaign". The `campaign_id`
 * column carries that: null is the tenant default, and a row naming a campaign overrides it for
 * that campaign only. The reader's ORDER BY — `(campaign_id is not null) desc` — is what makes the
 * override win, so the two scopes are stored in one table rather than two.
 */

export type CadenceScope = { campaignId: string | null };

export type StoredCadenceRow = CadenceRow & {
  id: string;
  campaignId: string | null;
};

type Row = {
  id: string;
  campaign_id: string | null;
  attempt_number: number;
  delay_interval: string;
  preferred_slot: string | null;
  disposition_scope: string | null;
};

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };
type Query = {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  insert(values: unknown): Query;
  delete(): Query;
  then(resolve: (value: Result<Row[]>) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};
type Db = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result<Row[]>>;
};

function db(): Db {
  return getSupabaseServiceClient() as unknown as Db;
}

function slot(value: string | null): PreferredTime | null {
  return value && (PREFERRED_TIMES as readonly string[]).includes(value) ? (value as PreferredTime) : null;
}

/** The campaign named in a save is not this tenant's (or no longer exists). Routes answer 404. */
export class CadenceCampaignError extends Error {
  constructor() {
    super("That campaign is not yours, or no longer exists.");
    this.name = "CadenceCampaignError";
  }
}

/** A save that needs 20260924230300 (the board's times of day) before it is applied. Routes answer 503. */
export class CadenceSchemaPendingError extends Error {
  constructor() {
    super("Morning, evening and opposite-half preferences need a database update that has not been applied yet.");
    this.name = "CadenceSchemaPendingError";
  }
}

/** True when the campaign exists and is this tenant's. Throws when the read itself fails. */
export async function campaignBelongsToTenant(tenantId: string, campaignId: string): Promise<boolean> {
  const result = await db().from("tenant_campaigns").select("id").eq("tenant_id", tenantId).eq("id", campaignId);
  if (result.error) throw new Error(`Could not check the campaign: ${result.error.message}`);
  return (result.data ?? []).length > 0;
}

/**
 * Whether 20260924230300 is applied — the scheduler that honours the board's times of day, dials
 * seven times, never merges a campaign cadence with the tenant default, and saves atomically.
 *
 * Probed by calling `replace_cadence_rules` with no tenant, which it refuses before touching any
 * row (`CADENCE_TENANT_REQUIRED`). A missing function answers PGRST202 instead. No write happens
 * either way.
 */
export async function cadenceSchemaReady(): Promise<boolean> {
  const probe = await db().rpc("replace_cadence_rules", { p_tenant_id: null, p_campaign_id: null, p_rows: [] });
  return Boolean(probe.error && /CADENCE_TENANT_REQUIRED/.test(probe.error.message));
}

function toRow(row: Row): StoredCadenceRow {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    attemptNumber: row.attempt_number,
    // Postgres renders an `interval` column as `02:00:00` or `1 day`, not as the `2 hours` the
    // editor accepts. Normalising here means the screen round-trips its own vocabulary instead of
    // showing the agent a form they cannot re-submit.
    delayInterval: humanInterval(row.delay_interval),
    preferredSlot: slot(row.preferred_slot),
    dispositionScope: row.disposition_scope,
  };
}

/** Turn Postgres's interval rendering back into the narrow "<n> <unit>" form the editor accepts. */
export function humanInterval(value: string): string {
  const trimmed = (value ?? "").trim();
  if (parseInterval(trimmed).ok) return trimmed;

  // `1 day 02:00:00`, `02:00:00`, `00:30:00`, `7 days`.
  const days = /^(\d+)\s+days?(?:\s+00:00:00)?$/i.exec(trimmed);
  if (days) return `${days[1]} ${days[1] === "1" ? "day" : "days"}`;

  const clock = /^(?:(\d+)\s+days?\s+)?(\d{2}):(\d{2}):(\d{2})$/i.exec(trimmed);
  if (clock) {
    const totalMinutes =
      Number(clock[1] ?? 0) * 1440 + Number(clock[2]) * 60 + Number(clock[3]);
    if (totalMinutes % 1440 === 0 && totalMinutes > 0) {
      const n = totalMinutes / 1440;
      return `${n} ${n === 1 ? "day" : "days"}`;
    }
    if (totalMinutes % 60 === 0 && totalMinutes > 0) {
      const n = totalMinutes / 60;
      return `${n} ${n === 1 ? "hour" : "hours"}`;
    }
    return `${totalMinutes} ${totalMinutes === 1 ? "minute" : "minutes"}`;
  }
  // Unrecognised shapes are returned untouched rather than guessed at. The screen shows what is
  // actually stored, and re-saving it will be refused by parseInterval with a message naming it.
  return trimmed;
}

export type CadenceView = {
  /** Rows for the requested scope, as stored. Empty means the defaults below are what runs. */
  rows: StoredCadenceRow[];
  /** True when the reader is falling through to the built-in table rather than to these rows. */
  usingDefaults: boolean;
  /** The built-in cadence, so the screen can show what "no rows" actually means. */
  defaults: CadenceRow[];
  /** Campaigns available to override, so the picker offers real names. */
  campaigns: { id: string; name: string }[];
  /**
   * For a campaign scope, the tenant-default rows. A campaign with no rules of its own runs them
   * (and, before 20260924230300, a campaign WITH rules fell back to them attempt by attempt), so
   * the screen needs them to show the ladder a campaign's leads actually walk. Empty for the
   * tenant scope.
   */
  fallbackRows: StoredCadenceRow[];
  /** 20260924230300 applied: day-part preferences, seven dials, no merging, atomic saves. */
  schemaReady: boolean;
  /** Max attempts for this scope (20260929201100). See `MaxAttemptsView`. */
  maxAttempts: MaxAttemptsView;
};

/**
 * LA-2.7-8 · max attempts, per tenant with a per-campaign override. `own` is this scope's stored
 * value (null = inherits), `inherited` what it falls back to, `effective` what the scheduler uses
 * for a lead with no recycle ceiling of its own. `ready` is false until 20260929201100 is applied,
 * when the scheduler still stops at the built-in seven and nothing can be saved.
 */
export type MaxAttemptsView = { own: number | null; inherited: number; effective: number; ready: boolean };

/** A save that needs a database update that has not been applied. Routes answer 503. */
export class CadenceLimitsPendingError extends Error {
  constructor() {
    super("This setting needs a database update that has not been applied yet.");
    this.name = "CadenceLimitsPendingError";
  }
}

type LimitRow = { campaign_id: string | null; max_attempts: number };

export async function getMaxAttempts(tenantId: string, campaignId: string | null): Promise<MaxAttemptsView> {
  const result = (await db()
    .from("tenant_cadence_limits")
    .select("campaign_id, max_attempts")
    .eq("tenant_id", tenantId)) as unknown as Result<LimitRow[]>;
  if (result.error) {
    if (isSchemaGap(result.error)) return { own: null, inherited: DEFAULT_CEILING, effective: DEFAULT_CEILING, ready: false };
    throw new Error(`Could not load max attempts: ${result.error.message}`);
  }
  const rows = result.data ?? [];
  const tenant = rows.find((row) => row.campaign_id === null)?.max_attempts ?? null;
  const campaign = campaignId ? rows.find((row) => row.campaign_id === campaignId)?.max_attempts ?? null : null;
  const own = campaignId ? campaign : tenant;
  const inherited = campaignId ? tenant ?? DEFAULT_CEILING : DEFAULT_CEILING;
  return { own, inherited, effective: own ?? inherited, ready: true };
}

/**
 * The ceiling the scheduler applies to a lead in this campaign before its own recycle ceiling:
 * cadence_max_attempts (20260929201100) — the campaign's, else the tenant's, else seven. Before that
 * migration the function is missing (42883 / PGRST202) and the scheduler's seven stands.
 */
export async function cadenceMaxAttempts(tenantId: string, campaignId: string | null): Promise<number> {
  const result = await db().rpc("cadence_max_attempts", { p_tenant_id: tenantId, p_campaign_id: campaignId });
  if (result.error || result.data == null) return DEFAULT_CEILING;
  const value = Number(result.data as unknown);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_CEILING;
}

/** Set (or, with null, clear) max attempts for one scope. Returns what the scope now runs. */
export async function saveMaxAttempts(input: { tenantId: string; campaignId: string | null; maxAttempts: number | null; userId: string }): Promise<number> {
  const result = await db().rpc("set_cadence_max_attempts", {
    p_tenant_id: input.tenantId,
    p_campaign_id: input.campaignId,
    p_max: input.maxAttempts,
    p_user_id: input.userId,
  });
  if (result.error) {
    if (isSchemaGap(result.error) || /could not find the function|PGRST202/i.test(`${result.error.code ?? ""} ${result.error.message}`))
      throw new CadenceLimitsPendingError();
    if (/CADENCE_CAMPAIGN_NOT_FOUND/.test(result.error.message)) throw new CadenceCampaignError();
    throw new Error(`Could not save max attempts: ${result.error.message}`);
  }
  return Number((result.data as unknown) ?? DEFAULT_CEILING);
}

export async function getCadence(tenantId: string, scope: CadenceScope): Promise<CadenceView> {
  let query = db()
    .from("tenant_cadence_rules")
    .select("id, campaign_id, attempt_number, delay_interval, preferred_slot, disposition_scope")
    .eq("tenant_id", tenantId);
  query = scope.campaignId ? query.eq("campaign_id", scope.campaignId) : query.is("campaign_id", null);

  const [rules, campaigns, fallback, schemaReady, maxAttempts] = await Promise.all([
    query.order("attempt_number", { ascending: true }),
    db().from("tenant_campaigns").select("id, name").eq("tenant_id", tenantId).order("name", { ascending: true }),
    scope.campaignId
      ? db()
          .from("tenant_cadence_rules")
          .select("id, campaign_id, attempt_number, delay_interval, preferred_slot, disposition_scope")
          .eq("tenant_id", tenantId)
          .is("campaign_id", null)
          .order("attempt_number", { ascending: true })
      : Promise.resolve({ data: [], error: null } as Result<Row[]>),
    cadenceSchemaReady().catch(() => false),
    getMaxAttempts(tenantId, scope.campaignId),
  ]);

  if (rules.error) throw new Error(`Could not load the cadence: ${rules.error.message}`);
  if (campaigns.error) throw new Error(`Could not load your campaigns: ${campaigns.error.message}`);
  if (fallback.error) throw new Error(`Could not load the tenant default cadence: ${fallback.error.message}`);

  const rows = (rules.data ?? []).map(toRow);
  return {
    rows,
    usingDefaults: rows.length === 0,
    defaults: DEFAULT_CADENCE,
    campaigns: (campaigns.data ?? []) as unknown as { id: string; name: string }[],
    fallbackRows: (fallback.data ?? []).map(toRow),
    schemaReady,
    maxAttempts,
  };
}

export async function saveCadence(input: {
  tenantId: string;
  scope: CadenceScope;
  rows: CadenceRow[];
  /** Who saved it, for the version row (20260925706200). */
  savedBy?: string | null;
}): Promise<StoredCadenceRow[]> {
  const client = db();

  // One transaction (20260924230300): the old rules stay in force until the new ones commit, so the
  // dialer never reads the built-in cadence in the middle of a save, and the campaign is checked
  // against the tenant inside the same statement that writes it. Since 20260925706200 the same
  // transaction also records the save as a version, which is what lets a campaign comparison say
  // which cadence each period ran.
  const args = {
    p_tenant_id: input.tenantId,
    p_campaign_id: input.scope.campaignId,
    p_rows: input.rows.map((row) => ({
      attemptNumber: row.attemptNumber,
      delayInterval: row.delayInterval,
      preferredSlot: row.preferredSlot ?? null,
      dispositionScope: row.dispositionScope ?? null,
    })),
  };
  let atomic = await client.rpc("replace_cadence_rules", { ...args, p_saved_by: input.savedBy ?? null });
  // Before 20260925706200 the function has no p_saved_by, and PostgREST reports the four-argument
  // call as a missing function. Retry the three-argument form rather than falling to the two-step
  // save below, which would give up the atomic replace 20260924230300 already provides.
  if (atomic.error && /could not find the function|PGRST202/i.test(`${atomic.error.code ?? ""} ${atomic.error.message}`))
    atomic = await client.rpc("replace_cadence_rules", args);
  if (!atomic.error) return (atomic.data ?? []).map(toRow);
  if (/CADENCE_CAMPAIGN_NOT_FOUND/.test(atomic.error.message)) throw new CadenceCampaignError();
  if (!isSchemaGap(atomic.error) && !/could not find the function/i.test(atomic.error.message))
    throw new Error(`Could not save the cadence: ${atomic.error.message}. Your previous cadence is unchanged.`);

  // ── before 20260924230300: the two-step replace, with a restore ──────────────────────────────
  // The old check constraint knows only the six fixed slots, so a day part is refused here, before
  // anything is deleted, rather than by Postgres halfway through.
  if (input.rows.some((row) => isDayPart(row.preferredSlot ?? null))) throw new CadenceSchemaPendingError();

  const scoped = (query: Query) =>
    input.scope.campaignId ? query.eq("campaign_id", input.scope.campaignId) : query.is("campaign_id", null);

  const payload = input.rows.map((row) => ({
    tenant_id: input.tenantId,
    campaign_id: input.scope.campaignId,
    attempt_number: row.attemptNumber,
    delay_interval: row.delayInterval,
    preferred_slot: row.preferredSlot ?? null,
    disposition_scope: row.dispositionScope ?? null,
  }));

  // The set is replaced rather than merged, because a cadence is a sequence and a merge cannot
  // express "attempt 4 is gone". The unique key on (tenant, campaign, attempt, disposition) means
  // the new rows cannot be written before the old ones are removed, so this cannot be reordered
  // the way the availability writer was — and a delete that succeeds followed by an insert that
  // fails would silently drop the tenant back onto the built-in cadence with no error trail.
  //
  // So the current rows are read first and restored if the insert fails. Delete is scoped to the
  // campaign being edited, so saving an override never touches the tenant default.
  const existing = await scoped(
    client
      .from("tenant_cadence_rules")
      .select("id, campaign_id, attempt_number, delay_interval, preferred_slot, disposition_scope")
      .eq("tenant_id", input.tenantId),
  );
  if (existing.error) throw new Error(`Could not read the current cadence: ${existing.error.message}`);
  const previous = existing.data ?? [];

  const removed = await scoped(client.from("tenant_cadence_rules").delete().eq("tenant_id", input.tenantId));
  if (removed.error) throw new Error(`Could not replace the cadence: ${removed.error.message}`);

  // An empty set is a legitimate save: it means "go back to the built-in cadence". Returning early
  // rather than inserting nothing keeps that meaning explicit.
  if (payload.length === 0) return [];

  const inserted = await client
    .from("tenant_cadence_rules")
    .insert(payload)
    .select("id, campaign_id, attempt_number, delay_interval, preferred_slot, disposition_scope");

  if (inserted.error) {
    if (previous.length > 0) {
      const restore = await client.from("tenant_cadence_rules").insert(
        previous.map((row) => ({
          tenant_id: input.tenantId,
          campaign_id: row.campaign_id,
          attempt_number: row.attempt_number,
          delay_interval: row.delay_interval,
          preferred_slot: row.preferred_slot,
          disposition_scope: row.disposition_scope,
        })),
      );
      // A failed restore is worse than a failed save and has to say so, rather than reporting the
      // original error and leaving the tenant quietly on the defaults.
      if (restore.error) {
        throw new Error(
          `Could not save the cadence (${inserted.error.message}), and the previous cadence could not be put back (${restore.error.message}). The built-in cadence is running until this is set again.`,
        );
      }
    }
    throw new Error(`Could not save the cadence: ${inserted.error.message}. Your previous cadence is unchanged.`);
  }
  return (inserted.data ?? []).map(toRow);
}
