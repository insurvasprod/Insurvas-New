import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { resolveSalesSettings } from "@/lib/salesSettings/schema";
import { isPolicyFeed } from "@/lib/ingestion/constants";
import { historyStart, persistency, type ScorePolicy } from "@/lib/ingestion/scorecards";
import { loadScorecards } from "@/lib/ingestion/scorecardsStore";

import { mapLimit, READ_CONCURRENCY } from "./batch";
import { PLATFORM_DEFAULT_WEIGHTS, SCORED_STATUSES, SIGNALS, settingsFromRow, type RetentionSettings, type Weights } from "./constants";
import { scorePolicy } from "./score";
import { deriveSignals, type SignalInput, type SignalRow } from "./signals";

/**
 * LA-5.1 + LA-5.2 (Notion sprint) · the chargeback radar, server side: gather the seven signals for
 * every in-force policy (5.1) and score them with the tenant's current weight set (5.2).
 *
 * Reads only what earlier modules built: policy_current (LA-4.7), the change log (LA-4.6, through
 * policy_payment_wobble), the carrier rules (LA-4.17), the book's persistency (LA-4.18), the LA-3
 * application's draft day and income schedule (LA-3.9), and contact_income (LA-5.10). Writes only
 * its own two derived tables. No model call anywhere.
 *
 * Runs after each policy file (a pipeline stage, for that carrier), and whenever a day has passed
 * since the last run (`ensureRadarFresh`), because months-since-issue and the draft/income relation
 * move with the calendar.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

const PAGE = 1000;
const CHUNK = 200;
const WRITE_CHUNK = 500;
/** How far back the change log is read for Sign 4. */
const WOBBLE_MONTHS = 13;
/** A carrier whose files are this many days apart (median) is on a monthly feed. */
const MONTHLY_CADENCE_DAYS = 25;

async function everyRow(build: () => Loose, max = 200_000): Promise<Loose[]> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
async function byIds(table: string, columns: string, column: string, ids: Array<string | null>, tenantId?: string): Promise<Loose[]> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const results = await mapLimit<string[], Loose>(chunks(unique, CHUNK), READ_CONCURRENCY, (part) => {
    let q = db().from(table).select(columns).in(column, part);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    return q;
  });
  for (const r of results) if (r.error) throw r.error;
  return results.flatMap((r: Loose) => r.data ?? []);
}
const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

export type RadarConfig = { settings: RetentionSettings; weights: Weights; weightSetId: string; weightSetVersion: number };

/** The tenant's settings and current weight set (its newest version, else the platform's). Null before the migration. */
export async function loadRadarConfig(tenantId: string): Promise<RadarConfig | null> {
  const [settings, sets] = await Promise.all([
    db().from("retention_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
    db().from("risk_weight_set").select("id, tenant_id, version, weights").or(`tenant_id.eq.${tenantId},tenant_id.is.null`).order("version", { ascending: false }).limit(50),
  ]);
  if (settings.error || sets.error) {
    if (isSchemaGap(settings.error) || isSchemaGap(sets.error)) return null;
    throw new Error(`Could not read the retention settings: ${(settings.error ?? sets.error).message}`);
  }
  const rows = (sets.data ?? []) as Loose[];
  const set = rows.find((r) => r.tenant_id === tenantId) ?? rows.find((r) => r.tenant_id === null);
  if (!set) return null;
  const weights = Object.fromEntries(SIGNALS.map((s) => [s, Number(set.weights?.[s] ?? PLATFORM_DEFAULT_WEIGHTS[s])])) as Weights;
  return { settings: settingsFromRow(settings.data), weights, weightSetId: set.id, weightSetVersion: set.version };
}

const POLICY_COLUMNS = "carrier_id, policy_number, status_normalized, payment_method, snapshot_id, issue_date, issued_on, effective_date, as_of, in_clawback_window, annualised_premium_cents, contact_id, household_id, application_id, vendor_id, campaign_id, retention_rule_id, first_seen_date, last_snapshot_date";

/** The median gap between a carrier's policy files, per carrier, from the last half year. */
async function cadenceByCarrier(tenantId: string, today: string): Promise<Map<string, number>> {
  const files = await everyRow(() => db().from("file_registry").select("carrier_id, file_type, file_date").eq("tenant_id", tenantId).gte("file_date", addMonths(today, -6)).order("file_date").order("id"), 20_000);
  const dates = new Map<string, Set<string>>();
  for (const f of files) {
    if (!f.carrier_id || !f.file_date || !isPolicyFeed(f.file_type)) continue;
    const set = dates.get(f.carrier_id) ?? new Set<string>();
    set.add(String(f.file_date).slice(0, 10));
    dates.set(f.carrier_id, set);
  }
  const out = new Map<string, number>();
  for (const [carrier, set] of dates) {
    const sorted = [...set].sort();
    const gaps = sorted.slice(1).map((d, i) => (Date.parse(d) - Date.parse(sorted[i])) / 86_400_000).sort((a, b) => a - b);
    if (gaps.length) out.set(carrier, gaps[Math.floor(gaps.length / 2)]);
  }
  return out;
}

/** Sign 6 and the carrier lapse rate in Sign 7: 9-month persistency of the agency's own book (LA-4.18), per lead source and carrier. */
async function bookPersistency(tenantId: string, today: string) {
  const data = await loadScorecards({ tenantId, userId: "radar", role: "owner" }, { from: addMonths(today, -1), to: today }).catch((error) => {
    console.error("[radar] persistency could not be read", error);
    return { available: false as const };
  });
  if (!data.available) return null;
  const start = historyStart(data.policies);
  const cell = (list: ScorePolicy[]) => {
    const c = persistency(list, 9, today, start);
    return c.building || c.eligible === 0 ? { bp: null, sample: c.eligible } : { bp: Math.round((c.alive * 10_000) / c.eligible), sample: c.eligible };
  };
  const group = (key: (p: ScorePolicy) => string) => {
    const m = new Map<string, ScorePolicy[]>();
    for (const p of data.policies) {
      const k = key(p);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return new Map([...m].map(([k, list]) => [k, cell(list)]));
  };
  return {
    sourceOf: new Map(data.policies.map((p) => [p.key, p.sourceKey])),
    bySource: group((p) => p.sourceKey),
    byCarrier: group((p) => p.carrierId),
    book: cell(data.policies),
  };
}

export type RadarRun = { scored: number; removed: number; available: true; preview?: { signals: Loose[]; scores: Loose[] } } | { available: false };

/**
 * Compute the signals and scores. Whole book by default; one carrier (after its file) or a few
 * policies on demand. Rows for policies that left scope (lapsed, paid up) are removed.
 */
export async function computeRadar(tenantId: string, scope: { carrierId?: string; policyNumbers?: string[] } = {}, options: { dryRun?: boolean } = {}): Promise<RadarRun> {
  const config = await loadRadarConfig(tenantId);
  if (!config) return { available: false };

  const policies = await everyRow(() => {
    let q = db().from("policy_current").select(POLICY_COLUMNS).eq("tenant_id", tenantId).in("status_normalized", [...SCORED_STATUSES]);
    if (scope.carrierId) q = q.eq("carrier_id", scope.carrierId);
    if (scope.policyNumbers?.length) q = q.in("policy_number", scope.policyNumbers);
    return q.order("carrier_id").order("policy_number");
  });
  const today = (policies.map((p) => p.as_of as string).filter(Boolean).sort().at(-1) as string | undefined) ?? new Date().toISOString().slice(0, 10);

  const ruleIds = policies.map((p) => p.retention_rule_id);
  const [apps, payments, contacts, incomes, rules, wobble, cadence, persistencyOf, salesPrefs, household, fileDraftDays, verifiedDays] = await Promise.all([
    byIds("tenant_applications", "id, draft_day", "id", policies.map((p) => p.application_id), tenantId),
    byIds("tenant_application_payment_methods", "application_id, draft_income_type, draft_income_inputs", "application_id", policies.map((p) => p.application_id), tenantId),
    byIds("contacts", "id, dob", "id", policies.map((p) => p.contact_id), tenantId),
    byIds("contact_income", "contact_id, monthly_income_cents, confidence, is_household_total", "contact_id", policies.map((p) => p.contact_id), tenantId).catch((error) => {
      if (isSchemaGap(error)) return [];
      throw error;
    }),
    byIds("carrier_retention_rule", "id, grace_days, redraft_attempts", "id", ruleIds),
    db().rpc("policy_payment_wobble", { p_tenant_id: tenantId, p_since: addMonths(today, -WOBBLE_MONTHS), p_tolerance: 5 }),
    cadenceByCarrier(tenantId, today),
    bookPersistency(tenantId, today),
    db().from("tenant_sales_settings").select("settings").eq("tenant_id", tenantId).maybeSingle(),
    // Household premium for a household-total income: every in-force policy in the household, not only this scope's.
    (async () => {
      const ids = [...new Set(policies.map((p) => p.household_id).filter(Boolean))] as string[];
      if (!ids.length) return [] as Loose[];
      return byIds("policy_current", "household_id, status_normalized, annualised_premium_cents", "household_id", ids, tenantId);
    })(),
    // The draft day the carrier's own file shows (a layout mapping DRAFTDAY, LA-5.4), on the policy's latest snapshot.
    byIds("policy_snapshot", "id, draft_day:extra->fields->>draft_day", "id", policies.map((p) => p.snapshot_id), tenantId),
    // A draft-date change the file has already proven (LA-5.4): newer than the application's day.
    everyRow(() => db().from("servicing_request").select("carrier_id, policy_number, field_changes_json, verified_at").eq("tenant_id", tenantId).eq("status", "verified_in_file").order("verified_at").order("id")).catch((error) => {
      if (isSchemaGap(error)) return [] as Loose[];
      throw error;
    }),
  ]);
  if (wobble.error) {
    if (isSchemaGap(wobble.error)) return { available: false };
    throw new Error(`Could not read the payment history: ${wobble.error.message}`);
  }

  const appOf = new Map<string, Loose>(apps.map((a: Loose) => [a.id, a]));
  const payOf = new Map<string, Loose>(payments.map((p: Loose) => [p.application_id, p]));
  const dobOf = new Map<string, string | null>(contacts.map((c: Loose) => [c.id, c.dob]));
  const incomeOf = new Map<string, Loose>(incomes.map((i: Loose) => [i.contact_id, i]));
  const ruleOf = new Map<string, Loose>(rules.map((r: Loose) => [r.id, r]));
  const wobbleOf = new Map<string, Loose>(((wobble.data ?? []) as Loose[]).map((w) => [`${w.carrier_id}|${w.policy_number}`, w]));
  const buffer = resolveSalesSettings(salesPrefs.data?.settings).draftBufferDays;
  const dayOf = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.0+)?$/.test(v.trim()) ? Number(v) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
  };
  const fileDay = new Map<string, number>();
  for (const s of fileDraftDays as Loose[]) { const d = dayOf(s.draft_day); if (d) fileDay.set(s.id, d); }
  const provenDay = new Map<string, number>();
  for (const v of verifiedDays as Loose[]) {
    const change = ((v.field_changes_json ?? []) as Loose[]).find((c) => c.field === "draft_day");
    const d = change ? dayOf(change.to) : null;
    if (d) provenDay.set(`${v.carrier_id}|${v.policy_number}`, d);
  }
  /** The draft day, most trustworthy first: the carrier's latest file, a change the file proved, the LA-3 application. */
  const draftDayFor = (p: Loose, app: Loose | null): number | null =>
    (p.snapshot_id ? fileDay.get(p.snapshot_id) : undefined) ?? provenDay.get(`${p.carrier_id}|${p.policy_number}`) ?? app?.draft_day ?? null;
  const householdPremium = new Map<string, number>();
  for (const h of household as Loose[]) {
    if (!SCORED_STATUSES.includes(h.status_normalized) || h.annualised_premium_cents === null) continue;
    householdPremium.set(h.household_id, (householdPremium.get(h.household_id) ?? 0) + Math.round(Number(h.annualised_premium_cents) / 12));
  }

  const signalRows: Loose[] = [];
  const scoreRows: Loose[] = [];
  const computedAt = new Date().toISOString();
  for (const p of policies) {
    const key = `${p.carrier_id}|${p.policy_number}`;
    const app = p.application_id ? appOf.get(p.application_id) : null;
    const pay = p.application_id ? payOf.get(p.application_id) : null;
    const income = p.contact_id ? incomeOf.get(p.contact_id) : null;
    const rule = p.retention_rule_id ? ruleOf.get(p.retention_rule_id) : null;
    const w = wobbleOf.get(key);
    const sourceKey = persistencyOf?.sourceOf.get(key) ?? null;
    const source = persistencyOf && sourceKey && sourceKey !== "none" ? persistencyOf.bySource.get(sourceKey) : null;
    const carrierStats = persistencyOf?.byCarrier.get(p.carrier_id);
    const input: SignalInput = {
      status: p.status_normalized,
      paymentMethod: p.payment_method,
      issueDate: p.issue_date ?? p.issued_on ?? p.effective_date ?? null,
      asOf: p.as_of ?? today,
      inClawbackWindow: p.in_clawback_window,
      monthlyPremiumCents: p.annualised_premium_cents === null ? null : Math.round(Number(p.annualised_premium_cents) / 12),
      draft: app || pay || draftDayFor(p, null) ? { draftDay: draftDayFor(p, app), incomeType: pay?.draft_income_type ?? null, incomeInputs: pay?.draft_income_inputs ?? null, dob: p.contact_id ? dobOf.get(p.contact_id) ?? null : null, buffer } : null,
      wobble: w ? { failures: w.failures, lastFailureDate: w.last_failure_date, recovered: w.recovered } : null,
      hasPaymentHistory: Boolean(p.first_seen_date && p.last_snapshot_date && p.last_snapshot_date > p.first_seen_date),
      monthlyCadence: (cadence.get(p.carrier_id) ?? 0) >= MONTHLY_CADENCE_DAYS,
      income: income ? { monthlyCents: Number(income.monthly_income_cents), confidence: income.confidence, householdTotal: income.is_household_total } : null,
      householdMonthlyPremiumCents: p.household_id ? householdPremium.get(p.household_id) ?? null : null,
      vendorId: p.vendor_id,
      campaignId: p.campaign_id,
      source: source ? { persistencyBp: source.bp, sample: source.sample, tenantBp: persistencyOf!.book.bp } : null,
      carrier: { graceDays: rule?.grace_days ?? null, redraftAttempts: rule?.redraft_attempts ?? null, lapseRateBp: carrierStats?.bp === null || carrierStats === undefined ? null : 10_000 - carrierStats.bp, sample: carrierStats?.sample ?? 0 },
    };
    const s = deriveSignals(input, config.settings);
    const score = scorePolicy(s, config.weights, config.settings);
    signalRows.push(signalColumns(tenantId, p, s, computedAt, input.asOf));
    scoreRows.push({
      tenant_id: tenantId, carrier_id: p.carrier_id, policy_number: p.policy_number, score: score.score, band: score.band,
      signals_available: score.signalsAvailable, available_weight: score.availableWeight, confidence: score.confidence,
      contributions_json: score.contributions, explanation: score.explanation, weight_set_id: config.weightSetId, weight_set_version: config.weightSetVersion,
      as_of: input.asOf, computed_at: computedAt,
    });
  }

  // A dry run (LA-5.11's weight preview, and checks) computes everything and writes nothing.
  if (options.dryRun) return { available: true, scored: scoreRows.length, removed: 0, preview: { signals: signalRows, scores: scoreRows } };

  for (const part of chunks(signalRows, WRITE_CHUNK)) {
    const { error } = await db().from("policy_risk_signals").upsert(part, { onConflict: "tenant_id,carrier_id,policy_number" });
    if (error) throw new Error(`Could not save the risk signals: ${error.message}`);
  }
  for (const part of chunks(scoreRows, WRITE_CHUNK)) {
    const { error } = await db().from("policy_risk_score").upsert(part, { onConflict: "tenant_id,carrier_id,policy_number" });
    if (error) throw new Error(`Could not save the risk scores: ${error.message}`);
  }

  // Policies that left scope (lapsed, paid up, gone) lose their rows: they are not scored.
  let removed = 0;
  if (!scope.policyNumbers) {
    const kept = new Set(policies.map((p) => `${p.carrier_id}|${p.policy_number}`));
    const existing = await everyRow(() => {
      let q = db().from("policy_risk_score").select("carrier_id, policy_number").eq("tenant_id", tenantId);
      if (scope.carrierId) q = q.eq("carrier_id", scope.carrierId);
      return q.order("carrier_id").order("policy_number");
    });
    const stale = existing.filter((r) => !kept.has(`${r.carrier_id}|${r.policy_number}`));
    const byCarrier = new Map<string, string[]>();
    for (const r of stale) byCarrier.set(r.carrier_id, [...(byCarrier.get(r.carrier_id) ?? []), r.policy_number]);
    for (const [carrierId, numbers] of byCarrier) {
      for (const part of chunks(numbers, CHUNK)) {
        for (const table of ["policy_risk_score", "policy_risk_signals"]) {
          const { error } = await db().from(table).delete().eq("tenant_id", tenantId).eq("carrier_id", carrierId).in("policy_number", part);
          if (error) throw new Error(`Could not remove out-of-scope rows: ${error.message}`);
        }
      }
    }
    removed = stale.length;
  } else {
    const kept = new Set(policies.map((p) => p.policy_number));
    const gone = scope.policyNumbers.filter((n) => !kept.has(n));
    if (gone.length && scope.carrierId) {
      for (const table of ["policy_risk_score", "policy_risk_signals"]) await db().from(table).delete().eq("tenant_id", tenantId).eq("carrier_id", scope.carrierId).in("policy_number", gone);
      removed = gone.length;
    }
  }
  return { scored: scoreRows.length, removed, available: true };
}

function signalColumns(tenantId: string, p: Loose, s: SignalRow, computedAt: string, asOf: string) {
  return {
    tenant_id: tenantId, carrier_id: p.carrier_id, policy_number: p.policy_number, computed_at: computedAt, as_of: asOf,
    draft_day: s.draftDay, expected_income_day: s.expectedIncomeDay, income_type: s.incomeType, days_draft_before_income: s.daysDraftBeforeIncome,
    recommended_draft_day: s.recommendedDraftDay, recommended_draft_reason: s.recommendedDraftReason,
    payment_method: s.paymentMethod, months_since_issue: s.monthsSinceIssue, inside_clawback_window: s.insideClawbackWindow,
    draft_failures_count: s.draftFailuresCount, last_failure_date: s.lastFailureDate, recovered_after_failure: s.recoveredAfterFailure, wobble_detection_limited: s.wobbleDetectionLimited,
    monthly_income_cents: s.monthlyIncomeCents, income_confidence: s.incomeConfidence, premium_pct_of_income_bp: s.premiumPctOfIncomeBp,
    vendor_id: s.vendorId, campaign_id: s.campaignId, source_persistency_9mo_bp: s.sourcePersistency9moBp, tenant_persistency_9mo_bp: s.tenantPersistency9moBp, source_sample_size: s.sourceSampleSize,
    carrier_grace_days: s.carrierGraceDays, carrier_redraft_attempts: s.carrierRedraftAttempts, carrier_lapse_rate_bp: s.carrierLapseRateBp, carrier_sample_size: s.carrierSampleSize,
    signals_available: s.signalsAvailable, signals_missing_json: s.missing,
  };
}

/**
 * The OLDEST computation, and the book's newest day: a run is due when the book moved past it. The
 * oldest, not the newest — rescoring one policy (an income saved, a fix verified) must not make a
 * stale book look fresh.
 */
export async function ensureRadarFresh(tenantId: string): Promise<RadarRun | null> {
  const [last, book] = await Promise.all([
    db().from("policy_risk_score").select("as_of, computed_at").eq("tenant_id", tenantId).order("computed_at", { ascending: true }).limit(1).maybeSingle(),
    db().from("policy_current").select("as_of").eq("tenant_id", tenantId).in("status_normalized", [...SCORED_STATUSES]).order("as_of", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (last.error) {
    if (isSchemaGap(last.error)) return { available: false };
    throw new Error(last.error.message);
  }
  if (!book.data) return null;
  const stale = !last.data || last.data.as_of < book.data.as_of || Date.now() - Date.parse(last.data.computed_at) > 24 * 3_600_000;
  return stale ? computeRadar(tenantId) : null;
}
