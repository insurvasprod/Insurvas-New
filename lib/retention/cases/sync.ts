import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { loadBoard } from "@/lib/ingestion/retentionStore";

import { DEFAULT_LADDER_SETTINGS, OPEN_STATUSES, chargebackMeansLost, REASONS, ladderTransition, paperworkTransition, placeOnLadder, priorityOf, type LadderSettings, type OpenCase, type Placement, type Reason, type StatusFlag } from "./ladder";

/**
 * The Retention ladder's sync (owner 2026-11-05, docs/retention/SPEC.md): read the agency's book as the
 * uploaded policy and commission files left it, put every flagged policy at its risk point, and close what
 * the files prove fixed or gone. The only writer of file-driven changes to `retention_case`; a person only
 * logs calls and fixes, assigns, or closes a case "without a save".
 *
 * `dryRun` returns the plan without writing (the AMAM-file check and the demo dry run use it).
 * Runs after every policy or commission file (lib/ingestion/stages.ts) and, at most every 15 minutes,
 * when Retention opens (grace running out is a date change no file brings).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
export const LADDER_PENDING_MESSAGE = "The Retention ladder needs a database update (20261105200000).";
const CHARGEBACK_DAYS = 60;

async function everyRow(build: () => Loose, max = 50_000): Promise<Loose[]> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
const keyOf = (r: { carrier_id?: string; carrierId?: string; policy_number?: string; policyNumber?: string }) => `${r.carrier_id ?? r.carrierId}|${r.policy_number ?? r.policyNumber}`;

/** The agency's overrides (Settings › Retention › Ladder rules) on the defaults. */
export async function loadLadderSettings(tenantId: string): Promise<LadderSettings> {
  const { data, error } = await db().from("retention_ladder_rule").select("reason, enabled, params").eq("tenant_id", tenantId);
  if (error) {
    if (isSchemaGap(error)) return DEFAULT_LADDER_SETTINGS;
    throw error;
  }
  const rows = (data ?? []) as Loose[];
  const thresholds = rows.find((r) => r.reason === "thresholds")?.params ?? {};
  return {
    disabled: new Set(rows.filter((r) => r.reason !== "thresholds" && r.enabled === false).map((r) => r.reason as Reason)),
    urgentDays: Number.isInteger(thresholds.urgent_days) ? thresholds.urgent_days : DEFAULT_LADDER_SETTINGS.urgentDays,
    unreachableAfter: Number.isInteger(thresholds.unreachable_after) ? thresholds.unreachable_after : DEFAULT_LADDER_SETTINGS.unreachableAfter,
  };
}

export type PlannedOpen = { carrierId: string; policyNumber: string; contactId: string | null; ownerUserId: string | null; placement: Placement; evidence: Record<string, unknown> };
export type SyncPlan = {
  opened: PlannedOpen[];
  moved: Array<{ id: string; to: Placement }>;
  refreshed: Array<{ id: string; to: Placement }>;
  saved: string[];
  lost: Array<{ id: string; reason: Reason; ladder: boolean }>;
  today: string;
};

/** Work out (and unless `dryRun`, write) what the newest files do to the agency's Retention cases. */
export async function syncRetentionCases(tenantId: string, { dryRun = false }: { dryRun?: boolean } = {}): Promise<{ available: false } | ({ available: true } & SyncPlan)> {
  const agency = { tenantId, userId: "system", role: "owner", scope: null };
  let openRows: Loose[];
  try {
    openRows = await everyRow(() => db().from("retention_case").select("id, carrier_id, policy_number, step, reason, deadline, status, evidence").eq("tenant_id", tenantId).in("status", [...OPEN_STATUSES]).order("id"));
  } catch (error) {
    if (!isSchemaGap(error as Loose)) throw error;
    // Before 20261105200000 a dry run still shows what the files would open (nothing is written).
    if (!dryRun) return { available: false };
    openRows = [];
  }
  const since = new Date(Date.now() - CHARGEBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [board, settings, policies, flags, chargebacks, retentionUsers] = await Promise.all([
    loadBoard(agency),
    loadLadderSettings(tenantId),
    everyRow(() => db().from("policy_current").select("carrier_id, policy_number, contact_id, agent_user_id, status_normalized, carrier_status_raw, paid_to_date, premium_cents").eq("tenant_id", tenantId).order("carrier_id").order("policy_number")),
    db().from("carrier_status_map").select("carrier_id, carrier_status_raw, retention_flag").eq("file_type", "policies").not("retention_flag", "is", null).not("approved_at", "is", null).then((r: Loose) => (r.error ? [] : r.data ?? [])),
    everyRow(() => db().from("commission_entry").select("carrier_id, policy_number, statement_date, amount_cents").eq("tenant_id", tenantId).eq("entry_type", "chargeback").gte("statement_date", since)).catch(() => [] as Loose[]),
    db().from("tenant_users").select("user_id, role").eq("tenant_id", tenantId).eq("role", "retention").not("accepted_at", "is", null).then((r: Loose) => ((r.data ?? []) as Loose[]).map((u) => u.user_id as string)),
  ]);
  const today = board.today;
  const flagOf = new Map<string, StatusFlag>((flags as Loose[]).map((f) => [`${f.carrier_id}|${f.carrier_status_raw}`, f.retention_flag]));
  const policyOf = new Map<string, Loose>(policies.map((p: Loose) => [keyOf(p), p]));
  const boardOf = new Map(board.rows.map((r) => [r.key, r]));
  const chargebackOf = new Map<string, Loose>();
  for (const c of chargebacks as Loose[]) chargebackOf.set(keyOf(c), c);

  // Where the files put every policy now.
  const ladderNow = new Map<string, Placement>();
  const paperworkNow = new Map<string, Placement[]>();
  const evidenceOf = (key: string): Record<string, unknown> => {
    const p = policyOf.get(key);
    const b = boardOf.get(key);
    const c = chargebackOf.get(key);
    return {
      status: p?.status_normalized ?? null, carrier_word: p?.carrier_status_raw ?? null, paid_to: p?.paid_to_date ?? null,
      days_past_due: b?.daysPastDue ?? null, days_left: b?.daysLeftSigned ?? null, file_date: b?.snapshotDate ?? null, lapsed_on: b?.lapsedOn ?? null,
      ...(c ? { chargeback: { statement_date: c.statement_date, amount_cents: Number(c.amount_cents) } } : {}),
    };
  };
  for (const p of policies as Loose[]) {
    const key = keyOf(p);
    const b = boardOf.get(key);
    const flag = p.carrier_status_raw ? flagOf.get(`${p.carrier_id}|${p.carrier_status_raw}`) ?? null : null;
    if (!b && !flag && !chargebackOf.has(key)) continue;
    // The signed countdown: a passed window keeps its real date (critique A1: 298 cases read "Today").
    const placed = placeOnLadder({ boardReason: b?.reason ?? null, daysLeft: b?.daysLeftSigned ?? null, flag }, today, settings);
    let ladder = placed.ladder;
    if (!ladder && chargebackOf.has(key) && chargebackMeansLost(p.status_normalized) && !settings.disabled.has("chargeback")) ladder = { step: "lost", reason: "chargeback", deadline: null, priority: priorityOf("chargeback", "lost") };
    if (ladder) ladderNow.set(key, ladder);
    if (placed.paperwork.length) paperworkNow.set(key, placed.paperwork);
  }

  // New cases go to the retention role (fewest open first), else the writing agent.
  const openCount = new Map<string, number>(retentionUsers.map((u: string) => [u, 0]));
  const ownerFor = (policy: Loose): string | null => {
    if (openCount.size) {
      const [user] = [...openCount.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
      openCount.set(user, (openCount.get(user) ?? 0) + 1);
      return user;
    }
    return policy?.agent_user_id ?? null;
  };

  const plan: SyncPlan = { opened: [], moved: [], refreshed: [], saved: [], lost: [], today };
  const openLadder = new Map<string, Loose>();
  const openPaper = new Map<string, Loose>();
  for (const c of openRows) {
    if (c.step === "paperwork") openPaper.set(`${keyOf(c)}|${c.reason}`, c);
    else openLadder.set(keyOf(c), c);
  }

  for (const [key, c] of openLadder) {
    const p = policyOf.get(key);
    const open: OpenCase = { id: c.id, step: c.step, reason: c.reason, deadline: c.deadline, status: c.status };
    const t = ladderTransition(open, ladderNow.get(key) ?? null, { status: p?.status_normalized ?? null, paidTo: p?.paid_to_date ?? null });
    if (t.kind === "move") plan.moved.push({ id: c.id, to: t.to });
    else if (t.kind === "refresh") plan.refreshed.push({ id: c.id, to: t.to });
    else if (t.kind === "save") plan.saved.push(c.id);
    else if (t.kind === "lose") plan.lost.push({ id: c.id, reason: t.reason, ladder: true });
  }
  for (const [paperKey, c] of openPaper) {
    const key = keyOf(c);
    const p = policyOf.get(key);
    const stillThere = (paperworkNow.get(key) ?? []).some((x) => x.reason === c.reason);
    const t = paperworkTransition({ id: c.id, step: "paperwork", reason: c.reason, deadline: c.deadline, status: c.status, byPerson: c.evidence?.by === "person" }, stillThere, { status: p?.status_normalized ?? null, paidTo: p?.paid_to_date ?? null });
    if (t.kind === "save") plan.saved.push(c.id);
    else if (t.kind === "lose") plan.lost.push({ id: c.id, reason: c.reason, ladder: false });
    void paperKey;
  }
  for (const [key, placement] of ladderNow) {
    if (openLadder.has(key)) continue;
    // A policy already lost and never worked here is history, not a case: only a chargeback opens one at step 4.
    if (placement.step === "lost" && placement.reason !== "chargeback") continue;
    const p = policyOf.get(key);
    plan.opened.push({ carrierId: p.carrier_id, policyNumber: p.policy_number, contactId: p.contact_id ?? null, ownerUserId: ownerFor(p), placement, evidence: evidenceOf(key) });
  }
  for (const [key, list] of paperworkNow) {
    for (const placement of list) {
      if (openPaper.has(`${key}|${placement.reason}`)) continue;
      const p = policyOf.get(key);
      plan.opened.push({ carrierId: p.carrier_id, policyNumber: p.policy_number, contactId: p.contact_id ?? null, ownerUserId: ownerFor(p), placement, evidence: evidenceOf(key) });
    }
  }

  if (!dryRun) await writePlan(tenantId, plan, evidenceOf, openRows);
  return { available: true, ...plan };
}

async function writePlan(tenantId: string, plan: SyncPlan, evidenceOf: (key: string) => Record<string, unknown>, openRows: Loose[]) {
  const now = new Date().toISOString();
  const byId = new Map<string, Loose>(openRows.map((c) => [c.id, c]));
  const events: Loose[] = [];
  for (let i = 0; i < plan.opened.length; i += 200) {
    const batch = plan.opened.slice(i, i + 200).map((o) => ({
      tenant_id: tenantId, carrier_id: o.carrierId, policy_number: o.policyNumber, contact_id: o.contactId, owner_user_id: o.ownerUserId,
      step: o.placement.step, reason: o.placement.reason, priority: o.placement.priority, deadline: o.placement.deadline, evidence: o.evidence,
    }));
    // A race with another run hits the open-case index (23505): then row by row, and the loser's rows are
    // simply not opened twice. (An upsert cannot target a partial unique index.)
    let { data, error } = await db().from("retention_case").insert(batch).select("id, step, reason");
    if (error?.code === "23505") {
      data = [];
      error = null;
      for (const row of batch) {
        const one = await db().from("retention_case").insert(row).select("id, step, reason");
        if (one.error && one.error.code !== "23505") { error = one.error; break; }
        data.push(...(one.data ?? []));
      }
    }
    if (error) throw new Error(`Could not open retention cases: ${error.message}`);
    for (const row of (data ?? []) as Loose[]) events.push({ tenant_id: tenantId, case_id: row.id, kind: "opened", payload: { step: row.step, reason: row.reason, by: "file" } });
  }
  for (const m of [...plan.moved, ...plan.refreshed]) {
    const c = byId.get(m.id);
    const key = keyOf(c);
    const moved = plan.moved.includes(m as Loose);
    const { error } = await db().from("retention_case").update({
      step: m.to.step, reason: m.to.reason, priority: m.to.priority, deadline: m.to.deadline, evidence: evidenceOf(key), updated_at: now, ...(moved ? { step_changed_at: now } : {}),
    }).eq("tenant_id", tenantId).eq("id", m.id).in("status", [...OPEN_STATUSES]);
    if (error) throw new Error(`Could not move a retention case: ${error.message}`);
    events.push({ tenant_id: tenantId, case_id: m.id, kind: moved ? "step_moved" : "evidence", payload: { from: c.step, to: m.to.step, reason: m.to.reason, deadline: m.to.deadline, by: "file" } });
  }
  for (const id of plan.saved) {
    const { error } = await db().from("retention_case").update({ status: "saved", resolved_at: now, resolved_by: "file", updated_at: now, evidence: evidenceOf(keyOf(byId.get(id))) }).eq("tenant_id", tenantId).eq("id", id).in("status", [...OPEN_STATUSES]);
    if (error) throw new Error(`Could not close a retention case: ${error.message}`);
    events.push({ tenant_id: tenantId, case_id: id, kind: "resolved", payload: { status: "saved", by: "file" } });
  }
  for (const l of plan.lost) {
    const c = byId.get(l.id);
    // A ladder case goes to step 4 and waits for a person to close it to win-back; paperwork just ends.
    const patch = l.ladder
      ? { step: "lost", reason: l.reason, priority: priorityOf(l.reason, "lost"), deadline: null, step_changed_at: now, updated_at: now, evidence: evidenceOf(keyOf(c)) }
      : { status: "lost", resolved_at: now, resolved_by: "file", updated_at: now };
    const { error } = await db().from("retention_case").update(patch).eq("tenant_id", tenantId).eq("id", l.id).in("status", [...OPEN_STATUSES]);
    if (error) throw new Error(`Could not mark a retention case lost: ${error.message}`);
    events.push({ tenant_id: tenantId, case_id: l.id, kind: l.ladder ? "step_moved" : "resolved", payload: l.ladder ? { from: c.step, to: "lost", reason: l.reason, by: "file" } : { status: "lost", by: "file" } });
  }
  for (let i = 0; i < events.length; i += 500) {
    const { error } = await db().from("retention_case_event").insert(events.slice(i, i + 500));
    if (error) console.error("[retention ladder] the timeline could not be written", error);
  }
}

const lastRun = new Map<string, number>();
/** At most every 15 minutes per agency (per server instance): grace running out needs no file to move a case. */
export async function ensureCasesFresh(tenantId: string): Promise<void> {
  const at = lastRun.get(tenantId) ?? 0;
  if (Date.now() - at < 15 * 60_000) return;
  lastRun.set(tenantId, Date.now());
  try {
    await syncRetentionCases(tenantId);
  } catch (error) {
    lastRun.delete(tenantId);
    console.error("[retention ladder] the cases could not be refreshed", error);
  }
}

export const ALL_REASONS = REASONS;
