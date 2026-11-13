import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { rowVisible, type ProducerScope } from "@/lib/agency/visibility";
import { isUnreached } from "@/lib/retention/callLog";
import { advanceAtRisk } from "@/lib/ingestion/retentionStore";
import type { ActionTaken, ContactOutcome } from "@/lib/retention/constants";

import { CLOSED_DAYS, NEXT_ACTION, OPEN_STATUSES, caseOrder, daysUntil, type CaseStatus, type PersonReason, type Reason, type Step } from "./ladder";
import { LADDER_PENDING_MESSAGE, loadLadderSettings } from "./sync";

/**
 * The Retention ladder's reads and a person's writes (docs/retention/SPEC.md). The files open, move and close
 * cases (./sync.ts); a person logs calls, records a fix, assigns, and closes a case only "without a save" (or a
 * lost one to win-back). Who sees what: the owner every case; a producer the cases on policies credited to them;
 * a retention rep the cases they own; a narrower agency session only its producers' policies.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
export type Viewer = { tenantId: string; userId: string; role: string; scope?: ProducerScope };

export class CaseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CaseError";
  }
}

export type CaseRow = {
  id: string; carrierId: string; carrierName: string; policyNumber: string; clientName: string | null; phone: string | null;
  step: Step; reason: Reason; status: CaseStatus; priority: number; deadline: string | null; daysLeft: number | null;
  evidence: Record<string, Loose>; ownerId: string | null; ownerName: string | null; contactAttempts: number; unreachable: boolean;
  lastContactAt: string | null; premiumCents: number | null; premiumMode: string | null; openedAt: string; stepChangedAt: string;
  resolvedAt: string | null; outcomeReason: string | null; nextAction: string; servicingRequestId: string | null; reinstatementCaseId: string | null;
  /** The premium as a monthly figure (critique B7: how an agent picks first) and who wrote the policy (C7). */
  monthlyCents: number | null; agentName: string | null; clientState: string | null;
  /** Round 3 (2026-11-06), the open list only: the product and face, the unearned advance at stake, the last call. */
  product: string | null; faceCents: number | null; atRiskCents: number | null; lastCall: { at: string; outcome: string } | null;
};

const CASE_COLUMNS = "id, carrier_id, policy_number, contact_id, step, reason, status, priority, deadline, evidence, owner_user_id, contact_attempts, last_contact_at, opened_at, step_changed_at, resolved_at, outcome_reason, servicing_request_id, reinstatement_case_id";

async function everyRow(build: () => Loose, max = 50_000): Promise<Loose[]> {
  // The first page, then three at a time (perf pass 2026-11-09): the same rows, in order, as one page after another.
  const rows: Loose[] = [];
  for (let from = 0; from < max; ) {
    const starts = (from === 0 ? [0] : [from, from + 1000, from + 2000]).filter((at) => at < max);
    const batch = await Promise.all(starts.map((at) => build().range(at, at + 999)));
    for (const { data, error } of batch) {
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) return rows;
    }
    from += starts.length * 1000;
  }
  return rows;
}
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const keyOf = (r: Loose) => `${r.carrier_id}|${r.policy_number}`;

/**
 * Fill in the names, phone, premium and owner for case rows, and keep only what this viewer may see. With
 * `work` (the open list, round 3 2026-11-06): the product and face amount, the advance the agency loses if it
 * dies, and the last call — what an agent needs on the row to decide what to do first.
 */
async function hydrate(viewer: Viewer, rows: Loose[], today: string, unreachableAfter: number, { work = false }: { work?: boolean } = {}): Promise<CaseRow[]> {
  if (!rows.length) return [];
  const numbers = [...new Set(rows.map((r) => r.policy_number))] as string[];
  const [policies, carriers] = await Promise.all([
    Promise.all(chunks(numbers, 200).map((part) => db().from("policy_current").select("carrier_id, policy_number, contact_id, agent_user_id, premium_cents, premium_mode, product_code, face_amount_cents, months_paid, as_of").eq("tenant_id", viewer.tenantId).in("policy_number", part)))
      .then((r) => r.flatMap((x: Loose) => x.data ?? [])),
    db().from("carriers").select("id, name"),
  ]);
  const policyOf = new Map<string, Loose>(policies.map((p: Loose) => [keyOf(p), p]));
  const visible = rows.filter((r) => {
    const p = policyOf.get(keyOf(r));
    if (viewer.role === "producer" && p?.agent_user_id !== viewer.userId) return false;
    if (viewer.role === "retention" && r.owner_user_id !== viewer.userId) return false;
    return rowVisible(viewer.scope ?? null, p?.agent_user_id ?? null);
  });
  const contactIds = [...new Set(visible.map((r) => r.contact_id ?? policyOf.get(keyOf(r))?.contact_id).filter(Boolean))] as string[];
  const ownerIds = [...new Set(visible.flatMap((r) => [r.owner_user_id, policyOf.get(keyOf(r))?.agent_user_id]).filter(Boolean))] as string[];
  const [contacts, owners] = await Promise.all([
    Promise.all(chunks(contactIds, 200).map((ids) => db().from("contacts").select("id, first_name, last_name, primary_phone, state").eq("tenant_id", viewer.tenantId).in("id", ids))).then((r) => r.flatMap((x: Loose) => x.data ?? [])),
    ownerIds.length ? db().from("users").select("id, name, email").in("id", ownerIds) : { data: [] },
  ]);
  const contactOf = new Map<string, Loose>(contacts.map((c: Loose) => [c.id, c]));
  const ownerName = new Map<string, string>(((owners.data ?? []) as Loose[]).map((u) => [u.id, u.name || u.email]));
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const [atRiskOf, lastCallOf] = work ? await Promise.all([
    advanceAtRisk(viewer.tenantId, visible.map((r) => policyOf.get(keyOf(r))).filter(Boolean)).catch(() => new Map<string, number | null>()),
    // The newest call per case, newest first per chunk (a call is a case event).
    Promise.all(chunks(visible.map((r) => r.id as string), 200).map((ids) => db().from("retention_case_event").select("case_id, payload, created_at").eq("tenant_id", viewer.tenantId).eq("kind", "call").in("case_id", ids).order("created_at", { ascending: false })))
      .then((parts) => {
        const out = new Map<string, { at: string; outcome: string }>();
        for (const e of parts.flatMap((x: Loose) => x.data ?? []) as Loose[]) if (!out.has(e.case_id)) out.set(e.case_id, { at: e.created_at, outcome: String(e.payload?.outcome ?? "") });
        return out;
      }).catch(() => new Map<string, { at: string; outcome: string }>()),
  ]) : [new Map<string, number | null>(), new Map<string, { at: string; outcome: string }>()];
  return visible.map((r) => {
    const p = policyOf.get(keyOf(r));
    const c = contactOf.get(r.contact_id ?? p?.contact_id);
    return {
      id: r.id, carrierId: r.carrier_id, carrierName: carrierName.get(r.carrier_id) ?? "Carrier not known", policyNumber: r.policy_number,
      clientName: c ? [c.first_name, c.last_name].filter(Boolean).join(" ") || null : null, phone: c?.primary_phone ?? null,
      step: r.step, reason: r.reason, status: r.status, priority: r.priority, deadline: r.deadline, daysLeft: daysUntil(r.deadline, today),
      evidence: r.evidence ?? {}, ownerId: r.owner_user_id, ownerName: r.owner_user_id ? ownerName.get(r.owner_user_id) ?? "Someone no longer here" : null,
      contactAttempts: r.contact_attempts, unreachable: r.contact_attempts >= unreachableAfter, lastContactAt: r.last_contact_at,
      premiumCents: p?.premium_cents == null ? null : Number(p.premium_cents), premiumMode: p?.premium_mode ?? null,
      openedAt: r.opened_at, stepChangedAt: r.step_changed_at, resolvedAt: r.resolved_at, outcomeReason: r.outcome_reason,
      nextAction: NEXT_ACTION[r.reason as Reason] ?? "Open", servicingRequestId: r.servicing_request_id, reinstatementCaseId: r.reinstatement_case_id,
      monthlyCents: p?.premium_cents == null ? null : monthly(Number(p.premium_cents), p.premium_mode ?? null),
      agentName: p?.agent_user_id ? ownerName.get(p.agent_user_id) ?? null : null, clientState: c?.state ?? null,
      product: p?.product_code ?? null, faceCents: p?.face_amount_cents == null ? null : Number(p.face_amount_cents),
      atRiskCents: atRiskOf.get(keyOf(r)) ?? null, lastCall: lastCallOf.get(r.id) ?? null,
    };
  });
}

export type Ladder = {
  available: true;
  today: string;
  open: CaseRow[];
  /** Saved this calendar month (by the files), with the monthly premium kept. */
  savedThisMonth: { count: number; premiumCents: number };
  lost: CaseRow[];
  /** Every case closed in the last 90 days (saved, lost, closed without a save), newest first: the Closed tab. */
  closed: CaseRow[];
};

const agencyToday = () => new Date().toISOString().slice(0, 10);

/** Every open case this viewer may see, in working order, plus this month's saves and the recent losses. */
export async function loadLadder(viewer: Viewer): Promise<Ladder | { available: false }> {
  const today = agencyToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const closedSince = new Date(Date.parse(`${today}T00:00:00Z`) - CLOSED_DAYS * 86_400_000).toISOString().slice(0, 10);
  const since = closedSince < monthStart ? closedSince : monthStart;
  let open: Loose[];
  let recent: Loose[];
  try {
    [open, recent] = await Promise.all([
      everyRow(() => db().from("retention_case").select(CASE_COLUMNS).eq("tenant_id", viewer.tenantId).in("status", [...OPEN_STATUSES]).order("id")),
      everyRow(() => db().from("retention_case").select(CASE_COLUMNS).eq("tenant_id", viewer.tenantId).in("status", ["saved", "lost", "closed_no_save"]).gte("resolved_at", `${since}T00:00:00Z`).order("id")),
    ]);
  } catch (error) {
    if (isSchemaGap(error as Loose)) return { available: false };
    throw error;
  }
  const settings = await loadLadderSettings(viewer.tenantId);
  const [openRows, recentRows] = await Promise.all([hydrate(viewer, open, today, settings.unreachableAfter, { work: true }), hydrate(viewer, recent, today, settings.unreachableAfter)]);
  const thisMonth = recentRows.filter((r) => (r.resolvedAt ?? "") >= monthStart);
  const saved = thisMonth.filter((r) => r.status === "saved");
  return {
    available: true,
    today,
    open: caseOrder(openRows),
    savedThisMonth: { count: saved.length, premiumCents: saved.reduce((sum, r) => sum + monthly(r.premiumCents, r.premiumMode), 0) },
    lost: thisMonth.filter((r) => r.status === "lost"),
    closed: recentRows.filter((r) => (r.resolvedAt ?? "") >= closedSince).sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "")),
  };
}

/**
 * The scorecard's cases: every case open now, or closed since `since` (an ISO date). A retention rep and a
 * producer see only their own (as on the ladder); names for the owners come along.
 */
export async function loadScoreCases(viewer: Viewer, days: number): Promise<{ cases: CaseRow[]; names: Map<string, string> } | null> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  // The settings need nothing from the cases, so they are read beside them (perf pass 2026-11-09).
  const settingsRead = loadLadderSettings(viewer.tenantId);
  settingsRead.catch(() => undefined);
  let rows: Loose[];
  try {
    rows = await everyRow(() => db().from("retention_case").select(CASE_COLUMNS).eq("tenant_id", viewer.tenantId).or(`status.in.(${OPEN_STATUSES.join(",")}),resolved_at.gte.${since}T00:00:00Z`).order("id"));
  } catch (error) {
    if (isSchemaGap(error as Loose)) return null;
    throw error;
  }
  const settings = await settingsRead;
  const cases = await hydrate(viewer, rows, agencyToday(), settings.unreachableAfter);
  return { cases, names: new Map(cases.filter((c) => c.ownerId).map((c) => [c.ownerId!, c.ownerName ?? "Someone"])) };
}

/** Whether the ladder's tables exist yet (20261105200000); until then the old Lapse risk call list stays. */
export async function ladderAvailable(tenantId: string): Promise<boolean> {
  // A plain one-row read: a head (count) request carries no error body, so a missing table looked "available"
  // (walk 2026-11-05: Lapse risk redirected to a Cases page that could not load). Any error means not yet.
  const { error } = await db().from("retention_case").select("id").eq("tenant_id", tenantId).limit(1);
  return !error;
}

/** A premium as a monthly figure (annual ÷ 12, quarterly ÷ 3, semi-annual ÷ 6), integer cents. */
export function monthly(cents: number | null, mode: string | null): number {
  if (cents === null) return 0;
  const m = (mode ?? "monthly").toLowerCase();
  const divisor = m.startsWith("ann") ? 12 : m.startsWith("semi") ? 6 : m.startsWith("quar") ? 3 : 1;
  return Math.round(cents / divisor);
}

export type CaseEvent = { id: string; kind: string; at: string; by: string | null; payload: Record<string, Loose> };
export type CaseCall = { at: string; outcome: string; did: string | null; note: string | null; by: string | null; source: "case" | "lapse_risk" };

/** One case for its page: the row, its whole timeline, every call on the policy (this case's, and LA-4.16's before it). */
export async function loadCase(viewer: Viewer, id: string): Promise<{ row: CaseRow; events: CaseEvent[]; calls: CaseCall[]; policy: Loose | null; owners: Array<{ id: string; name: string }>; reinstatementId: string | null; draftDay: number | null } | null> {
  const { data, error } = await db().from("retention_case").select(CASE_COLUMNS).eq("tenant_id", viewer.tenantId).eq("id", id).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) throw new CaseError(LADDER_PENDING_MESSAGE, 503);
    throw error;
  }
  if (!data) return null;
  const settings = await loadLadderSettings(viewer.tenantId);
  const [row] = await hydrate(viewer, [data], agencyToday(), settings.unreachableAfter);
  if (!row) return null;
  const [events, actions, policy, members, signals] = await Promise.all([
    db().from("retention_case_event").select("id, kind, actor_user_id, payload, created_at").eq("tenant_id", viewer.tenantId).eq("case_id", id).order("created_at", { ascending: false }).limit(200),
    db().from("retention_action").select("outcome, acted_at, acted_by, note").eq("tenant_id", viewer.tenantId).eq("carrier_id", row.carrierId).eq("policy_number", row.policyNumber).order("acted_at", { ascending: false }).limit(50).then((r: Loose) => (r.error ? { data: [] } : r)),
    db().from("policy_current").select("status_normalized, carrier_status_raw, paid_to_date, effective_date, issue_date, premium_cents, premium_mode, face_amount_cents, payment_method, months_paid, last_snapshot_date, product_code").eq("tenant_id", viewer.tenantId).eq("carrier_id", row.carrierId).eq("policy_number", row.policyNumber).maybeSingle(),
    db().from("tenant_users").select("user_id, role, users!inner(name, email)").eq("tenant_id", viewer.tenantId).in("role", ["owner", "producer", "retention"]).not("accepted_at", "is", null),
    // The draft day, for the Policy tab (critique C7): what a servicing call needs.
    db().from("policy_risk_signals").select("draft_day").eq("tenant_id", viewer.tenantId).eq("carrier_id", row.carrierId).eq("policy_number", row.policyNumber).maybeSingle().then((r: Loose) => (r.error ? { data: null } : r)),
  ]);
  const actorIds = [...new Set([...((events.data ?? []) as Loose[]).map((e) => e.actor_user_id), ...((actions.data ?? []) as Loose[]).map((a) => a.acted_by)].filter(Boolean))] as string[];
  const actors = actorIds.length ? await db().from("users").select("id, name, email").in("id", actorIds) : { data: [] };
  const name = new Map<string, string>(((actors.data ?? []) as Loose[]).map((u) => [u.id, u.name || u.email]));
  const evs: CaseEvent[] = ((events.data ?? []) as Loose[]).map((e) => ({ id: e.id, kind: e.kind, at: e.created_at, by: e.actor_user_id ? name.get(e.actor_user_id) ?? "Someone no longer here" : null, payload: e.payload ?? {} }));
  const calls: CaseCall[] = [
    ...evs.filter((e) => e.kind === "call").map((e) => ({ at: e.at, outcome: String(e.payload.outcome ?? ""), did: e.payload.did ?? null, note: e.payload.note ?? null, by: e.by, source: "case" as const })),
    ...((actions.data ?? []) as Loose[]).map((a) => ({ at: a.acted_at, outcome: a.outcome, did: null, note: a.note ?? null, by: a.acted_by ? name.get(a.acted_by) ?? null : null, source: "lapse_risk" as const })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const owners = ((members.data ?? []) as Loose[]).map((m) => ({ id: m.user_id as string, name: (m.users?.name || m.users?.email) as string })).sort((a, b) => a.name.localeCompare(b.name));
  // Step 3's work is the reinstatement case (LA-5.6) on the same policy, newest first.
  const reinstatement = row.step === "lapsed_reinstatable"
    ? (await db().from("reinstatement_case").select("id").eq("tenant_id", viewer.tenantId).eq("carrier_id", row.carrierId).eq("policy_number", row.policyNumber).order("lapsed_on", { ascending: false }).limit(1).maybeSingle()).data?.id ?? row.reinstatementCaseId
    : row.reinstatementCaseId;
  return { row, events: evs, calls, policy: policy.data ?? null, owners, reinstatementId: (reinstatement as string | null) ?? null, draftDay: signals.data?.draft_day ?? null };
}

/**
 * The open ladder case on a policy, if any: where a reinstatement is worked since the critique of 2026-11-05 (D1),
 * so the old reinstatement page sends its reader there. null before the ladder exists.
 */
export async function openLadderCaseId(tenantId: string, carrierId: string, policyNumber: string): Promise<string | null> {
  const { data, error } = await db().from("retention_case").select("id").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).neq("step", "paperwork").in("status", [...OPEN_STATUSES]).limit(1).maybeSingle();
  return error ? null : (data?.id as string | undefined) ?? null;
}

/** The case, checked: it exists, this viewer may act on it, and it is still open. */
async function openCaseFor(viewer: Viewer, id: string): Promise<CaseRow> {
  const loaded = await loadCase(viewer, id);
  if (!loaded) throw new CaseError("That case isn't here.", 404);
  if (!(OPEN_STATUSES as readonly string[]).includes(loaded.row.status)) throw new CaseError("This case is closed.", 409);
  return loaded.row;
}

async function event(viewer: Viewer, caseId: string, kind: string, payload: Record<string, unknown>) {
  const { error } = await db().from("retention_case_event").insert({ tenant_id: viewer.tenantId, case_id: caseId, kind, actor_user_id: viewer.userId, payload });
  if (error) console.error("[retention case] the timeline could not be written", error);
}

/** Update a case only if it is still in the status it was read in: a file that moved it meanwhile wins. */
async function update(viewer: Viewer, row: CaseRow, patch: Record<string, unknown>) {
  const { data, error } = await db().from("retention_case").update({ ...patch, updated_at: new Date().toISOString() }).eq("tenant_id", viewer.tenantId).eq("id", row.id).eq("status", row.status).select("id");
  if (error) throw new Error(`Could not update the case: ${error.message}`);
  if (!data?.length) throw new CaseError("The case moved on (a new file changed it). Reload it and try again.", 409);
}

/** A call: who was reached, what was done. Not reaching anyone counts towards Unreachable; reaching someone resets it. */
export async function logCaseCall(viewer: Viewer, id: string, input: { outcome: ContactOutcome; did: ActionTaken; note: string | null }) {
  const row = await openCaseFor(viewer, id);
  const unreached = isUnreached(input.outcome);
  await update(viewer, row, {
    contact_attempts: unreached ? row.contactAttempts + 1 : 0, last_contact_at: new Date().toISOString(), ...(row.status === "open" ? { status: "working" } : {}),
  });
  await event(viewer, id, "call", { outcome: input.outcome, did: unreached ? null : input.did, note: input.note?.trim() || null });
  // One tracker on step 3 (critique D1): reaching the client moves the reinstatement from "Not called yet" too.
  if (!unreached && row.step === "lapsed_reinstatable") {
    const { data: r } = await db().from("reinstatement_case").select("id").eq("tenant_id", viewer.tenantId).eq("carrier_id", row.carrierId).eq("policy_number", row.policyNumber).eq("status", "identified").order("lapsed_on", { ascending: false }).limit(1).maybeSingle();
    if (r?.id) {
      const { updateCase } = await import("@/lib/retention/reinstatementStore");
      await updateCase(viewer, r.id, { status: "contacted" }).catch((error: unknown) => console.error("[retention ladder] the reinstatement could not follow the call", error));
    }
  }
}

export const FIX_KINDS = ["payment_taken", "sent_to_carrier", "checklist"] as const;
export type FixKind = (typeof FIX_KINDS)[number];

/** A fix recorded: the case now waits for a carrier file to prove it (it never closes on someone's word). */
export async function recordFix(viewer: Viewer, id: string, input: { kind: FixKind; note: string | null; amountCents?: number | null; items?: string[] }) {
  const row = await openCaseFor(viewer, id);
  const waits = input.kind !== "checklist";
  await update(viewer, row, waits ? { status: "waiting_on_carrier" } : row.status === "open" ? { status: "working" } : {});
  await event(viewer, id, "fix", { kind: input.kind, note: input.note?.trim() || null, amount_cents: input.amountCents ?? null, items: input.items ?? null });
}

/** A servicing request opened from the case (bank, draft date, bill → draft): linked, and the case waits on the carrier. */
export async function linkServicing(viewer: Viewer, id: string, requestId: string) {
  const row = await openCaseFor(viewer, id);
  const { data } = await db().from("servicing_request").select("id").eq("tenant_id", viewer.tenantId).eq("id", requestId).eq("carrier_id", row.carrierId).eq("policy_number", row.policyNumber).maybeSingle();
  if (!data) throw new CaseError("That request is not on this policy.", 400);
  await update(viewer, row, { servicing_request_id: requestId, status: "waiting_on_carrier" });
  await event(viewer, id, "servicing_linked", { request_id: requestId });
}

/**
 * The only closes a person makes: "without a save" (with a reason) on any open case, or "to win-back" on a case
 * the files already put on step 4. Saved, and lost below step 4, are the files'.
 */
export async function closeCase(viewer: Viewer, id: string, input: { as: "closed_no_save" | "lost"; reason: string }) {
  const row = await openCaseFor(viewer, id);
  const reason = input.reason.trim();
  if (input.as === "closed_no_save" && reason.length < 3) throw new CaseError("Say why, in a few words.", 400);
  if (input.as === "lost" && row.step !== "lost") throw new CaseError("Only a case the files put on Lost can be closed to win-back.", 409);
  await update(viewer, row, { status: input.as, outcome_reason: reason || null, resolved_at: new Date().toISOString(), resolved_by: viewer.userId });
  await event(viewer, id, "resolved", { status: input.as, reason: reason || null });
}

/** Hand a case to someone (owners only; an agency member who works retention, sells, or owns it). */
/** A note on its own (owner 2026-11-06: typed or dictated), on the case's timeline. It never moves the case. */
export async function addNote(viewer: Viewer, id: string, note: string) {
  await openCaseFor(viewer, id);
  const text = note.trim();
  if (!text) throw new CaseError("Write the note first.", 400);
  await event(viewer, id, "note", { note: text });
}

export async function assignCase(viewer: Viewer, id: string, userId: string) {
  if (viewer.role !== "owner") throw new CaseError("Only the owner assigns cases.", 403);
  const row = await openCaseFor(viewer, id);
  const { data: member } = await db().from("tenant_users").select("user_id").eq("tenant_id", viewer.tenantId).eq("user_id", userId).in("role", ["owner", "producer", "retention"]).not("accepted_at", "is", null).maybeSingle();
  if (!member) throw new CaseError("That person can't work retention here.", 400);
  await update(viewer, row, { owner_user_id: userId });
  await event(viewer, id, "assigned", { from: row.ownerId, to: userId });
}

/** A case a person opens: a client asking for a new payment date (no file carries that). */
export async function openManualCase(viewer: Viewer, input: { carrierId: string; policyNumber: string; reason: PersonReason; note: string | null }) {
  const { data: p } = await db().from("policy_current").select("contact_id, agent_user_id").eq("tenant_id", viewer.tenantId).eq("carrier_id", input.carrierId).eq("policy_number", input.policyNumber).maybeSingle();
  if (!p || (viewer.role === "producer" && p.agent_user_id !== viewer.userId) || !rowVisible(viewer.scope ?? null, p.agent_user_id)) throw new CaseError("That policy isn't in your book.", 404);
  const { data, error } = await db().from("retention_case").insert({
    tenant_id: viewer.tenantId, carrier_id: input.carrierId, policy_number: input.policyNumber, contact_id: p.contact_id, owner_user_id: viewer.userId,
    step: "paperwork", reason: input.reason, priority: 2, evidence: { by: "person" },
  }).select("id").single();
  if (error) {
    if (error.code === "23505") throw new CaseError("This policy already has that case open.", 409);
    if (isSchemaGap(error)) throw new CaseError(LADDER_PENDING_MESSAGE, 503);
    throw new Error(`Could not open the case: ${error.message}`);
  }
  await event(viewer, data.id, "opened", { step: "paperwork", reason: input.reason, by: "person", note: input.note?.trim() || null });
  return { id: data.id as string };
}
