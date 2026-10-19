import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { advanceAtRisk } from "@/lib/ingestion/retentionStore";
import { rowVisible, scopeQuery, type ProducerScope } from "@/lib/agency/visibility";

import { agencyToday } from "./agencyDay";
import { settingsFromRow, type RetentionSettings } from "./constants";
import { canMove, caseOrder, compare, daysRemaining, estimateOwed, OPEN_CASE_STATUSES, urgencyOf, type CaseStatus, type Comparison, type Urgency } from "./reinstatement";
import { ownsCard } from "./assignment";
import { ensureOwners, ownerOf, type Owner } from "./assignmentStore";

/**
 * LA-5.6 (Notion sprint) · reinstatement cases, server side. sync_reinstatement_cases (the database)
 * opens cases, marks them reinstated from the carrier file, expires them, and alerts as deadlines
 * near; a person records the call, what the carrier needs, and the client's or carrier's answer.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const PAGE = 1000;
const CHUNK = 200;

export const REINSTATEMENT_PENDING_MESSAGE = "Reinstatement needs a database update (20261014400000).";

export class ReinstatementError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ReinstatementError";
  }
}

/**
 * AG-0.5 · `scope` is the session's producer scope (scopeFor). With one, only cases on policies credited to a
 * visible producer (policy_current.agent_user_id) are listed, counted, pinned or updated; owners are still
 * resolved across the agency first (as today). Absent or null = unchanged.
 */
export type Viewer = { tenantId: string; userId: string; role: string; scope?: ProducerScope };

async function everyRow(build: () => Loose, max = 50_000): Promise<Loose[]> {
  const rows: Loose[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
const keyOf = (r: { carrier_id: string; policy_number: string }) => `${r.carrier_id}|${r.policy_number}`;
const inChunks = async (ids: string[], read: (part: string[]) => Loose) => {
  const out: Loose[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await read(ids.slice(i, i + CHUNK));
    if (r.error) throw r.error;
    out.push(...(r.data ?? []));
  }
  return out;
};

export type CaseRow = {
  id: string;
  key: string;
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  clientName: string | null;
  phone: string | null;
  agentName: string | null;
  lapsedOn: string;
  deadline: string | null;
  daysRemaining: number | null;
  urgency: Urgency;
  status: CaseStatus;
  monthlyPremiumCents: number | null;
  faceCents: number | null;
  advanceCents: number | null;
  comparison: Comparison;
  requiresHealthQuestions: boolean | null;
  requiresSignedForm: boolean | null;
  requirementsNote: string | null;
  carrierReference: string | null;
  declineReason: string | null;
  workedBy: string | null;
  resolvedAt: string | null;
  note: string | null;
  /** LA-5.8: who works the case (open cases only); escalated = moved to the writing agent near the deadline. */
  owner: Owner | null;
};

export type Reinstatement = {
  available: true;
  today: string;
  open: CaseRow[];
  closed: CaseRow[];
  settings: RetentionSettings;
  /** LA-5.8: owners are shown only when more than one person owns cases. */
  showOwners: boolean;
  counts: { open: number; pinned: number; noWindow: number; reinstated90: number; expired90: number; declined90: number; advanceOpenCents: number; advanceUnknown: number };
};

/** Ask the database to open, reinstate, expire and alert. Idempotent. */
export async function runReinstatementSync(tenantId: string) {
  const { data, error } = await db().rpc("sync_reinstatement_cases", { p_tenant_id: tenantId });
  if (error) {
    if (isSchemaGap(error) || error.code === "PGRST202") return null;
    throw new Error(`Could not check the reinstatement windows: ${error.message}`);
  }
  return data as { opened: number; reinstated: number; expired: number; alerts: number };
}

export async function loadReinstatement(viewer: Viewer): Promise<Reinstatement | { available: false }> {
  try {
    await runReinstatementSync(viewer.tenantId);
  } catch (error) {
    console.error("[reinstatement] the sync could not run", error);
  }
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  let cases: Loose[];
  let settingsRow: Loose;
  try {
    const [c, s] = await Promise.all([
      everyRow(() => db().from("reinstatement_case").select("*").eq("tenant_id", viewer.tenantId).or(`status.in.(${OPEN_CASE_STATUSES.join(",")}),resolved_at.gte.${since}`).order("created_at", { ascending: false }).order("id")),
      db().from("retention_settings").select("*").eq("tenant_id", viewer.tenantId).maybeSingle(),
    ]);
    cases = c;
    settingsRow = s.data;
  } catch (error) {
    if (isSchemaGap(error as Loose)) return { available: false };
    throw error;
  }
  const settings = settingsFromRow(settingsRow);
  const numbers = [...new Set(cases.map((c) => c.policy_number))];
  const policies = (await inChunks(numbers, (part) => db().from("policy_current").select("carrier_id, policy_number, agent_user_id, contact_id, paid_to_date, premium_cents, premium_mode, annualised_premium_cents, face_amount_cents, months_paid, product_code, as_of, issue_date, issued_on, effective_date").eq("tenant_id", viewer.tenantId).in("policy_number", part)))
    .filter((p: Loose) => cases.some((c) => keyOf(c) === keyOf(p)));
  const policyOf = new Map<string, Loose>(policies.map((p: Loose) => [keyOf(p), p]));
  // The agency's day — the same one the banner and the database's expiry count from.
  const today = await agencyToday(viewer.tenantId);
  // LA-5.8: every open case has an owner, resolved across the agency before anyone filters. The
  // advance at risk is read for all of them (the "by exposure" strategy places by it).
  const allOpen = cases.filter((c) => OPEN_CASE_STATUSES.includes(c.status));
  const advanceMap = await advanceAtRisk(viewer.tenantId, allOpen.map((c) => policyOf.get(keyOf(c))).filter(Boolean));
  const owners = await ensureOwners(viewer.tenantId, "reinstatement", allOpen.map((c) => ({
    key: keyOf(c), carrierId: c.carrier_id, writingAgentId: policyOf.get(keyOf(c))?.agent_user_id ?? null, exposureCents: advanceMap.get(keyOf(c)) ?? null, daysToDeadline: daysRemaining(c.deadline, today),
  })), settings, { keep: new Set(allOpen.map(keyOf)) }).catch((error) => {
    console.error("[reinstatement] owners could not be resolved", error);
    return null;
  });
  const visible = (viewer.role === "producer"
    ? cases.filter((c) => policyOf.get(keyOf(c))?.agent_user_id === viewer.userId)
    : viewer.role === "retention"
      ? cases.filter((c) => OPEN_CASE_STATUSES.includes(c.status) && owners?.get(keyOf(c))?.userId === viewer.userId)
      : cases)
    .filter((c) => rowVisible(viewer.scope ?? null, policyOf.get(keyOf(c))?.agent_user_id));
  const contactIds = [...new Set(visible.map((c) => c.contact_id ?? policyOf.get(keyOf(c))?.contact_id).filter(Boolean))] as string[];
  const userIds = [...new Set(visible.flatMap((c) => [c.worked_by, policyOf.get(keyOf(c))?.agent_user_id]).filter(Boolean))] as string[];
  const [contacts, users, carriers] = await Promise.all([
    inChunks(contactIds, (part) => db().from("contacts").select("id, first_name, last_name, primary_phone, dob").eq("tenant_id", viewer.tenantId).in("id", part)),
    userIds.length ? db().from("users").select("id, name, email").in("id", userIds) : { data: [] },
    db().from("carriers").select("id, name"),
  ]);
  const contactOf = new Map<string, Loose>(contacts.map((c: Loose) => [c.id, c]));
  const userName = new Map<string, string>(((users.data ?? []) as Loose[]).map((u) => [u.id, u.name || u.email]));
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));

  const rows: CaseRow[] = visible.map((c) => {
    const key = keyOf(c);
    const p = policyOf.get(key) ?? {};
    const contact = contactOf.get(c.contact_id ?? p.contact_id);
    const monthly = p.annualised_premium_cents == null ? null : Math.round(Number(p.annualised_premium_cents) / 12);
    const days = daysRemaining(c.deadline, today);
    // The advance revives on reinstatement: the unearned advance the lapse put at risk (LA-4.12), for open cases.
    const advance = OPEN_CASE_STATUSES.includes(c.status) ? advanceMap.get(key) ?? null : null;
    return {
      id: c.id, key, carrierId: c.carrier_id, carrierName: carrierName.get(c.carrier_id) ?? "Carrier not known", policyNumber: c.policy_number,
      clientName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || null : null, phone: contact?.primary_phone ?? null,
      agentName: p.agent_user_id ? userName.get(p.agent_user_id) ?? null : null,
      lapsedOn: c.lapsed_on, deadline: c.deadline, daysRemaining: days, urgency: urgencyOf(days, settings), status: c.status,
      monthlyPremiumCents: monthly, faceCents: p.face_amount_cents == null ? null : Number(p.face_amount_cents), advanceCents: advance,
      comparison: compare({
        enteredOwedCents: c.amount_owed_cents == null ? null : Number(c.amount_owed_cents), enteredMonths: c.months_owed,
        estimate: estimateOwed(p.paid_to_date ?? null, today, monthly), advanceCents: advance, needsHealthQuestions: c.requires_health_questions,
        dob: contact?.dob ?? null, issuedOn: p.issue_date ?? p.issued_on ?? p.effective_date ?? null, today,
      }),
      requiresHealthQuestions: c.requires_health_questions, requiresSignedForm: c.requires_signed_form, requirementsNote: c.carrier_requirements_note,
      carrierReference: c.carrier_reference, declineReason: c.decline_reason, workedBy: c.worked_by ? userName.get(c.worked_by) ?? "Someone no longer here" : null,
      resolvedAt: c.resolved_at, note: c.note,
      owner: OPEN_CASE_STATUSES.includes(c.status) ? owners?.get(key) ?? null : null,
    };
  });
  const open = caseOrder(rows.filter((r) => OPEN_CASE_STATUSES.includes(r.status)));
  const closed = rows.filter((r) => !OPEN_CASE_STATUSES.includes(r.status)).sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));
  return {
    available: true,
    today,
    open,
    closed,
    settings,
    showOwners: Boolean(owners) && new Set([...(owners?.values() ?? [])].map((o) => o.userId)).size > 1,
    counts: {
      open: open.length,
      pinned: open.filter((r) => r.urgency === "pinned").length,
      noWindow: open.filter((r) => r.urgency === "no_window").length,
      reinstated90: closed.filter((r) => r.status === "reinstated").length,
      expired90: closed.filter((r) => r.status === "expired").length,
      declined90: closed.filter((r) => r.status === "declined_by_client" || r.status === "declined_by_carrier").length,
      advanceOpenCents: open.reduce((sum, r) => sum + (r.advanceCents ?? 0), 0),
      advanceUnknown: open.filter((r) => r.advanceCents === null).length,
    },
  };
}

export type CasePatch = {
  status?: CaseStatus;
  declineReason?: string | null;
  amountOwedCents?: number | null;
  monthsOwed?: number | null;
  requiresHealthQuestions?: boolean | null;
  requiresSignedForm?: boolean | null;
  requirementsNote?: string | null;
  carrierReference?: string | null;
  note?: string | null;
};

/** A person's step on a case: the call, what the carrier needs, or the answer. Never reinstated or expired. */
export async function updateCase(viewer: Viewer, id: string, patch: CasePatch) {
  const { data: c, error } = await db().from("reinstatement_case").select("id, status, carrier_id, policy_number").eq("tenant_id", viewer.tenantId).eq("id", id).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) throw new ReinstatementError(REINSTATEMENT_PENDING_MESSAGE, 503);
    throw new Error(error.message);
  }
  if (!c) throw new ReinstatementError("That case isn't here.", 404);
  if (viewer.role === "producer" || (viewer.scope ?? null) !== null) {
    const p = await db().from("policy_current").select("agent_user_id").eq("tenant_id", viewer.tenantId).eq("carrier_id", c.carrier_id).eq("policy_number", c.policy_number).maybeSingle();
    if (viewer.role === "producer" && p.data?.agent_user_id !== viewer.userId) throw new ReinstatementError("That case isn't in your book.", 404);
    if (!rowVisible(viewer.scope ?? null, p.data?.agent_user_id)) throw new ReinstatementError("That case isn't in your book.", 404);
  }
  // LA-5.8: a retention rep works the cases assigned to them (an escalated case is the writing agent's).
  if (viewer.role === "retention" && !ownsCard(viewer, (await ownerOf(viewer.tenantId, "reinstatement", c.carrier_id, c.policy_number)) ?? undefined)) {
    throw new ReinstatementError("That case is assigned to someone else.", 404);
  }
  if (!OPEN_CASE_STATUSES.includes(c.status)) throw new ReinstatementError("This case is closed.", 409);
  const now = new Date().toISOString();
  const out: Loose = { worked_by: viewer.userId };
  if (patch.status && patch.status !== c.status) {
    if (patch.status === "reinstated" || patch.status === "expired") throw new ReinstatementError("Only the carrier file says a policy is reinstated, and only the calendar says a window closed.", 409);
    if (!canMove(c.status, patch.status)) throw new ReinstatementError("That step isn't open for this case now.", 409);
    out.status = patch.status;
    if (patch.status === "contacted") out.contacted_at = now;
    if (patch.status === "client_agreed") out.agreed_at = now;
    if (patch.status === "submitted") out.submitted_at = now;
    if (patch.status === "declined_by_client" || patch.status === "declined_by_carrier") {
      if (!patch.declineReason || patch.declineReason.trim().length < 3) throw new ReinstatementError("Say why, in a few words.", 400);
      out.decline_reason = patch.declineReason.trim();
      out.resolved_at = now;
    }
  }
  if (patch.amountOwedCents !== undefined) out.amount_owed_cents = patch.amountOwedCents;
  if (patch.monthsOwed !== undefined) out.months_owed = patch.monthsOwed;
  if (patch.requiresHealthQuestions !== undefined) out.requires_health_questions = patch.requiresHealthQuestions;
  if (patch.requiresSignedForm !== undefined) out.requires_signed_form = patch.requiresSignedForm;
  if (patch.requirementsNote !== undefined) out.carrier_requirements_note = patch.requirementsNote?.trim() || null;
  if (patch.carrierReference !== undefined) out.carrier_reference = patch.carrierReference?.trim() || null;
  if (patch.note !== undefined) out.note = patch.note?.trim() || null;
  const update = await db().from("reinstatement_case").update(out).eq("tenant_id", viewer.tenantId).eq("id", id).eq("status", c.status).select("id");
  if (update.error) throw new Error(`Could not update the case: ${update.error.message}`);
  // Someone (or the next file) moved it meanwhile: say so rather than report a save that did not happen.
  if (!update.data?.length) throw new ReinstatementError("This case changed while you had it open. Reload it and try again.", 409);
  return { from: c.status as CaseStatus, to: (out.status ?? c.status) as CaseStatus };
}

/** Open cases whose window closes inside the pin threshold (for the pinned line on the save queue). */
export async function closingSoon(viewer: Viewer): Promise<number | null> {
  const [cases, settings] = await Promise.all([
    db().from("reinstatement_case").select("deadline, carrier_id, policy_number").eq("tenant_id", viewer.tenantId).in("status", [...OPEN_CASE_STATUSES]).not("deadline", "is", null).limit(1000),
    db().from("retention_settings").select("*").eq("tenant_id", viewer.tenantId).maybeSingle(),
  ]);
  // Before the migration, or on any read failure, the pinned line is simply not shown.
  if (cases.error) return null;
  const pin = settingsFromRow(settings.data).reinstatementPinDays;
  const today = await agencyToday(viewer.tenantId);
  let rows = (cases.data ?? []) as Loose[];
  if (viewer.role === "producer" && rows.length) {
    const mine = await inChunks([...new Set(rows.map((r) => r.policy_number))], (part) => db().from("policy_current").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId).eq("agent_user_id", viewer.userId).in("policy_number", part));
    const keys = new Set(mine.map(keyOf));
    rows = rows.filter((r) => keys.has(keyOf(r)));
  }
  if ((viewer.scope ?? null) !== null && rows.length) {
    const mine = await inChunks([...new Set(rows.map((r) => r.policy_number))], (part) => scopeQuery(db().from("policy_current").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId), "agent_user_id", viewer.scope ?? null).in("policy_number", part));
    const keys = new Set(mine.map(keyOf));
    rows = rows.filter((r) => keys.has(keyOf(r)));
  }
  if (viewer.role === "retention" && rows.length) {
    // LA-5.8: a rep's pinned line counts the cases assigned to them.
    const mine = await db().from("retention_assignment").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId).eq("queue_type", "reinstatement").eq("assigned_to_user_id", viewer.userId).is("closed_at", null).limit(5000);
    const keys = new Set(((mine.data ?? []) as Loose[]).map(keyOf));
    rows = rows.filter((r) => keys.has(keyOf(r)));
  }
  return rows.filter((r) => (daysRemaining(r.deadline, today) ?? Infinity) <= pin).length;
}
