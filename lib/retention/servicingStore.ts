import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { rowVisible, scopeQuery, type ProducerScope } from "@/lib/agency/visibility";

import type { ContactOutcome, PaymentMethod } from "./constants";
import { mapLimit, READ_CONCURRENCY } from "./batch";
import { assertQueueCard, logSaveAttempt, SaveQueueError } from "./queueStore";
import { computeRadar } from "./radarStore";
import { fieldChanges, OPEN_STATUSES, ServicingRuleError, canStep, WAITING_STATUSES, type CarrierMethod, type FieldChange, type Origin, type RequestInput, type RequestStatus, type RequestType } from "./servicing";

/**
 * LA-5.4 (Notion sprint) · servicing requests, server side. A person records what they asked the
 * carrier for and what the carrier told them; verify_servicing_requests (the database) decides from
 * the next carrier file whether it happened. After a verification the radar rescores those policies,
 * and the score should visibly drop — that drop is what LA-5.9 measures.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const CHUNK = 200;

export const SERVICING_PENDING_MESSAGE = "Servicing requests need a database update (20261014200000).";

export class ServicingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ServicingError";
  }
}

/**
 * AG-0.5 · `scope` is the session's producer scope (scopeFor). With one, a request is opened, stepped or
 * listed only on a policy credited to a visible producer (policy_current.agent_user_id), and the "verified in
 * the last 30 days" count is over those. Absent or null = unchanged.
 */
export type Viewer = { tenantId: string; userId: string; role: string; scope?: ProducerScope };

export type Guide = { method: CarrierMethod | null; whereToDoIt: string | null; whatTheyNeed: string | null; clientMustAuthorise: boolean | null; formRef: string | null; notes: string | null };

export type ServicingRow = {
  id: string;
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  clientName: string | null;
  phone: string | null;
  type: RequestType;
  origin: Origin;
  changes: FieldChange[];
  targetDraftReason: string | null;
  status: RequestStatus;
  carrierMethod: CarrierMethod | null;
  carrierReference: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  expectedEffectiveDate: string | null;
  verifiedAt: string | null;
  verifiedSnapshotDate: string | null;
  failureReason: string | null;
  checkedSnapshotDate: string | null;
  unprovable: string[];
  requestedBy: string | null;
  createdAt: string;
  note: string | null;
};

const ROW_COLUMNS = "id, carrier_id, policy_number, contact_id, request_type, origin, field_changes_json, target_draft_reason, status, carrier_method, carrier_reference, submitted_at, carrier_confirmed_at, expected_effective_date, verified_at, verified_snapshot_date, failure_reason, checked_snapshot_date, unprovable_fields, requested_by, created_at, note";

/** The policy as this viewer may see it (a producer: only their own), or a 404. */
async function policyFor(viewer: Viewer, carrierId: string, policyNumber: string) {
  const { data, error } = await db().from("policy_current").select("carrier_id, policy_number, contact_id, agency_id, agent_user_id, payment_method, status_normalized, application_id").eq("tenant_id", viewer.tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).maybeSingle();
  if (error) throw new Error(`Could not read the policy: ${error.message}`);
  if (!data || (viewer.role === "producer" && data.agent_user_id !== viewer.userId) || !rowVisible(viewer.scope ?? null, data.agent_user_id)) throw new ServicingError("That policy isn't in your book.", 404);
  return data as Loose;
}

async function guidesFor(carrierId: string): Promise<Partial<Record<RequestType, Guide>>> {
  const { data, error } = await db().from("carrier_servicing_guide").select("request_type, method, where_to_do_it, what_they_need, client_must_authorise, form_ref, notes").eq("carrier_id", carrierId);
  if (error) {
    if (isSchemaGap(error)) return {};
    throw new Error(error.message);
  }
  return Object.fromEntries(((data ?? []) as Loose[]).map((g) => [g.request_type, { method: g.method, whereToDoIt: g.where_to_do_it, whatTheyNeed: g.what_they_need, clientMustAuthorise: g.client_must_authorise, formRef: g.form_ref, notes: g.notes }]));
}

export type Prefill = {
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  clientName: string | null;
  currentDraftDay: number | null;
  recommendedDraftDay: number | null;
  recommendedReason: string | null;
  paymentMethod: PaymentMethod | null;
  guides: Partial<Record<RequestType, Guide>>;
  open: Array<{ id: string; type: RequestType; status: RequestStatus }>;
};

/** What a new request starts from: the draft day the radar knows, LA-3.9's recommended day and its reason, the carrier's instructions. */
export async function loadPrefill(viewer: Viewer, carrierId: string, policyNumber: string): Promise<Prefill> {
  const p = await policyFor(viewer, carrierId, policyNumber);
  const [signals, contact, carrier, guides, open] = await Promise.all([
    db().from("policy_risk_signals").select("draft_day, recommended_draft_day, recommended_draft_reason").eq("tenant_id", viewer.tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).maybeSingle(),
    p.contact_id ? db().from("contacts").select("first_name, last_name").eq("tenant_id", viewer.tenantId).eq("id", p.contact_id).maybeSingle() : { data: null },
    db().from("carriers").select("name").eq("id", carrierId).maybeSingle(),
    guidesFor(carrierId),
    db().from("servicing_request").select("id, request_type, status").eq("tenant_id", viewer.tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).in("status", [...OPEN_STATUSES]),
  ]);
  if (open.error && isSchemaGap(open.error)) throw new ServicingError(SERVICING_PENDING_MESSAGE, 503);
  const s = signals.data as Loose;
  return {
    carrierId, policyNumber, carrierName: (carrier.data as Loose)?.name ?? "Carrier not known",
    clientName: contact.data ? [contact.data.first_name, contact.data.last_name].filter(Boolean).join(" ") || null : null,
    currentDraftDay: s?.draft_day ?? null, recommendedDraftDay: s?.recommended_draft_day ?? null, recommendedReason: s?.recommended_draft_reason ?? null,
    paymentMethod: p.payment_method ?? null, guides,
    open: ((open.data ?? []) as Loose[]).map((o) => ({ id: o.id, type: o.request_type, status: o.status })),
  };
}

export type SendDetails = { method: CarrierMethod; formRef: string | null; reference: string | null; expectedEffectiveDate: string | null };

/**
 * Open a request. From the save queue (LA-5.3) the call is logged as a worked card first and the
 * request is linked back to it. Sent now, or kept as a draft to send later.
 */
export async function createRequest(viewer: Viewer, input: {
  carrierId: string;
  policyNumber: string;
  origin: Origin;
  change: RequestInput;
  send: SendDetails | null;
  note: string | null;
  fromQueue: { outcome: ContactOutcome } | null;
}): Promise<{ id: string }> {
  const p = await policyFor(viewer, input.carrierId, input.policyNumber);
  const prefill = await loadPrefill(viewer, input.carrierId, input.policyNumber);
  // The "from" values are the server's own reading, never the browser's.
  const change: RequestInput =
    input.change.type === "draft_date_change" ? { ...input.change, currentDraftDay: prefill.currentDraftDay }
    : input.change.type === "payment_method_change" ? { ...input.change, currentMethod: p.payment_method ?? null }
    : input.change;
  if (change.type === "bill_to_draft_conversion" && p.payment_method && p.payment_method !== "direct_bill") throw new ServicingError("This policy isn't paid by mailed bill.", 409);
  let changes: FieldChange[];
  try {
    changes = fieldChanges(change);
  } catch (error) {
    if (error instanceof ServicingRuleError) throw new ServicingError(error.message, 400);
    throw error;
  }
  // From the save queue, the card must still be one the queue works (not past due, not on the Lapse
  // risk list) — checked before the request exists, so a refusal leaves nothing behind.
  if (input.fromQueue) {
    try {
      await assertQueueCard(viewer, input.carrierId, input.policyNumber);
    } catch (error) {
      if (error instanceof SaveQueueError) throw new ServicingError(error.message, error.status);
      throw error;
    }
  }
  const already = prefill.open.find((o) => o.type === change.type);
  if (already) throw new ServicingError("There is already an open request of this kind for this policy. Finish or cancel it first.", 409);

  const target = change.type === "draft_date_change" ? change.targetDraftDay : change.type === "bill_to_draft_conversion" ? change.targetDraftDay : null;
  const usesRecommended = target !== null && target === prefill.recommendedDraftDay;
  const now = new Date().toISOString();
  const { data, error } = await db().from("servicing_request").insert({
    tenant_id: viewer.tenantId, agency_id: p.agency_id ?? null, carrier_id: input.carrierId, policy_number: input.policyNumber, contact_id: p.contact_id ?? null,
    request_type: change.type, origin: input.origin, save_attempt_id: null,
    field_changes_json: changes, target_draft_day: target, target_draft_reason: usesRecommended ? prefill.recommendedReason : null,
    carrier_method: input.send?.method ?? null, carrier_form_ref: input.send?.formRef?.trim() || null, carrier_reference: input.send?.reference?.trim() || null,
    status: input.send ? "submitted" : "draft", submitted_at: input.send ? now : null, expected_effective_date: input.send?.expectedEffectiveDate ?? null,
    requested_by: viewer.userId, note: input.note?.trim() || null,
  }).select("id").single();
  if (error) {
    if (isSchemaGap(error)) throw new ServicingError(SERVICING_PENDING_MESSAGE, 503);
    if (error.code === "23505") throw new ServicingError("There is already an open request of this kind for this policy.", 409);
    throw new Error(`Could not open the request: ${error.message}`);
  }
  // From the save queue, the worked call is logged after the request exists and points at it, so a
  // request that failed to open never leaves a call record behind (save_attempt is append-only). If
  // the call cannot be logged, the request is cancelled rather than left without its call.
  if (input.fromQueue) {
    const action = change.type === "draft_date_change" ? "move_draft_date" : change.type === "bill_to_draft_conversion" ? "convert_to_draft" : "confirm_account";
    try {
      await logSaveAttempt(viewer, { carrierId: input.carrierId, policyNumber: input.policyNumber, outcome: input.fromQueue.outcome, actionTaken: action, note: input.note, servicingRequestId: data.id });
    } catch (error) {
      // cancelled_at too: the servicing_request_cancelled check refuses a cancel without it.
      const undo = await db().from("servicing_request").update({ status: "cancelled", cancelled_at: new Date().toISOString(), note: "Cancelled: the call could not be logged." }).eq("tenant_id", viewer.tenantId).eq("id", data.id);
      if (undo.error) console.error("[servicing] the request could not be cancelled after the call failed to log", undo.error);
      throw error;
    }
  }
  // LA-5.5: from the paper-bill campaign, the client's "yes" is logged with the request it opened.
  // It counts as converted only when the file verifies that request.
  if (input.origin === "campaign" && change.type === "bill_to_draft_conversion") {
    const agreed = await db().from("conversion_attempt").insert({ tenant_id: viewer.tenantId, carrier_id: input.carrierId, policy_number: input.policyNumber, outcome: "converted", servicing_request_id: data.id, attempted_by: viewer.userId, note: input.note?.trim() || null });
    if (agreed.error) console.error("[servicing] the campaign call could not be logged", agreed.error);
  }
  return { id: data.id };
}

/** A step a person takes: sent, the carrier is on it, the carrier says done, or cancelled. */
export async function stepRequest(viewer: Viewer, id: string, to: RequestStatus, details: { send?: SendDetails; reference?: string | null; confirmedOn?: string | null; note?: string | null }) {
  const { data: row, error } = await db().from("servicing_request").select("id, status, carrier_id, policy_number, note").eq("tenant_id", viewer.tenantId).eq("id", id).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) throw new ServicingError(SERVICING_PENDING_MESSAGE, 503);
    throw new Error(error.message);
  }
  if (!row) throw new ServicingError("That request isn't here.", 404);
  await policyFor(viewer, row.carrier_id, row.policy_number);
  if (!canStep(row.status, to)) throw new ServicingError(to === "verified_in_file" || to === "failed" ? "Only the carrier file decides that." : "That step isn't open for this request now.", 409);
  const now = new Date().toISOString();
  const patch: Loose = { status: to };
  if (to === "submitted") {
    if (!details.send) throw new ServicingError("Say how it was sent.", 400);
    Object.assign(patch, { submitted_at: now, carrier_method: details.send.method, carrier_form_ref: details.send.formRef?.trim() || null, carrier_reference: details.send.reference?.trim() || null, expected_effective_date: details.send.expectedEffectiveDate });
  }
  if (to === "confirmed_by_carrier") {
    Object.assign(patch, { carrier_confirmed_at: details.confirmedOn ? `${details.confirmedOn}T12:00:00Z` : now });
    if (details.reference?.trim()) patch.carrier_reference = details.reference.trim();
  }
  if (to === "awaiting_carrier" && details.reference?.trim()) patch.carrier_reference = details.reference.trim();
  if (to === "cancelled") {
    patch.cancelled_at = now;
    if (details.note?.trim()) patch.note = [row.note, `Cancelled: ${details.note.trim()}`].filter(Boolean).join("\n").slice(0, 2000);
  }
  const update = await db().from("servicing_request").update(patch).eq("tenant_id", viewer.tenantId).eq("id", id).eq("status", row.status);
  if (update.error) throw new Error(`Could not update the request: ${update.error.message}`);
}

export type ServicingList = {
  available: true;
  rows: ServicingRow[];
  /** Carriers this agency holds policies with, for a new request. */
  carriers: Array<{ id: string; name: string }>;
  /** Proven by a carrier file in the last 30 days. */
  verifiedLast30: number;
};

/** Every request this viewer may see, newest first, after checking the open ones against the latest files. */
export async function loadServicing(viewer: Viewer): Promise<ServicingList | { available: false }> {
  try {
    await runServicingVerification(viewer.tenantId);
  } catch (error) {
    console.error("[servicing] verification could not run", error);
  }
  const { data, error } = await db().from("servicing_request").select(ROW_COLUMNS).eq("tenant_id", viewer.tenantId).order("created_at", { ascending: false }).limit(1000);
  if (error) {
    if (isSchemaGap(error)) return { available: false };
    throw new Error(error.message);
  }
  let rows = (data ?? []) as Loose[];
  // Chunks of policy numbers / ids: independent reads, a few at a time.
  const chunksOf = (values: string[]) => Array.from({ length: Math.ceil(values.length / CHUNK) }, (_, n) => values.slice(n * CHUNK, n * CHUNK + CHUNK));
  if (viewer.role === "producer") {
    const numbers = [...new Set(rows.map((r) => r.policy_number))];
    const mine = new Set<string>();
    await mapLimit(chunksOf(numbers), READ_CONCURRENCY, async (chunk) => {
      const part = await db().from("policy_current").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId).eq("agent_user_id", viewer.userId).in("policy_number", chunk);
      for (const p of (part.data ?? []) as Loose[]) mine.add(`${p.carrier_id}|${p.policy_number}`);
    });
    rows = rows.filter((r) => mine.has(`${r.carrier_id}|${r.policy_number}`));
  }
  if ((viewer.scope ?? null) !== null) {
    const numbers = [...new Set(rows.map((r) => r.policy_number))];
    const visible = new Set<string>();
    await mapLimit(chunksOf(numbers), READ_CONCURRENCY, async (chunk) => {
      const part = await scopeQuery(db().from("policy_current").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId), "agent_user_id", viewer.scope ?? null).in("policy_number", chunk);
      for (const p of (part.data ?? []) as Loose[]) visible.add(`${p.carrier_id}|${p.policy_number}`);
    });
    rows = rows.filter((r) => visible.has(`${r.carrier_id}|${r.policy_number}`));
  }
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[];
  const userIds = [...new Set(rows.map((r) => r.requested_by).filter(Boolean))] as string[];
  const [contactParts, users, carriers] = await Promise.all([
    mapLimit(chunksOf(contactIds), READ_CONCURRENCY, async (chunk) => ((await db().from("contacts").select("id, first_name, last_name, primary_phone").eq("tenant_id", viewer.tenantId).in("id", chunk)).data ?? []) as Loose[]),
    userIds.length ? db().from("users").select("id, name, email").in("id", userIds) : { data: [] },
    db().from("carriers").select("id, name"),
  ]);
  const contacts: Loose[] = contactParts.flat();
  const contactOf = new Map<string, Loose>(contacts.map((c) => [c.id, c]));
  const userName = new Map<string, string>(((users.data ?? []) as Loose[]).map((u) => [u.id, u.name || u.email]));
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  // One small read per carrier (PostgREST returns at most 1,000 rows, so a sample of the book could miss one).
  const heldIds = new Set<string>();
  await Promise.all(((carriers.data ?? []) as Loose[]).map(async (c) => {
    const one = await db().from("policy_current").select("carrier_id").eq("tenant_id", viewer.tenantId).eq("carrier_id", c.id).limit(1);
    if ((one.data ?? []).length) heldIds.add(c.id);
  }));
  return {
    verifiedLast30: rows.filter((r) => r.status === "verified_in_file" && r.verified_at && Date.parse(r.verified_at) >= Date.now() - 30 * 86_400_000).length,
    available: true,
    carriers: [...heldIds].map((id) => ({ id, name: carrierName.get(id) ?? "Carrier not known" })).sort((a, b) => a.name.localeCompare(b.name)),
    rows: rows.map((r) => {
      const c = r.contact_id ? contactOf.get(r.contact_id) : null;
      return {
        id: r.id, carrierId: r.carrier_id, carrierName: carrierName.get(r.carrier_id) ?? "Carrier not known", policyNumber: r.policy_number,
        clientName: c ? [c.first_name, c.last_name].filter(Boolean).join(" ") || null : null, phone: c?.primary_phone ?? null,
        type: r.request_type, origin: r.origin, changes: r.field_changes_json ?? [], targetDraftReason: r.target_draft_reason, status: r.status,
        carrierMethod: r.carrier_method, carrierReference: r.carrier_reference, submittedAt: r.submitted_at, confirmedAt: r.carrier_confirmed_at,
        expectedEffectiveDate: r.expected_effective_date, verifiedAt: r.verified_at, verifiedSnapshotDate: r.verified_snapshot_date,
        failureReason: r.failure_reason, checkedSnapshotDate: r.checked_snapshot_date, unprovable: r.unprovable_fields ?? [],
        requestedBy: r.requested_by ? userName.get(r.requested_by) ?? "Someone no longer here" : null, createdAt: r.created_at, note: r.note,
      } satisfies ServicingRow;
    }),
  };
}

/**
 * Ask the database to check every open request against the latest carrier files, then rescore the
 * policies whose change was proven. Idempotent: a request is decided once.
 */
export async function runServicingVerification(tenantId: string, carrierId?: string) {
  const { data, error } = await db().rpc("verify_servicing_requests", { p_tenant_id: tenantId, p_carrier_id: carrierId ?? null });
  if (error) {
    if (isSchemaGap(error) || error.code === "PGRST202") return null;
    throw new Error(`Could not check the servicing requests: ${error.message}`);
  }
  const result = data as { verified: number; failed: number; waiting: number; unprovable: number; verified_policies: Array<{ carrier_id: string; policy_number: string }> };
  const byCarrier = new Map<string, string[]>();
  for (const v of result.verified_policies ?? []) byCarrier.set(v.carrier_id, [...(byCarrier.get(v.carrier_id) ?? []), v.policy_number]);
  for (const [carrier, numbers] of byCarrier) {
    try {
      await computeRadar(tenantId, { carrierId: carrier, policyNumbers: numbers });
    } catch (e) {
      console.error("[servicing] the radar could not rescore a verified policy", e);
    }
  }
  return result;
}

/** Open requests per policy (for the save queue's cards) and the latest failure not yet followed by a new request. */
export async function requestsByPolicy(tenantId: string, keys: Set<string>) {
  const numbers = [...new Set([...keys].map((k) => k.slice(k.indexOf("|") + 1)))];
  const rows: Loose[] = [];
  // The chunks are read a few at a time, then checked in chunk order (the first failing chunk decides, as before).
  const starts = Array.from({ length: Math.ceil(numbers.length / CHUNK) }, (_, n) => n * CHUNK);
  const parts = await mapLimit(starts, READ_CONCURRENCY, async (i) => await db().from("servicing_request").select("id, carrier_id, policy_number, request_type, status, failure_reason, failed_at, created_at").eq("tenant_id", tenantId).in("policy_number", numbers.slice(i, i + CHUNK)).order("created_at", { ascending: false }));
  for (const part of parts as Loose[]) {
    if (part.error) {
      if (isSchemaGap(part.error)) return new Map<string, { open: Array<{ type: RequestType; status: RequestStatus }>; failed: { id: string; reason: string; at: string | null } | null }>();
      throw part.error;
    }
    rows.push(...(part.data ?? []));
  }
  const out = new Map<string, { open: Array<{ type: RequestType; status: RequestStatus }>; failed: { id: string; reason: string; at: string | null } | null }>();
  for (const r of rows) {
    const key = `${r.carrier_id}|${r.policy_number}`;
    if (!keys.has(key)) continue;
    const entry = out.get(key) ?? { open: [], failed: null };
    const seenNewer = out.has(key);
    if ((OPEN_STATUSES as readonly string[]).includes(r.status)) entry.open.push({ type: r.request_type, status: r.status });
    // A failure counts only while nothing newer was opened for the policy after it.
    if (r.status === "failed" && !seenNewer && !entry.failed) entry.failed = { id: r.id, reason: r.failure_reason, at: r.failed_at ?? null };
    out.set(key, entry);
  }
  return out;
}

export const isWaiting = (status: RequestStatus) => WAITING_STATUSES.includes(status);

// ─── staff: the per-carrier instructions ───────────────────────────────────────────────────────

export async function loadGuides() {
  const [carriers, rows] = await Promise.all([
    db().from("carriers").select("id, name").eq("is_active", true).order("name"),
    db().from("carrier_servicing_guide").select("carrier_id, request_type, method, where_to_do_it, what_they_need, client_must_authorise, form_ref, notes, updated_at"),
  ]);
  if (rows.error) {
    if (isSchemaGap(rows.error)) return { available: false as const, carriers: [] };
    throw new Error(rows.error.message);
  }
  const by = new Map<string, Loose[]>();
  for (const r of (rows.data ?? []) as Loose[]) by.set(r.carrier_id, [...(by.get(r.carrier_id) ?? []), r]);
  return {
    available: true as const,
    carriers: ((carriers.data ?? []) as Loose[]).map((c) => ({
      carrierId: c.id as string,
      carrierName: c.name as string,
      guides: Object.fromEntries((by.get(c.id) ?? []).map((g) => [g.request_type, { method: g.method, whereToDoIt: g.where_to_do_it, whatTheyNeed: g.what_they_need, clientMustAuthorise: g.client_must_authorise, formRef: g.form_ref, notes: g.notes } as Guide])) as Partial<Record<RequestType, Guide>>,
    })),
  };
}

/** Staff: one carrier's instructions for one kind of change. Empty clears it. */
export async function saveGuide(adminId: string, carrierId: string, type: RequestType, guide: Guide): Promise<"saved" | "cleared"> {
  const values = {
    method: guide.method, where_to_do_it: guide.whereToDoIt?.trim() || null, what_they_need: guide.whatTheyNeed?.trim() || null,
    client_must_authorise: guide.clientMustAuthorise, form_ref: guide.formRef?.trim() || null, notes: guide.notes?.trim() || null,
  };
  if (!values.method && !values.where_to_do_it && !values.what_they_need && !values.form_ref && !values.notes && values.client_must_authorise === null) {
    const { error } = await db().from("carrier_servicing_guide").delete().eq("carrier_id", carrierId).eq("request_type", type);
    if (error) throw new Error(error.message);
    return "cleared";
  }
  const { error } = await db().from("carrier_servicing_guide").upsert({ carrier_id: carrierId, request_type: type, ...values, updated_by_admin: adminId, updated_at: new Date().toISOString() }, { onConflict: "carrier_id,request_type" });
  if (error) {
    if (isSchemaGap(error)) throw new ServicingError(SERVICING_PENDING_MESSAGE, 503);
    throw new Error(error.message);
  }
  return "saved";
}
