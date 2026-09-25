import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizePreview, type QueuePreview } from "@/lib/scoring/preview";

type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query<T> = PromiseLike<Result<T>> & {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: readonly unknown[]): Query<T>;
  not(column: string, operator: string, value: unknown): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
  upsert(value: unknown, options?: unknown): Query<T>;
  delete(): Query<T>;
  maybeSingle(): Promise<Result<T | null>>;
};
type Db = {
  from(table: string): Query<Array<Record<string, unknown>>>;
  rpc(name: string, args?: Record<string, unknown>): Promise<Result<unknown>>;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** A read against schema a later migration adds: missing column, table or function. */
function isMissingSchema(error: { message: string; code?: string } | null | undefined) {
  if (!error) return false;
  if (["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  return /does not exist|could not find the function|schema cache/i.test(error.message);
}

/** The holdout comparison's window. The board reads "last 14 days"; all-time is the toggle. */
export type ScoringPeriod = "14d" | "all";
export const SCORING_PERIOD_DAYS = 14;

/** A vendor's contact rate is shown (and scored on) only from this many dispositioned dials. */
export const VENDOR_RATE_MIN_ATTEMPTS = 30;

/**
 * LA-2.13 · the scoring surface, which had no reader at all.
 *
 * `tenant_scoring_settings`, `tenant_scoring_weights`, `tenant_scoring_decisions` and
 * `tenant_scoring_cohort_stats` were all deployed and **none of them was read by the application**.
 * Two acceptance criteria are about exactly that:
 *
 *   c3 "The holdout is real, and its contact rate is **reported** alongside the scored cohort."
 *   c6 "Weights are **inspectable and adjustable**."
 *
 * The task says why the first one matters more than it looks: "Without a holdout, the model's value
 * is a claim rather than a measurement. Ray will ask whether it works. *Contact rate 14.2% scored
 * versus 11.8% control, over 4,000 dials* is an answer. *It uses machine learning* is not."
 *
 * A view nobody reads cannot answer that question, so neither criterion was met however correct the
 * SQL was.
 */

/** The seven signals from the task's own table. Labels and blurbs live here, not in the database. */
export const SCORING_SIGNALS: Array<{ signal: string; label: string; blurb: string }> = [
  { signal: "time_of_day_fit", label: "Time-of-day fit", blurb: "This age band and state, at this hour, from historical contact data." },
  { signal: "slot_freshness", label: "Slot freshness", blurb: "Slots this lead has not failed in yet." },
  { signal: "vendor_contact_rate", label: "Vendor contact rate", blurb: "Historic reachability of the source: one vendor contacts at 14%, another at 6%." },
  { signal: "attempt_position", label: "Attempt number", blurb: "Attempts two and three convert best; the seventh rarely does." },
  { signal: "completeness", label: "Data completeness", blurb: "A record with a date of birth and full address outperforms a bare name and number." },
  { signal: "recency", label: "Lead age", blurb: "Newer leads first. Fresher is better, sharply so." },
  { signal: "consent_artefact", label: "Consent artefact present", blurb: "Both a compliance signal and a quality one." },
];

export type ScoringOverview = {
  enabled: boolean;
  holdoutPct: number;
  weights: Array<{ signal: string; label: string; blurb: string; weight: number; isDefault: boolean; defaultWeight: number | null }>;
  cohorts: Array<{ cohort: string; served: number; contacted: number; contactRatePct: number | null; averageScore: number | null; since: string | null }>;
  /** The window the cohorts cover. "all" also when 14 days was asked for and 20260925701000 is not applied. */
  period: ScoringPeriod;
  periodFrom: string | null;
  /** False until 20260925701000 is applied: only the all-time comparison exists. */
  periodSupported: boolean;
  /** Per-vendor contact rate, from the counters the scorer reads — only vendors with 30+ dials. */
  vendorRates: Array<{ vendorId: string; name: string; attempts: number; contacts: number; ratePct: number }>;
};

type CohortRow = ScoringOverview["cohorts"][number];

function cohortRows(rows: Array<Record<string, unknown>> | null | undefined): CohortRow[] {
  return (rows ?? []).map((cohort) => ({
    cohort: text(cohort.cohort),
    served: Number(cohort.served ?? 0),
    contacted: Number(cohort.contacted ?? 0),
    contactRatePct: cohort.contact_rate_pct === null || cohort.contact_rate_pct === undefined ? null : Number(cohort.contact_rate_pct),
    averageScore: cohort.average_score === null || cohort.average_score === undefined ? null : Number(cohort.average_score),
    since: cohort.since === null || cohort.since === undefined ? null : text(cohort.since),
  }));
}

/**
 * The holdout arms over the chosen window. 14 days reads tenant_scoring_cohort_stats_since
 * (20260925701000); before that migration is applied, or for all-time, the all-time view.
 */
async function readCohorts(db: Db, tenantId: string, period: ScoringPeriod) {
  const from = period === "14d" ? new Date(Date.now() - SCORING_PERIOD_DAYS * 86_400_000).toISOString() : null;
  const since = await db.rpc("tenant_scoring_cohort_stats_since", { p_tenant_id: tenantId, p_from: from });
  if (!since.error) {
    return { cohorts: cohortRows(since.data as Array<Record<string, unknown>> | null), period, periodFrom: from, periodSupported: true };
  }
  if (!isMissingSchema(since.error)) throw new Error(`Could not load the holdout comparison: ${since.error.message}`);
  // Not applied yet: the all-time view, labelled as all-time whatever was asked for.
  const all = await db.from("tenant_scoring_cohort_stats")
    .select("cohort, served, contacted, contact_rate_pct, average_score, since")
    .eq("tenant_id", tenantId);
  if (all.error) throw new Error(`Could not load the holdout comparison: ${all.error.message}`);
  return { cohorts: cohortRows(all.data), period: "all" as ScoringPeriod, periodFrom: null, periodSupported: false };
}

/**
 * Live vendor contact rates for the "Vendor contact rate" signal's detail line: the same counters
 * score_lead reads (tenant_contact_rate_stats, scope 'vendor'), and the same 30-dial floor below
 * which the scorer treats a vendor as neutral. A quality figure, not a cost one.
 */
async function readVendorRates(db: Db, tenantId: string): Promise<ScoringOverview["vendorRates"]> {
  const stats = await db.from("tenant_contact_rate_stats").select("key, attempts, contacts").eq("tenant_id", tenantId).eq("scope", "vendor");
  if (stats.error) {
    if (isMissingSchema(stats.error)) return [];
    throw new Error(`Could not load vendor contact rates: ${stats.error.message}`);
  }
  const counted = (stats.data ?? [])
    .map((row) => ({ vendorId: text(row.key), attempts: Number(row.attempts ?? 0), contacts: Number(row.contacts ?? 0) }))
    .filter((row) => row.vendorId && row.attempts >= VENDOR_RATE_MIN_ATTEMPTS);
  if (counted.length === 0) return [];
  const vendors = await db.from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId).in("id", counted.map((row) => row.vendorId));
  if (vendors.error && !isMissingSchema(vendors.error)) throw new Error(`Could not load vendor names: ${vendors.error.message}`);
  const names = new Map(((vendors.error ? [] : vendors.data) ?? []).map((row) => [text(row.id), text(row.name)]));
  return counted
    // A vendor that no longer exists in this tenant is not named, and not shown.
    .filter((row) => names.has(row.vendorId))
    .map((row) => ({ ...row, name: names.get(row.vendorId) ?? "", ratePct: (100 * row.contacts) / row.attempts }))
    .sort((a, b) => b.ratePct - a.ratePct || b.attempts - a.attempts);
}

export async function scoringOverview(tenantId: string, period: ScoringPeriod = "14d"): Promise<ScoringOverview> {
  const db = getSupabaseServiceClient() as unknown as Db;

  const [settings, effective, overrides, cohortRead, defaults, vendorRates] = await Promise.all([
    db.from("tenant_scoring_settings").select("enabled, holdout_pct").eq("tenant_id", tenantId).maybeSingle(),
    // The EFFECTIVE weights, defaults merged with this tenant's overrides — the same function the
    // scorer itself reads, so the screen cannot show one number while the queue uses another.
    db.rpc("scoring_weights_for", { p_tenant_id: tenantId }),
    db.from("tenant_scoring_weights").select("signal, weight").eq("tenant_id", tenantId),
    readCohorts(db, tenantId, period),
    // The platform defaults, so a weight's Reset returns it to a real value rather than a guess.
    db.rpc("default_scoring_weights"),
    readVendorRates(db, tenantId),
  ]);

  if (settings.error) throw new Error(`Could not load scoring settings: ${settings.error.message}`);
  if (effective.error) throw new Error(`Could not load scoring weights: ${effective.error.message}`);
  if (overrides.error) throw new Error(`Could not load weight overrides: ${overrides.error.message}`);

  const bySignal = new Map<string, number>();
  for (const row of (effective.data as Array<{ signal?: string; weight?: number }> | null) ?? []) {
    if (row?.signal) bySignal.set(row.signal, Number(row.weight ?? 0));
  }
  const defaultBySignal = new Map<string, number>();
  for (const row of ((defaults.error ? [] : defaults.data) as Array<{ signal?: string; weight?: number }> | null) ?? []) {
    if (row?.signal) defaultBySignal.set(row.signal, Number(row.weight ?? 0));
  }
  const overridden = new Set(
    ((overrides.data as Array<{ signal?: string }> | null) ?? []).map((row) => text(row.signal)),
  );

  const row = (settings.data ?? {}) as { enabled?: boolean; holdout_pct?: number };
  return {
    // Off by default, and the coalesce is the reason criterion 4 holds for a tenant row that does
    // not exist yet.
    enabled: row.enabled === true,
    holdoutPct: Number(row.holdout_pct ?? 0),
    weights: SCORING_SIGNALS.map((signal) => ({
      ...signal,
      weight: bySignal.get(signal.signal) ?? 0,
      // Shown, because "this is the platform default" and "somebody here chose this" are different
      // facts and only one of them is worth revisiting.
      isDefault: !overridden.has(signal.signal),
      defaultWeight: defaultBySignal.get(signal.signal) ?? null,
    })),
    cohorts: cohortRead.cohorts,
    period: cohortRead.period,
    periodFrom: cohortRead.periodFrom,
    periodSupported: cohortRead.periodSupported,
    vendorRates,
  };
}

/** Who can be chosen for the preview: the members who can press Serve next (owner, producer, setter). */
export async function scoringAgents(tenantId: string): Promise<Array<{ userId: string; name: string; role: string }>> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const members = await db.from("tenant_users")
    .select("user_id, role, users!tenant_users_user_id_fkey(name, status)")
    .eq("tenant_id", tenantId)
    .in("role", ["owner", "producer", "setter"])
    .not("accepted_at", "is", null);
  if (members.error) throw new Error(`Could not load the team: ${members.error.message}`);
  return (members.data ?? [])
    .flatMap((row) => {
      const user = (Array.isArray(row.users) ? row.users[0] : row.users) as { name?: string | null; status?: string | null } | null | undefined;
      // Same rule as the Agent Floor: only active accounts.
      if (!user || user.status !== "active") return [];
      return [{ userId: text(row.user_id), name: text(user.name).trim() || "Unnamed member", role: text(row.role) }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * "Preview the queue": scoring_queue_preview (20260925701100) for one agent. Read-only — it claims
 * nothing and records no scoring decision. Null when the migration is not applied yet.
 */
export async function scoringQueuePreview(tenantId: string, agentUserId: string): Promise<QueuePreview | null> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const result = await db.rpc("scoring_queue_preview", { p_tenant_id: tenantId, p_agent_user_id: agentUserId, p_limit: 25 });
  if (result.error) {
    if (isMissingSchema(result.error)) return null;
    throw new Error(`Could not preview the queue: ${result.error.message}`);
  }
  return normalizePreview(result.data);
}

export async function saveScoringSettings(input: {
  tenantId: string;
  userId: string;
  enabled: boolean;
  holdoutPct: number;
  weights: Array<{ signal: string; weight: number }>;
}): Promise<void> {
  const db = getSupabaseServiceClient() as unknown as Db;

  const settings = await db.from("tenant_scoring_settings").upsert(
    {
      tenant_id: input.tenantId,
      enabled: input.enabled,
      holdout_pct: input.holdoutPct,
      updated_at: new Date().toISOString(),
      updated_by: input.userId,
    },
    { onConflict: "tenant_id" },
  );
  if (settings.error) throw new Error(`Could not save scoring settings: ${settings.error.message}`);

  // Only signals the scorer knows about. An unknown signal would be stored, never read, and would
  // sit in the table looking like it did something.
  const known = new Set(SCORING_SIGNALS.map((signal) => signal.signal));
  const submitted = input.weights.filter((weight) => known.has(weight.signal));
  if (submitted.length === 0) return;

  // `tenant_scoring_weights` is an OVERRIDE table: a row in it is what makes the screen say
  // "somebody here chose this" rather than "this is the platform default". The form posts all seven
  // signals every time, so writing each one unconditionally marked all seven as overridden the
  // moment anyone changed one of them — and then nothing on the screen distinguished the single
  // deliberate choice from the six values that were simply left alone.
  //
  // So compare against the platform defaults and store only what actually differs. Setting a weight
  // back to its default removes the override rather than pinning the default value, which is what
  // keeps "revert this one" reachable at all.
  const defaults = await db.rpc("default_scoring_weights");
  if (defaults.error) throw new Error(`Could not read the default weights: ${defaults.error.message}`);
  const defaultBySignal = new Map<string, number>();
  for (const row of (defaults.data as Array<{ signal?: string; weight?: number }> | null) ?? []) {
    if (row?.signal) defaultBySignal.set(row.signal, Number(row.weight ?? 0));
  }

  const rows = submitted
    .filter((weight) => weight.weight !== defaultBySignal.get(weight.signal))
    .map((weight) => ({
      tenant_id: input.tenantId,
      signal: weight.signal,
      weight: weight.weight,
      updated_at: new Date().toISOString(),
    }));
  const backToDefault = submitted
    .filter((weight) => weight.weight === defaultBySignal.get(weight.signal))
    .map((weight) => weight.signal);

  if (rows.length > 0) {
    const saved = await db.from("tenant_scoring_weights").upsert(rows, { onConflict: "tenant_id,signal" });
    if (saved.error) throw new Error(`Could not save scoring weights: ${saved.error.message}`);
  }
  if (backToDefault.length > 0) {
    const cleared = await db
      .from("tenant_scoring_weights")
      .delete()
      .eq("tenant_id", input.tenantId)
      .in("signal", backToDefault);
    if (cleared.error) throw new Error(`Could not clear weight overrides: ${cleared.error.message}`);
  }
}
