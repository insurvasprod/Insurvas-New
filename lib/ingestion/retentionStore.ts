import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { scopeQuery, type ProducerScope } from "@/lib/agency/visibility";

import { flaggedFiles } from "./carrierAccountsStore";
import { unearnedAdvance } from "./commissionLedger";
import { advanceRuleResolver } from "./commissionLedgerStore";
import { boardOrder, daysLeftFor, groupOf, reasonFor, saveRates, type Group, type Outcome, type Reason } from "./retentionBoard";

/**
 * LA-4.16 (Notion sprint) · the retention board, server side: the call list built from policy_current
 * (LA-4.7), the carrier rules (LA-4.17), the client's phone, and the advance at risk from the ledger
 * (LA-4.12); the calls logged, and what the next file said about each.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const RETENTION_PENDING_MESSAGE = "The retention board needs a database update (20261008260000) to log calls.";

export class RetentionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RetentionError";
  }
}

/**
 * AG-0.5 · `scope` is the session's producer scope (scopeFor). With one, the board reads only policies credited
 * to a visible producer (policy_current.agent_user_id) and the save rates count only calls a visible producer
 * made. Absent or null (individual plan, owner, bookkeeper, the retention role) = exactly as before.
 */
export type Viewer = { tenantId: string; userId: string; role: string; scope?: ProducerScope };

async function everyRow(build: () => Loose, max = 50_000): Promise<Loose[]> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
const settle = <T,>(promise: Promise<T>) => promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

export type BoardEntry = {
  key: string; carrierId: string; carrierName: string; policyNumber: string; clientName: string | null; phone: string | null;
  reason: Reason; daysLeft: number | null; daysPastDue: number | null; group: Group; amountDueCents: number | null; premiumMode: string | null;
  atRiskCents: number | null; paidTo: string | null; status: string | null; snapshotDate: string | null; agentName: string | null;
  lastAction: { outcome: Outcome; at: string; by: string | null; result: string | null } | null;
};

const POLICY_COLUMNS = "carrier_id, policy_number, contact_id, agent_user_id, status_normalized, status_reported, carrier_status_raw, paid_to_date, effective_date, days_past_due, days_until_carrier_closes, retention_rule_id, lapsed_on, payment_method, premium_cents, premium_mode, months_paid, last_snapshot_date, first_seen_date, as_of, product_code";

/** The board for this viewer (a producer sees the policies credited to them), in the default order. */
export async function loadBoard(viewer: Viewer, only?: { carrierId: string; policyNumber: string }) {
  const utcToday = new Date().toISOString().slice(0, 10);
  // One round trip for everything but the names: the change log and the carriers never needed the
  // policies, and the agency's and the platform's carrier rules (a few rows) are read whole, then cut to
  // what the two rule reads below used to ask for. A failed rule read, or a policy whose rule is not among
  // them, falls back to those two reads exactly as they were.
  const [policies, ruleBook, changesRead, carriers] = await Promise.all([
    everyRow(() => {
      let q = db().from("policy_current").select(POLICY_COLUMNS).eq("tenant_id", viewer.tenantId).not("status_normalized", "in", "(submitted,declined,withdrawn)");
      if (viewer.role === "producer") q = q.eq("agent_user_id", viewer.userId);
      if (only) q = q.eq("carrier_id", only.carrierId).eq("policy_number", only.policyNumber);
      return scopeQuery(q, "agent_user_id", viewer.scope ?? null).order("carrier_id").order("policy_number");
    }),
    everyRow(() => db().from("carrier_retention_rule").select("id, tenant_id, carrier_id, rule_type, window_days, grace_days, cleared, effective_from, created_at").or(`tenant_id.eq.${viewer.tenantId},tenant_id.is.null`).order("effective_from", { ascending: true }).order("created_at", { ascending: true }).order("id"), 5_000).catch(() => null),
    settle(everyRow(() => db().from("policy_change").select("carrier_id, policy_number, field_name, old_value, new_value, to_snapshot_date").eq("tenant_id", viewer.tenantId).in("field_name", ["paid_to_date", "carrier_status_raw"]).gte("to_snapshot_date", new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)).order("to_snapshot_date").order("detected_at").order("id"))),
    db().from("carriers").select("id, name"),
  ]);
  // "Today" is the agency's day the book was computed for (policy_current.as_of, its own time zone),
  // not UTC, which runs a day ahead in US evenings.
  const today = (policies.map((p) => p.as_of as string | null).filter(Boolean).sort().at(-1) as string | undefined) ?? utcToday;
  const ruleIds = [...new Set(policies.map((p) => p.retention_rule_id).filter(Boolean))] as string[];
  const wanted = new Set(ruleIds);
  const ownRules = ruleBook && ruleIds.every((id) => ruleBook.some((r) => r.id === id)) ? ruleBook.filter((r) => wanted.has(r.id)) : null;
  const WINDOW_TYPES = ["reinstatement", "conservation", "cancellation_request"];
  const [rules, reinstatement] = await Promise.all([
    ownRules ? { data: ownRules } : ruleIds.length ? db().from("carrier_retention_rule").select("id, rule_type, window_days, grace_days").in("id", ruleIds) : { data: [] },
    ruleBook
      ? { data: ruleBook.filter((r) => WINDOW_TYPES.includes(r.rule_type) && r.effective_from !== null && String(r.effective_from) <= today) }
      : db().from("carrier_retention_rule").select("tenant_id, carrier_id, rule_type, window_days, cleared, effective_from, created_at").in("rule_type", WINDOW_TYPES).or(`tenant_id.eq.${viewer.tenantId},tenant_id.is.null`).lte("effective_from", today).order("effective_from", { ascending: true }).order("created_at", { ascending: true }),
  ]);
  // The change log's failure surfaces here, where it used to (after the policies).
  if (!changesRead.ok) throw changesRead.error;
  const changes = changesRead.value;
  const grace = new Map<string, number | null>((rules.data ?? []).map((r: Loose) => [r.id, r.grace_days]));
  // The policy's own rule, when it is a first-payment one: its window counts a missed first draft down.
  const firstWindow = new Map<string, number | null>((rules.data ?? []).filter((r: Loose) => r.rule_type === "first_payment").map((r: Loose) => [r.id, r.window_days]));
  // Each window: the agency's own (unless cleared, then back to the platform's), else the platform's;
  // the latest in force. Reinstatement, conservation and cancellation-request alike.
  const windowFor = (ruleType: string) => {
    const platform = new Map<string, number | null>();
    const own = new Map<string, number | null>();
    for (const r of (reinstatement.data ?? []) as Loose[]) {
      if (r.rule_type !== ruleType) continue;
      if (r.tenant_id === null) platform.set(r.carrier_id, r.window_days);
      else if (r.cleared) own.delete(r.carrier_id);
      else own.set(r.carrier_id, r.window_days);
    }
    return new Map([...platform, ...own]);
  };
  const reinstate = windowFor("reinstatement");
  const conservationWindow = windowFor("conservation");
  const cancellationWindow = windowFor("cancellation_request");
  const lastChange = new Map<string, Loose>();
  const wordSince = new Map<string, string>();
  for (const c of changes) {
    if (c.field_name === "carrier_status_raw") wordSince.set(`${c.carrier_id}|${c.policy_number}`, c.to_snapshot_date);
    else lastChange.set(`${c.carrier_id}|${c.policy_number}`, c);
  }

  type Candidate = { p: Loose; reason: Reason; daysLeft: number | null };
  const candidates: Candidate[] = [];
  for (const p of policies) {
    const key = `${p.carrier_id}|${p.policy_number}`;
    const change = lastChange.get(key);
    const input = {
      carrierId: p.carrier_id, policyNumber: p.policy_number, status: p.status_normalized, statusReported: p.status_reported, statusRaw: p.carrier_status_raw, paidTo: p.paid_to_date,
      effectiveDate: p.effective_date, daysPastDue: p.days_past_due, daysUntilClose: p.days_until_carrier_closes, graceDays: p.retention_rule_id ? grace.get(p.retention_rule_id) ?? null : null,
      lapsedOn: p.lapsed_on, paymentMethod: p.payment_method, lastPaidToChange: change ? { from: change.old_value, to: change.new_value, on: change.to_snapshot_date } : null,
      reinstatementDays: reinstate.get(p.carrier_id) ?? null, lastSnapshotDate: p.last_snapshot_date,
      noticeSince: wordSince.get(key) ?? p.first_seen_date ?? null,
      noticeWindowDays: null as number | null,
      firstPaymentWindowDays: p.retention_rule_id ? firstWindow.get(p.retention_rule_id) ?? null : null,
    };
    const first = reasonFor(input, today);
    if (first === "conservation") input.noticeWindowDays = conservationWindow.get(p.carrier_id) ?? null;
    if (first === "cancellation_request") input.noticeWindowDays = cancellationWindow.get(p.carrier_id) ?? null;
    const reason = reasonFor(input, today);
    if (reason) candidates.push({ p, reason, daysLeft: daysLeftFor(input, reason, today) });
  }

  const contactIds = [...new Set(candidates.map((c) => c.p.contact_id).filter(Boolean))] as string[];
  const userIds = [...new Set(candidates.map((c) => c.p.agent_user_id).filter(Boolean))] as string[];
  const numbers = [...new Set(candidates.map((c) => c.p.policy_number))] as string[];
  const [contacts, users, atRiskOf, actions] = await Promise.all([
    Promise.all(chunks(contactIds, 200).map((ids) => db().from("contacts").select("id, first_name, last_name, primary_phone").eq("tenant_id", viewer.tenantId).in("id", ids))).then((r) => r.flatMap((x: Loose) => x.data ?? [])),
    userIds.length ? db().from("users").select("id, name, email").in("id", userIds) : { data: [] },
    advanceAtRisk(viewer.tenantId, candidates.map((c) => c.p)),
    Promise.all(chunks(numbers, 200).map((ns) => db().from("retention_action").select("carrier_id, policy_number, outcome, acted_at, acted_by, result").eq("tenant_id", viewer.tenantId).in("policy_number", ns).order("acted_at", { ascending: false }))).then((r) => r.flatMap((x: Loose) => x.data ?? [])).catch(() => []),
  ]);
  const contactOf = new Map<string, Loose>(contacts.map((c: Loose) => [c.id, c]));
  const userName = new Map<string, string>(((users.data ?? []) as Loose[]).map((u) => [u.id, u.name || u.email]));
  const lastAction = new Map<string, Loose>();
  for (const a of actions) { const key = `${a.carrier_id}|${a.policy_number}`; if (!lastAction.has(key)) lastAction.set(key, a); }
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));

  const rows: BoardEntry[] = candidates.map(({ p, reason, daysLeft }) => {
    const key = `${p.carrier_id}|${p.policy_number}`;
    const contact = p.contact_id ? contactOf.get(p.contact_id) : null;
    const atRisk = atRiskOf.get(key) ?? null;
    const last = lastAction.get(key);
    return {
      key, carrierId: p.carrier_id, carrierName: carrierName.get(p.carrier_id) ?? "Carrier not known", policyNumber: p.policy_number,
      clientName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null : null, phone: contact?.primary_phone ?? null,
      reason, daysLeft, daysPastDue: p.days_past_due, group: groupOf(reason, daysLeft), amountDueCents: p.premium_cents === null ? null : Number(p.premium_cents), premiumMode: p.premium_mode,
      atRiskCents: atRisk, paidTo: p.paid_to_date, status: p.status_normalized, snapshotDate: p.last_snapshot_date, agentName: p.agent_user_id ? userName.get(p.agent_user_id) ?? null : null,
      lastAction: last ? { outcome: last.outcome, at: last.acted_at, by: last.acted_by ? userName.get(last.acted_by) ?? null : null, result: last.result } : null,
    };
  });
  return { rows: boardOrder(rows), today };
}

/**
 * The unearned advance the carrier takes back if each policy dies, from the ledger (LA-4.12) with the
 * advance rule in force: null ("Unknown") without an advance on file, never $0. Lines from flagged
 * statements are left out. Shared with the save queue (LA-5.3), so both boards show the same figure.
 */
export async function advanceAtRisk(tenantId: string, policies: Array<{ carrier_id: string; policy_number: string; months_paid: number | null; product_code: string | null; as_of: string }>): Promise<Map<string, number | null>> {
  const numbers = [...new Set(policies.map((p) => p.policy_number))];
  const [entries, flagged, ruleFor] = await Promise.all([
    Promise.all(chunks(numbers, 200).map((ns) => db().from("commission_entry").select("carrier_id, policy_number, entry_type, corrects_type, amount_cents, months_advanced, file_id").eq("tenant_id", tenantId).in("policy_number", ns))).then((r) => r.flatMap((x: Loose) => x.data ?? [])).catch(() => []),
    flaggedFiles(tenantId),
    advanceRuleResolver(tenantId),
  ]);
  const money = new Map<string, { advanced: number; chargedBack: number; months: number | null }>();
  for (const e of entries) {
    if (flagged.has(e.file_id)) continue;
    const key = `${e.carrier_id}|${e.policy_number}`;
    const m = money.get(key) ?? { advanced: 0, chargedBack: 0, months: null };
    const kind = e.corrects_type ?? e.entry_type;
    if (kind === "advance") { m.advanced += Number(e.amount_cents); if (e.months_advanced !== null) m.months = Math.max(m.months ?? 0, e.months_advanced); }
    if (kind === "chargeback") m.chargedBack += Number(e.amount_cents);
    money.set(key, m);
  }
  const out = new Map<string, number | null>();
  for (const p of policies) {
    const key = `${p.carrier_id}|${p.policy_number}`;
    const m = money.get(key);
    out.set(key, m && m.advanced > 0 ? unearnedAdvance({ advancedCents: m.advanced, chargedBackCents: m.chargedBack, monthsPaid: p.months_paid, rule: ruleFor(p.carrier_id, p.product_code, p.as_of), statementMonths: m.months }).atRiskCents : null);
  }
  return out;
}

/** Log one call. The board's claim at that moment is recomputed here, never taken from the browser. */
export async function logOutcome(viewer: Viewer, input: { carrierId: string; policyNumber: string; outcome: Outcome; note: string | null }) {
  const board = await loadBoard(viewer, { carrierId: input.carrierId, policyNumber: input.policyNumber });
  const row = board.rows[0];
  if (!row) throw new RetentionError("That policy isn't on your board now.", 404);
  const { error } = await db().from("retention_action").insert({
    tenant_id: viewer.tenantId, carrier_id: input.carrierId, policy_number: input.policyNumber, reason: row.reason, outcome: input.outcome, note: input.note?.trim() || null,
    acted_by: viewer.userId, board_snapshot_date: row.snapshotDate,
    board_state: { days_left: row.daysLeft, days_past_due: row.daysPastDue, paid_to: row.paidTo, status: row.status, at_risk_cents: row.atRiskCents, amount_due_cents: row.amountDueCents },
  });
  if (error) {
    if (isSchemaGap(error)) throw new RetentionError(RETENTION_PENDING_MESSAGE, 503);
    throw new Error(`Could not log the call: ${error.message}`);
  }
  return { reason: row.reason };
}

/** Save rates from logged calls the next file has marked, per reason, carrier and agent. */
export async function loadSaveRates(viewer: Viewer) {
  const { data, error } = await scopeQuery(db().from("retention_action").select("reason, carrier_id, acted_by, result").eq("tenant_id", viewer.tenantId), "acted_by", viewer.scope ?? null).gte("acted_at", new Date(Date.now() - 365 * 86_400_000).toISOString()).limit(20_000);
  if (error) {
    if (isSchemaGap(error)) return { available: false as const };
    throw new Error(error.message);
  }
  const actions = ((data ?? []) as Loose[]).map((a) => ({ reason: a.reason, carrierId: a.carrier_id, actedBy: a.acted_by, result: a.result }));
  const ids = [...new Set(actions.map((a) => a.actedBy).filter(Boolean))] as string[];
  const [users, carriers] = await Promise.all([ids.length ? db().from("users").select("id, name, email").in("id", ids) : { data: [] }, db().from("carriers").select("id, name")]);
  const userName = new Map<string, string>(((users.data ?? []) as Loose[]).map((u) => [u.id, u.name || u.email]));
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const shape = (m: ReturnType<typeof saveRates>, label: (k: string) => string) => [...m.entries()].map(([k, v]) => ({ label: label(k), ...v })).sort((a, b) => b.saved + b.lost - (a.saved + a.lost));
  return {
    available: true as const,
    calls: actions.length,
    byReason: shape(saveRates(actions, (a) => a.reason), (k) => k),
    byCarrier: shape(saveRates(actions, (a) => a.carrierId), (k) => carrierName.get(k) ?? "Carrier not known"),
    byAgent: shape(saveRates(actions, (a) => a.actedBy ?? "—"), (k) => userName.get(k) ?? "Someone no longer here"),
  };
}

/** After a policy file: mark logged calls saved, still at risk or lost from the newer data. */
export async function evaluateRetention(tenantId: string) {
  const { data, error } = await db().rpc("evaluate_retention_actions", { p_tenant_id: tenantId });
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(`Could not mark the retention calls: ${error.message}`);
  }
  return data as { saved: number; lost: number; still_at_risk: number };
}
