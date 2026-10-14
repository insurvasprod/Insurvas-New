import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { advanceAtRisk, loadBoard } from "@/lib/ingestion/retentionStore";

import { RADAR_PENDING_MESSAGE, type ActionTaken, type Band, type ContactOutcome, type HoldKind, type RetentionSettings } from "./constants";
import { recommendFixes, type Fix } from "./fixes";
import { buildQueue, daysUntilNextDraft, isEmergency, type QueueCandidate, type QueueSort } from "./queue";
import { ensureRadarFresh, loadRadarConfig } from "./radarStore";
import type { Contribution, RiskScore } from "./score";
import type { SignalRow } from "./signals";
import type { RequestStatus, RequestType } from "./servicing";
import { requestsByPolicy } from "./servicingStore";

/**
 * LA-5.3 (Notion sprint) · the save queue, server side: policies paying perfectly well right now that
 * the radar says will stop — each with the reason (LA-5.2's sentence), at most two fixes, the advance
 * at risk, the phone number and the days until the next draft. Working a card records the score, band,
 * weight version and exposure AT THAT MOMENT, which is what LA-5.9 measures later.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const PAGE = 1000;
const CHUNK = 200;

export class SaveQueueError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SaveQueueError";
  }
}

export type Viewer = { tenantId: string; userId: string; role: string };

async function everyRow(build: () => Loose, max = 100_000): Promise<Loose[]> {
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

/** Rows of a policy-keyed table for these policy numbers, kept to the keys asked for. */
async function byPolicy(table: string, columns: string, tenantId: string, keys: Set<string>, extra?: (q: Loose) => Loose): Promise<Loose[]> {
  const numbers = [...new Set([...keys].map((k) => k.slice(k.indexOf("|") + 1)))];
  const results = await Promise.all(chunks(numbers, CHUNK).map((part) => {
    let q = db().from(table).select(columns).eq("tenant_id", tenantId).in("policy_number", part);
    if (extra) q = extra(q);
    return q;
  }));
  for (const r of results) if (r.error) throw r.error;
  return results.flatMap((r: Loose) => r.data ?? []).filter((row: Loose) => keys.has(keyOf(row)));
}

function signalsFromRow(r: Loose): SignalRow {
  return {
    draftDay: r.draft_day, expectedIncomeDay: r.expected_income_day, incomeType: r.income_type, daysDraftBeforeIncome: r.days_draft_before_income,
    recommendedDraftDay: r.recommended_draft_day, recommendedDraftReason: r.recommended_draft_reason, paymentMethod: r.payment_method,
    monthsSinceIssue: r.months_since_issue, insideClawbackWindow: r.inside_clawback_window, draftFailuresCount: r.draft_failures_count,
    lastFailureDate: r.last_failure_date, recoveredAfterFailure: r.recovered_after_failure, wobbleDetectionLimited: r.wobble_detection_limited,
    monthlyIncomeCents: r.monthly_income_cents === null ? null : Number(r.monthly_income_cents), incomeConfidence: r.income_confidence,
    premiumPctOfIncomeBp: r.premium_pct_of_income_bp, vendorId: r.vendor_id, campaignId: r.campaign_id,
    sourcePersistency9moBp: r.source_persistency_9mo_bp, tenantPersistency9moBp: r.tenant_persistency_9mo_bp, sourceSampleSize: r.source_sample_size,
    carrierGraceDays: r.carrier_grace_days, carrierRedraftAttempts: r.carrier_redraft_attempts, carrierLapseRateBp: r.carrier_lapse_rate_bp, carrierSampleSize: r.carrier_sample_size,
    signalsAvailable: r.signals_available, missing: r.signals_missing_json ?? [],
  };
}

export type SaveCard = QueueCandidate & {
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  clientName: string | null;
  phone: string | null;
  agentName: string | null;
  signalsAvailable: number;
  missing: string[];
  explanation: string;
  contributions: Contribution[];
  fixes: Fix[];
  weightSetVersion: number;
  premiumCents: number | null;
  premiumMode: string | null;
  incomeKnown: boolean;
  /** LA-5.4: fixes asked of the carrier and still open on this policy. */
  openRequests: Array<{ type: RequestType; status: RequestStatus }>;
};

export type SaveQueue = {
  available: true;
  today: string;
  cards: SaveCard[];
  total: number;
  usedMedium: boolean;
  /** At the queue band but scored on under half the weight: kept off the queue, and counted. */
  lowConfidence: number;
  settings: RetentionSettings;
  weightSetVersion: number;
  stats: { scored: number; highOrAbove: number; critical: number; atRiskCents: number; atRiskUnknown: number; held: number; incomeKnown: number; affordabilityWeight: number };
  computedAt: string | null;
};

/** Everything the cards need, for every scored policy this viewer may see (a producer: their own). */
async function candidates(viewer: Viewer, only?: { carrierId: string; policyNumber: string }) {
  const config = await loadRadarConfig(viewer.tenantId);
  if (!config) return null;
  const scores = await everyRow(() => {
    let q = db().from("policy_risk_score").select("carrier_id, policy_number, score, band, confidence, signals_available, contributions_json, explanation, weight_set_version, computed_at, as_of").eq("tenant_id", viewer.tenantId);
    if (only) q = q.eq("carrier_id", only.carrierId).eq("policy_number", only.policyNumber);
    return q.order("band").order("score", { ascending: false });
  });
  const keys = new Set(scores.map(keyOf));
  if (!keys.size) return { config, rows: [] as SaveCard[], scored: 0, held: 0, computedAt: null as string | null, today: new Date().toISOString().slice(0, 10) };

  const [policies, signals, attempts, holds, board, requests, noBank] = await Promise.all([
    byPolicy("policy_current", "carrier_id, policy_number, contact_id, agent_user_id, status_normalized, days_past_due, months_paid, product_code, as_of, premium_cents, premium_mode", viewer.tenantId, keys),
    byPolicy("policy_risk_signals", "*", viewer.tenantId, keys),
    byPolicy("save_attempt", "carrier_id, policy_number, attempted_at, risk_score_at_attempt", viewer.tenantId, keys, (q) => q.order("attempted_at", { ascending: false })),
    byPolicy("save_queue_hold", "id, carrier_id, policy_number, kind, until_date, score_at_hold", viewer.tenantId, keys, (q) => q.is("released_at", null).order("created_at", { ascending: false })),
    loadBoard(viewer, only),
    requestsByPolicy(viewer.tenantId, keys),
    // LA-5.5: the paper-bill campaign found no bank account for these.
    byPolicy("conversion_attempt", "carrier_id, policy_number", viewer.tenantId, keys, (q) => q.eq("outcome", "unable_no_bank_account")).catch((error) => {
      if (isSchemaGap(error)) return [] as Loose[];
      throw error;
    }),
  ]);
  const policyOf = new Map<string, Loose>(policies.map((p: Loose) => [keyOf(p), p]));
  const visible = viewer.role === "producer" ? scores.filter((s) => policyOf.get(keyOf(s))?.agent_user_id === viewer.userId) : scores.filter((s) => policyOf.has(keyOf(s)));
  const visiblePolicies = visible.map((s) => policyOf.get(keyOf(s)));
  const [atRisk, contacts, users, carriers] = await Promise.all([
    advanceAtRisk(viewer.tenantId, visiblePolicies),
    Promise.all(chunks([...new Set(visiblePolicies.map((p: Loose) => p.contact_id).filter(Boolean))] as string[], CHUNK).map((ids) => db().from("contacts").select("id, first_name, last_name, primary_phone").eq("tenant_id", viewer.tenantId).in("id", ids))).then((r) => r.flatMap((x: Loose) => x.data ?? [])),
    Promise.all(chunks([...new Set(visiblePolicies.map((p: Loose) => p.agent_user_id).filter(Boolean))] as string[], CHUNK).map((ids) => db().from("users").select("id, name, email").in("id", ids))).then((r) => r.flatMap((x: Loose) => x.data ?? [])),
    db().from("carriers").select("id, name"),
  ]);
  const signalOf = new Map<string, Loose>(signals.map((s: Loose) => [keyOf(s), s]));
  const attemptOf = new Map<string, Loose>();
  for (const a of attempts) if (!attemptOf.has(keyOf(a))) attemptOf.set(keyOf(a), a);
  const holdOf = new Map<string, Loose>();
  for (const h of holds) if (!holdOf.has(keyOf(h))) holdOf.set(keyOf(h), h);
  const noBankKeys = new Set<string>(noBank.map((r: Loose) => keyOf(r)));
  const reasonOf = new Map<string, string>(board.rows.map((r) => [`${r.carrierId}|${r.policyNumber}`, r.reason]));
  const contactOf = new Map<string, Loose>(contacts.map((c: Loose) => [c.id, c]));
  const userName = new Map<string, string>(users.map((u: Loose) => [u.id, u.name || u.email]));
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const today = board.today;

  const rows: SaveCard[] = visible.map((sc) => {
    const key = keyOf(sc);
    const p = policyOf.get(key);
    const sig = signalsFromRow(signalOf.get(key) ?? { signals_missing_json: [] });
    const score: RiskScore = { score: sc.score, band: sc.band, signalsAvailable: sc.signals_available, availableWeight: 0, confidence: sc.confidence, contributions: sc.contributions_json ?? [], explanation: sc.explanation };
    const contact = p.contact_id ? contactOf.get(p.contact_id) : null;
    const a = attemptOf.get(key);
    const h = holdOf.get(key);
    return {
      key, score: sc.score, band: sc.band as Band, status: p.status_normalized, daysPastDue: p.days_past_due, boardReason: reasonOf.get(key) ?? null,
      lastAttempt: a ? { at: a.attempted_at, score: a.risk_score_at_attempt } : null,
      hold: h ? { kind: h.kind, until: h.until_date, score: h.score_at_hold } : null,
      atRiskCents: atRisk.get(key) ?? null, nextDraftDays: daysUntilNextDraft(sig.draftDay, today), monthsSinceIssue: sig.monthsSinceIssue,
      carrierId: sc.carrier_id, carrierName: carrierName.get(sc.carrier_id) ?? "Carrier not known", policyNumber: sc.policy_number,
      clientName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null : null, phone: contact?.primary_phone ?? null,
      agentName: p.agent_user_id ? userName.get(p.agent_user_id) ?? null : null,
      confidence: sc.confidence, signalsAvailable: sc.signals_available, missing: sig.missing, explanation: sc.explanation, contributions: score.contributions,
      fixes: recommendFixes(sig, score), weightSetVersion: sc.weight_set_version,
      premiumCents: p.premium_cents === null ? null : Number(p.premium_cents), premiumMode: p.premium_mode, incomeKnown: sig.monthlyIncomeCents !== null,
      openRequests: requests.get(key)?.open ?? [], failedFix: requests.get(key)?.failed?.reason ?? null, noBankAccount: noBankKeys.has(key),
    };
  });
  const computedAt = scores.map((s) => s.computed_at as string).sort().at(-1) ?? null;
  return { config, rows, scored: rows.length, held: rows.filter((r) => r.hold).length, computedAt, today };
}

export async function loadSaveQueue(viewer: Viewer, sort: QueueSort = "value"): Promise<SaveQueue | { available: false }> {
  try {
    await ensureRadarFresh(viewer.tenantId);
  } catch (error) {
    // A failed refresh leaves yesterday's scores on screen, dated; it never hides the queue.
    console.error("[save-queue] the radar could not be refreshed", error);
  }
  let loaded: Awaited<ReturnType<typeof candidates>>;
  try {
    loaded = await candidates(viewer);
  } catch (error) {
    if (isSchemaGap(error as Loose)) return { available: false };
    throw error;
  }
  if (!loaded) return { available: false };
  const { config, rows, today } = loaded;
  const queue = buildQueue(rows, config.settings, today, sort);
  const highOrAbove = rows.filter((r) => r.band === "high" || r.band === "critical");
  return {
    available: true,
    today,
    cards: queue.cards,
    total: queue.total,
    usedMedium: queue.usedMedium,
    lowConfidence: queue.lowConfidence,
    settings: config.settings,
    weightSetVersion: config.weightSetVersion,
    stats: {
      scored: loaded.scored,
      highOrAbove: highOrAbove.length,
      critical: rows.filter((r) => r.band === "critical").length,
      atRiskCents: queue.cards.reduce((sum, c) => sum + (c.atRiskCents ?? 0), 0),
      atRiskUnknown: queue.cards.filter((c) => c.atRiskCents === null).length,
      held: loaded.held,
      incomeKnown: rows.filter((r) => r.incomeKnown).length,
      affordabilityWeight: config.weights.affordability,
    },
    computedAt: loaded.computedAt,
  };
}

/** The one card, recomputed here — the browser's copy is never trusted. */
async function cardFor(viewer: Viewer, carrierId: string, policyNumber: string): Promise<SaveCard> {
  const loaded = await candidates(viewer, { carrierId, policyNumber }).catch((error) => {
    if (isSchemaGap(error)) throw new SaveQueueError(RADAR_PENDING_MESSAGE, 503);
    throw error;
  });
  if (!loaded) throw new SaveQueueError(RADAR_PENDING_MESSAGE, 503);
  const card = loaded.rows[0];
  if (!card) throw new SaveQueueError("That policy isn't scored for you now.", 404);
  if (isEmergency(card)) throw new SaveQueueError("This policy is past due or on the Lapse risk call list now: work it there.", 409);
  return card;
}

/** Log a worked card, capturing the score, band, weight version and exposure at this moment (LA-5.9 needs them). */
export async function logSaveAttempt(viewer: Viewer, input: { carrierId: string; policyNumber: string; outcome: ContactOutcome; actionTaken: ActionTaken; note: string | null }) {
  const card = await cardFor(viewer, input.carrierId, input.policyNumber);
  const { data: saved, error } = await db().from("save_attempt").insert({
    tenant_id: viewer.tenantId, carrier_id: input.carrierId, policy_number: input.policyNumber,
    risk_score_at_attempt: card.score, band_at_attempt: card.band, weight_set_version: card.weightSetVersion,
    unearned_advance_at_attempt_cents: card.atRiskCents,
    recommended_actions_json: card.fixes.map((f) => ({ action: f.action, label: f.label, target_draft_day: f.targetDraftDay ?? null })),
    action_taken: input.actionTaken, contact_outcome: input.outcome, attempted_by: viewer.userId, note: input.note?.trim() || null,
  }).select("id").single();
  if (error) {
    if (isSchemaGap(error)) throw new SaveQueueError(RADAR_PENDING_MESSAGE, 503);
    throw new Error(`Could not log the call: ${error.message}`);
  }
  return { id: saved.id as string, score: card.score, band: card.band };
}

/** Snooze (until a day) or dismiss (until released), with a reason. A newer hold replaces an open one. */
export async function holdCard(viewer: Viewer, input: { carrierId: string; policyNumber: string; kind: HoldKind; reason: string; days: number | null }) {
  const card = await cardFor(viewer, input.carrierId, input.policyNumber);
  const untilDate = input.kind === "snooze" ? new Date(Date.now() + (input.days ?? 7) * 86_400_000).toISOString().slice(0, 10) : null;
  const now = new Date().toISOString();
  const release = await db().from("save_queue_hold").update({ released_at: now }).eq("tenant_id", viewer.tenantId).eq("carrier_id", input.carrierId).eq("policy_number", input.policyNumber).is("released_at", null);
  if (release.error && !isSchemaGap(release.error)) throw new Error(`Could not update the hold: ${release.error.message}`);
  const { error } = await db().from("save_queue_hold").insert({
    tenant_id: viewer.tenantId, carrier_id: input.carrierId, policy_number: input.policyNumber, kind: input.kind, reason: input.reason.trim(),
    until_date: untilDate, score_at_hold: card.score, created_by: viewer.userId,
  });
  if (error) {
    if (isSchemaGap(error)) throw new SaveQueueError(RADAR_PENDING_MESSAGE, 503);
    throw new Error(`Could not hold the card: ${error.message}`);
  }
  return { until: untilDate };
}
