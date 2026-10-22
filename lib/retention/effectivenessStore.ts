import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { advanceAtRisk } from "@/lib/ingestion/retentionStore";

import { mapLimit, READ_CONCURRENCY } from "./batch";
import type { RetentionSettings } from "./constants";
import { bandAccuracy, draw, exitReason, holdoutComparison, holdoutSentence, outcomeOf, PERIOD_LABELS, PERIODS, protectedAdvance, type DrawRow, type Outcome, type Period, type PredictionRow } from "./effectiveness";
import { bandAtLeast } from "./queue";

/**
 * LA-5.9 (Notion sprint) · measuring the radar, server side.
 *
 * `afterRadarRun` is called by every radar computation (after each policy file, and daily), so:
 *   · a held-out policy that has gone past due leaves the holdout in the same run that sees it —
 *     within one pipeline run, as the spec requires — and is then on the LA-4.16 board like any other;
 *   · policies crossing the save-queue threshold while the holdout is on are drawn once per horizon;
 *   · each scored policy's prediction is recorded once per horizon, and resolved when it passes.
 * Nothing here is ever deleted (20261016210000 refuses it). Before that migration, all of it is a no-op.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const PAGE = 1000;
const CHUNK = 200;
const WRITE_CHUNK = 500;
const WRITE_CONCURRENCY = 4;

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
const keyOf = (r: { carrier_id: string; policy_number: string }) => `${r.carrier_id}|${r.policy_number}`;
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function byPolicy(table: string, columns: string, tenantId: string, keys: Set<string>, extra?: (q: Loose) => Loose): Promise<Loose[]> {
  const numbers = [...new Set([...keys].map((k) => k.slice(k.indexOf("|") + 1)))];
  const results = await mapLimit<string[], Loose>(chunks(numbers, CHUNK), READ_CONCURRENCY, (part) => {
    let q = db().from(table).select(columns).eq("tenant_id", tenantId).in("policy_number", part);
    if (extra) q = extra(q);
    return q;
  });
  for (const r of results) if (r.error) throw r.error;
  return results.flatMap((r: Loose) => r.data ?? []).filter((row: Loose) => keys.has(keyOf(row)));
}

/** Policies held back right now. Empty before the migration. */
export async function openHoldoutKeys(tenantId: string): Promise<Set<string>> {
  try {
    const rows = await everyRow(() => db().from("retention_holdout").select("carrier_id, policy_number").eq("tenant_id", tenantId).eq("selected", true).is("left_at", null).order("id"));
    return new Set(rows.map(keyOf));
  } catch (error) {
    if (isSchemaGap(error as Loose)) return new Set();
    throw error;
  }
}

/** A cryptographic roll in [0, 1): nobody, including us, can steer which policy is held out. */
function roll(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

type ScoreRow = { carrier_id: string; policy_number: string; score: number; band: string; confidence: string; signals_available: number; weight_set_version: number };
type PolicyRow = { carrier_id: string; policy_number: string; status_normalized: string | null; days_past_due?: number | null; months_paid?: number | null; product_code?: string | null; as_of: string };

/** Everything LA-5.9 does after the radar has written its scores. Never throws into the radar. */
export async function afterRadarRun(tenantId: string, settings: RetentionSettings, today: string, scores: ScoreRow[], policies: PolicyRow[], fullBook: boolean): Promise<void> {
  try {
    await holdoutExits(tenantId, settings);
    if (settings.holdoutEnabled) await holdoutDraws(tenantId, settings, today, scores, policies);
    if (fullBook) {
      await recordPredictions(tenantId, settings, today, scores);
      await resolveDue(tenantId, today);
    }
  } catch (error) {
    if (isSchemaGap(error as Loose)) return;
    console.error("[radar] LA-5.9 measurement step failed", error);
  }
}

/** Past due, gone from the book, or the holdout switched off: out of the holdout now. */
async function holdoutExits(tenantId: string, settings: RetentionSettings) {
  const open = await everyRow(() => db().from("retention_holdout").select("id, carrier_id, policy_number").eq("tenant_id", tenantId).eq("selected", true).is("left_at", null).order("id"));
  if (!open.length) return;
  const keys = new Set(open.map(keyOf));
  const current = await byPolicy("policy_current", "carrier_id, policy_number, status_normalized, days_past_due", tenantId, keys);
  const policyOf = new Map<string, Loose>(current.map((p: Loose) => [keyOf(p), p]));
  const now = new Date().toISOString();
  const leaving = new Map<string, string[]>();
  for (const row of open) {
    const p = policyOf.get(keyOf(row));
    const reason = exitReason(p ? { status: p.status_normalized, daysPastDue: p.days_past_due } : undefined, settings.holdoutEnabled);
    if (reason) leaving.set(reason, [...(leaving.get(reason) ?? []), row.id]);
  }
  for (const [reason, ids] of leaving) {
    for (const part of chunks(ids, WRITE_CHUNK)) {
      const { error } = await db().from("retention_holdout").update({ left_at: now, left_reason: reason }).in("id", part).is("left_at", null);
      if (error) throw error;
    }
  }
}

/** One draw per policy per horizon, for policies at the save-queue threshold that are paying now. */
async function holdoutDraws(tenantId: string, settings: RetentionSettings, today: string, scores: ScoreRow[], policies: PolicyRow[]) {
  const policyOf = new Map(policies.map((p) => [keyOf(p), p]));
  const crossing = scores.filter((s) => {
    const p = policyOf.get(keyOf(s));
    return p && bandAtLeast(s.band as never, settings.queueMinBand) && s.confidence !== "low"
      && (p.status_normalized === "active" || p.status_normalized === "approved_unpaid") && !((p.days_past_due ?? 0) > 0);
  });
  if (!crossing.length) return;
  const keys = new Set(crossing.map(keyOf));
  const since = addDays(today, -settings.predictionHorizonDays);
  const [recent, cases] = await Promise.all([
    byPolicy("retention_holdout", "carrier_id, policy_number", tenantId, keys, (q) => q.gt("drawn_on", since)),
    byPolicy("reinstatement_case", "carrier_id, policy_number", tenantId, keys, (q) => q.in("status", ["identified", "contacted", "client_agreed", "submitted"])).catch(() => [] as Loose[]),
  ]);
  const drawn = new Set(recent.map(keyOf));
  const reinstating = new Set(cases.map(keyOf));
  const due = crossing.filter((s) => !drawn.has(keyOf(s)));
  if (!due.length) return;
  const exposure = await advanceAtRisk(tenantId, due.map((s) => {
    const p = policyOf.get(keyOf(s))!;
    return { carrier_id: p.carrier_id, policy_number: p.policy_number, months_paid: p.months_paid ?? null, product_code: p.product_code ?? null, as_of: p.as_of };
  }));
  const rows = due.map((s) => {
    const cents = exposure.get(keyOf(s)) ?? null;
    const d = draw({ exposureCents: cents, maxExposureCents: settings.holdoutMaxExposureCents, shareBp: settings.holdoutShareBp, roll: roll(), openReinstatement: reinstating.has(keyOf(s)) });
    return {
      tenant_id: tenantId, carrier_id: s.carrier_id, policy_number: s.policy_number, drawn_on: today, band_at_draw: s.band, score_at_draw: s.score,
      confidence_at_draw: s.confidence, weight_set_version: s.weight_set_version, exposure_cents: cents, share_bp: Math.min(settings.holdoutShareBp, 2000),
      max_exposure_cents: settings.holdoutMaxExposureCents, selected: d.selected, ineligible_reason: d.ineligible, horizon_days: settings.predictionHorizonDays,
    };
  });
  for (const part of chunks(rows, WRITE_CHUNK)) {
    const { error } = await db().from("retention_holdout").insert(part);
    // A draw already made today (two runs at once) stands.
    if (error && error.code !== "23505") throw error;
  }
}

/** Each scored policy's prediction, once per horizon. */
async function recordPredictions(tenantId: string, settings: RetentionSettings, today: string, scores: ScoreRow[]) {
  if (!scores.length) return;
  const since = addDays(today, -settings.predictionHorizonDays);
  const recent = await everyRow(() => db().from("prediction_outcome").select("carrier_id, policy_number").eq("tenant_id", tenantId).gt("scored_on", since).order("id"));
  const have = new Set(recent.map(keyOf));
  const rows = scores.filter((s) => !have.has(keyOf(s))).map((s) => ({
    tenant_id: tenantId, carrier_id: s.carrier_id, policy_number: s.policy_number, scored_on: today, score: s.score, band: s.band, confidence: s.confidence,
    weight_set_version: s.weight_set_version, signals_available: s.signals_available, horizon_days: settings.predictionHorizonDays,
  }));
  for (const part of chunks(rows, WRITE_CHUNK)) {
    const { error } = await db().from("prediction_outcome").insert(part);
    if (error && error.code !== "23505") throw error;
  }
}

/** Predictions and draws whose horizon has passed: what happened, whether anyone worked it, whether it was held out. */
async function resolveDue(tenantId: string, today: string) {
  const [predictions, draws] = await Promise.all([
    everyRow(() => db().from("prediction_outcome").select("id, carrier_id, policy_number, scored_on, horizon_days").eq("tenant_id", tenantId).is("resolved_at", null).lte("scored_on", addDays(today, -30)).order("id")),
    everyRow(() => db().from("retention_holdout").select("id, carrier_id, policy_number, drawn_on, horizon_days, selected").eq("tenant_id", tenantId).is("resolved_at", null).lte("drawn_on", addDays(today, -30)).order("id")),
  ]);
  const due = <T extends { horizon_days: number }>(rows: T[], start: (r: T) => string) => rows.filter((r) => addDays(start(r), r.horizon_days) <= today);
  const duePredictions = due(predictions as Loose[], (r: Loose) => r.scored_on);
  const dueDraws = due(draws as Loose[], (r: Loose) => r.drawn_on);
  if (!duePredictions.length && !dueDraws.length) return;
  const keys = new Set([...duePredictions, ...dueDraws].map(keyOf));
  const [current, reinstated, saves, conversions, requests, held] = await Promise.all([
    byPolicy("policy_current", "carrier_id, policy_number, status_normalized, lapsed_on", tenantId, keys),
    byPolicy("reinstatement_case", "carrier_id, policy_number, resolved_at", tenantId, keys, (q) => q.eq("status", "reinstated")).catch(() => [] as Loose[]),
    byPolicy("save_attempt", "carrier_id, policy_number, attempted_at", tenantId, keys),
    byPolicy("conversion_attempt", "carrier_id, policy_number, attempted_at", tenantId, keys).catch(() => [] as Loose[]),
    byPolicy("servicing_request", "carrier_id, policy_number, created_at", tenantId, keys).catch(() => [] as Loose[]),
    byPolicy("retention_holdout", "carrier_id, policy_number, drawn_on, left_at", tenantId, keys, (q) => q.eq("selected", true)),
  ]);
  const group = (rows: Loose[], at: string) => {
    const m = new Map<string, string[]>();
    for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), String(r[at]).slice(0, 10)]);
    return m;
  };
  const policyOf = new Map<string, Loose>(current.map((p: Loose) => [keyOf(p), p]));
  const reinstatedOn = group(reinstated, "resolved_at");
  const worked = group([...saves.map((r: Loose) => ({ ...r, at: r.attempted_at })), ...conversions.map((r: Loose) => ({ ...r, at: r.attempted_at })), ...requests.map((r: Loose) => ({ ...r, at: r.created_at }))], "at");
  const heldOf = new Map<string, Loose[]>();
  for (const h of held) heldOf.set(keyOf(h), [...(heldOf.get(keyOf(h)) ?? []), h]);
  const within = (dates: string[] | undefined, from: string, to: string) => (dates ?? []).some((d) => d >= from && d <= to);

  const resolve = (r: Loose, start: string): { outcome: Outcome; wasWorked: boolean; inHoldout: boolean } | null => {
    const end = addDays(start, r.horizon_days);
    const p = policyOf.get(keyOf(r));
    const outcome = outcomeOf(p ? { status: p.status_normalized, lapsedOn: p.lapsed_on } : undefined, within(reinstatedOn.get(keyOf(r)), start, end), start, end);
    if (!outcome) return null;
    const inHoldout = (heldOf.get(keyOf(r)) ?? []).some((h) => h.drawn_on <= end && (!h.left_at || String(h.left_at).slice(0, 10) >= start));
    return { outcome, wasWorked: within(worked.get(keyOf(r)), start, end), inHoldout };
  };
  const now = new Date().toISOString();
  await mapLimit(duePredictions, WRITE_CONCURRENCY, async (r: Loose) => {
    const v = resolve(r, r.scored_on);
    if (!v) return null;
    const { error } = await db().from("prediction_outcome").update({ outcome_at_horizon: v.outcome, was_worked: v.wasWorked, in_holdout: v.inHoldout, resolved_at: now }).eq("id", r.id).is("resolved_at", null);
    if (error) throw error;
    return null;
  });
  await mapLimit(dueDraws, WRITE_CONCURRENCY, async (r: Loose) => {
    const v = resolve(r, r.drawn_on);
    if (!v) return null;
    const { error } = await db().from("retention_holdout").update({ outcome_at_horizon: v.outcome, was_worked: v.wasWorked, resolved_at: now }).eq("id", r.id).is("resolved_at", null);
    if (error) throw error;
    return null;
  });
}

export { PERIODS, PERIOD_LABELS, type Period } from "./effectiveness";

/**
 * The page's three reads, which need none of the settings: the page starts them beside the radar config
 * and hands the promise to loadEffectiveness (which awaits it, and throws from it, as it always did).
 */
export function readEffectiveness(tenantId: string): Promise<[Loose[], Loose[], Loose]> {
  return Promise.all([
    everyRow(() => db().from("prediction_outcome").select("band, confidence, weight_set_version, outcome_at_horizon, was_worked, in_holdout, scored_on, horizon_days").eq("tenant_id", tenantId).not("resolved_at", "is", null).order("id")),
    everyRow(() => db().from("retention_holdout").select("band_at_draw, selected, outcome_at_horizon, was_worked, exposure_cents, drawn_on, horizon_days, ineligible_reason, left_at, left_reason, resolved_at").eq("tenant_id", tenantId).order("id")),
    db().from("prediction_outcome").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("resolved_at", null),
  ]);
}

/** The page: Part 1 (all resolved predictions) and Part 2 (draws whose horizon ended in the period). */
export async function loadEffectiveness(tenantId: string, period: Period, settings: RetentionSettings, reads: Promise<[Loose[], Loose[], Loose]> = readEffectiveness(tenantId)) {
  let predictions: Loose[];
  let draws: Loose[];
  let awaiting: Loose;
  try {
    [predictions, draws, awaiting] = await reads;
  } catch (error) {
    if (isSchemaGap(error as Loose)) return null;
    throw error;
  }
  const today = new Date().toISOString().slice(0, 10);
  const days = PERIODS[period];
  const from = days === null ? "0000-00-00" : addDays(today, -days);
  const endOf = (r: Loose, start: string) => addDays(start, r.horizon_days);
  const predictionRows: PredictionRow[] = predictions.filter((r) => endOf(r, r.scored_on) >= from).map((r) => ({
    band: r.band, confidence: r.confidence, weightSetVersion: r.weight_set_version, outcome: r.outcome_at_horizon, wasWorked: r.was_worked, inHoldout: r.in_holdout,
  }));
  const resolvedDraws = draws.filter((r) => r.resolved_at && endOf(r, r.drawn_on) >= from);
  const drawRows: DrawRow[] = resolvedDraws.map((r) => ({ band: r.band_at_draw, selected: r.selected, outcome: r.outcome_at_horizon, wasWorked: r.was_worked, exposureCents: r.exposure_cents === null ? null : Number(r.exposure_cents) }));
  const oldest = predictions.map((r) => r.scored_on as string).sort()[0] ?? null;
  return {
    period,
    horizonDays: settings.predictionHorizonDays,
    accuracy: bandAccuracy(predictionRows),
    holdout: {
      enabled: settings.holdoutEnabled,
      shareBp: settings.holdoutShareBp,
      comparison: holdoutComparison(drawRows),
      protectedCents: protectedAdvance(drawRows),
      sentence: holdoutSentence(drawRows, PERIOD_LABELS[period]),
      drawn: draws.length,
      heldNow: draws.filter((r) => r.selected && !r.left_at).length,
      leftPastDue: draws.filter((r) => r.left_reason === "past_due").length,
      neverEligible: draws.filter((r) => r.ineligible_reason !== null).length,
      awaiting: draws.filter((r) => !r.resolved_at).length,
    },
    oldestPrediction: oldest,
    awaitingPredictions: (awaiting?.count ?? 0) as number,
  };
}

export type Effectiveness = NonNullable<Awaited<ReturnType<typeof loadEffectiveness>>>;
