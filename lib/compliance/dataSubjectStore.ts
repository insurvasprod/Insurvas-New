import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { COMPLAINT_BUCKET } from "./complaintStore";
import { DEFAULT_HOLD_DAYS, PLATFORM_HOLD_FLOOR_DAYS, VERIFICATION_METHODS, purgeDate, verificationProblem, type Discovery, type VerificationMethod } from "./dataSubject";
import { PURGE_GROUPS } from "./dataSubjectMap";
import { getUsPhone10Digits } from "./scrub";

/**
 * LA-6.5 (Notion sprint, Module 6 — Compliance) · consumer deletion, server side.
 *
 * The request is logged by an owner or producer; verifying, rejecting, cancelling and performing it
 * are the tenant admin's (LA-6.8 can widen that). The purge runs group by group through
 * data_subject_purge_group (20261015140000), each in its own transaction, so a failure part-way
 * stops with the finished groups recorded and can be resumed: every group is idempotent.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const DELETION_PENDING_MESSAGE = "Deletion requests need a database update (20261015140000).";

export class DeletionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "DeletionError";
  }
}

export type Viewer = { tenantId: string; userId: string; role: string };

export type DeletionRequest = {
  id: string;
  phoneDigits: string | null;
  email: string | null;
  contactId: string | null;
  requesterName: string | null;
  /** The channel the request came from (caller ID / sender address): what identity is matched on. */
  requesterPhone: string | null;
  requesterEmail: string | null;
  receivedAt: string;
  receivedVia: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationMethod: string | null;
  verificationNote: string | null;
  scheduledPurgeAt: string | null;
  status: string;
  rejectionReason: string | null;
  results: Record<string, Record<string, { purged?: number; anonymised?: number; kept?: number; reason?: string; note?: string }>>;
  groupsDone: string[];
  completedAt: string | null;
  performedBy: string | null;
  createdAt: string;
};

const BASE_COLUMNS = "id, phone_digits, email, contact_id, requester_name, received_at, received_via, verified_at, verified_by, verification_method, verification_note, scheduled_purge_at, status, rejection_reason, results_json, groups_done, completed_at, performed_by, created_at";
// The requester's channel arrives with 20261015630000; until then the request reads without it.
const COLUMNS = `${BASE_COLUMNS}, requester_phone_digits, requester_email`;
const missingColumn = (error: { code?: string; message: string } | null) => Boolean(error && (error.code === "42703" || error.code === "PGRST204" || /requester_(phone_digits|email)/.test(error.message)));

/** A deletion request read with the channel columns, or without them before the migration. */
async function selectRequests(build: (columns: string) => Promise<{ data: Loose; error: { code?: string; message: string } | null }>) {
  const full = await build(COLUMNS);
  return missingColumn(full.error) ? build(BASE_COLUMNS) : full;
}

/** A requester's channel, as typed by whoever took the request: a US number or an email. */
export function parseContactChannel(value: string | null | undefined): { phone: string | null; email: string | null } {
  const v = value?.trim() ?? "";
  if (!v) return { phone: null, email: null };
  if (v.includes("@")) {
    const email = v.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DeletionError("Enter the email they wrote from.", 400);
    return { phone: null, email };
  }
  try {
    return { phone: getUsPhone10Digits(v), email: null };
  } catch {
    throw new DeletionError("Enter the number they contacted us from (a US number) or the email they wrote from.", 400);
  }
}

function check(error: { code?: string; message: string } | null) {
  if (error && (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883")) throw new DeletionError(DELETION_PENDING_MESSAGE, 503);
  if (error) throw new Error(error.message);
}

function toRow(r: Loose): DeletionRequest {
  return {
    id: r.id, phoneDigits: r.phone_digits ?? null, email: r.email ?? null, contactId: r.contact_id ?? null, requesterName: r.requester_name ?? null,
    requesterPhone: r.requester_phone_digits ?? null, requesterEmail: r.requester_email ?? null,
    receivedAt: r.received_at, receivedVia: r.received_via, verifiedAt: r.verified_at ?? null, verifiedBy: r.verified_by ?? null,
    verificationMethod: r.verification_method ?? null, verificationNote: r.verification_note ?? null, scheduledPurgeAt: r.scheduled_purge_at ?? null,
    status: r.status, rejectionReason: r.rejection_reason ?? null, results: r.results_json ?? {}, groupsDone: r.groups_done ?? [],
    completedAt: r.completed_at ?? null, performedBy: r.performed_by ?? null, createdAt: r.created_at,
  };
}

async function event(viewer: Viewer, requestId: string, action: string, detail: Record<string, unknown> = {}) {
  const { error } = await db().from("deletion_request_event").insert({ request_id: requestId, tenant_id: viewer.tenantId, actor_user_id: viewer.userId, action, detail });
  check(error);
}

export async function deletionSettings(tenantId: string): Promise<{ holdDays: number; methods: VerificationMethod[] }> {
  const { data } = await db().from("compliance_settings").select("deletion_hold_days, deletion_methods").eq("tenant_id", tenantId).maybeSingle();
  const methods = Array.isArray(data?.deletion_methods) ? (data.deletion_methods as string[]).filter((m): m is VerificationMethod => (VERIFICATION_METHODS as readonly string[]).includes(m)) : [...VERIFICATION_METHODS];
  return { holdDays: Math.max(PLATFORM_HOLD_FLOOR_DAYS, Number(data?.deletion_hold_days) || DEFAULT_HOLD_DAYS), methods: methods.length ? methods : [...VERIFICATION_METHODS] };
}

export async function listDeletionRequests(viewer: Viewer): Promise<DeletionRequest[]> {
  const { data, error } = await selectRequests((cols) => db().from("deletion_request").select(cols).eq("tenant_id", viewer.tenantId).order("received_at", { ascending: false }).limit(500));
  check(error);
  return ((data ?? []) as Loose[]).map(toRow);
}

export async function getDeletionRequest(viewer: Viewer, id: string): Promise<DeletionRequest> {
  const { data, error } = await selectRequests((cols) => db().from("deletion_request").select(cols).eq("tenant_id", viewer.tenantId).eq("id", id).maybeSingle());
  check(error);
  if (!data) throw new DeletionError("That request isn't here.", 404);
  return toRow(data);
}

export async function eventsFor(viewer: Viewer, id: string) {
  const { data } = await db().from("deletion_request_event").select("at, actor_user_id, action, detail").eq("tenant_id", viewer.tenantId).eq("request_id", id).order("at");
  return ((data ?? []) as Loose[]).map((e) => ({ at: e.at as string, actor: e.actor_user_id as string | null, action: e.action as string, detail: e.detail as Record<string, unknown> }));
}

export async function createDeletionRequest(viewer: Viewer, input: { phone: string | null; email: string | null; contactId: string | null; requesterName: string | null; receivedVia: string; receivedAt: string | null; requesterContact?: string | null }): Promise<string> {
  let phoneDigits: string | null = null;
  if (input.phone?.trim()) {
    try {
      phoneDigits = getUsPhone10Digits(input.phone);
    } catch (e) {
      throw new DeletionError(e instanceof Error ? e.message : "Enter a valid US phone number", 400);
    }
  }
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DeletionError("Enter a valid email.", 400);
  if (!phoneDigits && !email && !input.contactId) throw new DeletionError("Give the number, the email or the client the request is about.", 400);
  const channel = parseContactChannel(input.requesterContact);
  const row: Record<string, unknown> = {
    tenant_id: viewer.tenantId, phone_digits: phoneDigits, email, contact_id: input.contactId, requester_name: input.requesterName?.trim() || null,
    received_at: input.receivedAt ?? new Date().toISOString(), received_via: input.receivedVia, status: "verifying", created_by: viewer.userId,
  };
  if (channel.phone || channel.email) Object.assign(row, { requester_phone_digits: channel.phone, requester_email: channel.email });
  const { data, error } = await db().from("deletion_request").insert(row).select("id").single();
  check(error);
  await event(viewer, data.id, "received", { via: input.receivedVia });
  return data.id as string;
}

async function discover(viewer: Viewer, r: DeletionRequest): Promise<Discovery & Record<string, unknown>> {
  const { data, error } = await db().rpc("data_subject_discover", { p_tenant_id: viewer.tenantId, p_phone: r.phoneDigits, p_email: r.email, p_contact_id: r.contactId });
  check(error);
  return data as Discovery & Record<string, unknown>;
}

/** What we would find for this person, before deleting anything: counts only. */
export async function previewDeletion(viewer: Viewer, id: string) {
  const r = await getDeletionRequest(viewer, id);
  const found = await discover(viewer, r);
  const n = (k: string) => (Array.isArray(found[k]) ? (found[k] as unknown[]).length : 0);
  return { clients: n("contact_ids"), leads: n("lead_ids"), applications: n("application_ids"), policies: n("policies"), carrierRows: n("raw_row_ids"), numbers: n("phones"), emails: n("emails") };
}

/**
 * Verify identity. `contact` is the channel the requester used (caller ID, sender address) when it
 * was not recorded with the request; it is stored on the request, and the match is made against it —
 * never against the number or email they merely asked about.
 */
export async function verifyDeletionRequest(viewer: Viewer, id: string, method: VerificationMethod, note: string | null, contact: string | null = null) {
  const r = await getDeletionRequest(viewer, id);
  if (!["received", "verifying"].includes(r.status)) throw new DeletionError(`A ${r.status} request cannot be verified.`, 409);
  const settings = await deletionSettings(viewer.tenantId);
  if (!settings.methods.includes(method)) throw new DeletionError("That way of verifying is not accepted by this agency's settings.", 400);
  const channel = parseContactChannel(contact);
  const requesterPhone = channel.phone ?? r.requesterPhone;
  const requesterEmail = channel.email ?? r.requesterEmail;
  const problem = verificationProblem(method, { ...r, requesterPhone, requesterEmail }, await discover(viewer, r), note);
  if (problem) throw new DeletionError(problem, 422);
  const now = new Date();
  const due = purgeDate(now, settings.holdDays);
  const update: Record<string, unknown> = {
    status: "scheduled", verified_at: now.toISOString(), verified_by: viewer.userId, verification_method: method, verification_note: note?.trim() || null, scheduled_purge_at: due.toISOString(),
  };
  if (requesterPhone || requesterEmail) Object.assign(update, { requester_phone_digits: requesterPhone, requester_email: requesterEmail });
  const { error } = await db().from("deletion_request").update(update).eq("tenant_id", viewer.tenantId).eq("id", id);
  check(error);
  // The event records which channel matched (or that a written account was relied on) — not the value.
  await event(viewer, id, "verified", { method, hold_days: settings.holdDays, scheduled_purge_at: due.toISOString(), channel: requesterPhone ? "phone" : requesterEmail ? "email" : "none", written_evidence: Boolean(note?.trim()) });
}

export async function rejectDeletionRequest(viewer: Viewer, id: string, reason: string) {
  const r = await getDeletionRequest(viewer, id);
  if (!["received", "verifying"].includes(r.status)) throw new DeletionError(`A ${r.status} request cannot be rejected.`, 409);
  if (reason.trim().length < 10) throw new DeletionError("Say why, and what would satisfy you — the requester is told.", 400);
  const { error } = await db().from("deletion_request").update({ status: "rejected", rejection_reason: reason.trim() }).eq("tenant_id", viewer.tenantId).eq("id", id);
  check(error);
  await event(viewer, id, "rejected", { reason: reason.trim() });
}

export async function cancelDeletionRequest(viewer: Viewer, id: string, reason: string | null) {
  const r = await getDeletionRequest(viewer, id);
  if (!["received", "verifying", "verified", "scheduled"].includes(r.status) || r.groupsDone.length) throw new DeletionError("Only a request not yet started can be cancelled.", 409);
  const { error } = await db().from("deletion_request").update({ status: "cancelled" }).eq("tenant_id", viewer.tenantId).eq("id", id);
  check(error);
  await event(viewer, id, "cancelled", { reason: reason?.trim() || null });
}

/**
 * Perform the deletion: find the person once, then purge group by group, then delete the complaint
 * files, then close the request with only counts left on it. Resumable: a finished group is skipped.
 */
export async function performDeletion(viewer: Viewer, id: string): Promise<DeletionRequest> {
  return performDeletionAs(viewer, id, false);
}

/**
 * The purge, by a person (`viewer.userId`) or by the schedule once the hold is over (`automatic`:
 * no person performed it, so the actor is recorded as nobody and the events say "automatic").
 */
async function performDeletionAs(viewer: Viewer, id: string, automatic: boolean): Promise<DeletionRequest> {
  const actor = automatic ? null : viewer.userId;
  const ev = (action: string, detail: Record<string, unknown> = {}) => (automatic ? systemEvent(viewer.tenantId, id, action, { ...detail, automatic: true }) : event(viewer, id, action, detail));
  let r = await getDeletionRequest(viewer, id);
  if (r.status !== "scheduled") throw new DeletionError(`A ${r.status} request cannot be performed.`, 409);
  if (!r.scheduledPurgeAt || Date.parse(r.scheduledPurgeAt) > Date.now()) throw new DeletionError("The hold has not ended; it can still be cancelled.", 409);
  if (!r.groupsDone.length) {
    const subject = await discover(viewer, r);
    // The complaint files are named on the request before the complaint rows lose them.
    const { data: complaints } = await db().from("complaint").select("attachments_json, response_attachments_json").eq("tenant_id", viewer.tenantId)
      .or([(subject.phones as string[]).length ? `phone_digits.in.(${(subject.phones as string[]).join(",")})` : null, (subject.contact_ids as string[]).length ? `contact_id.in.(${(subject.contact_ids as string[]).join(",")})` : null].filter(Boolean).join(",") || "id.is.null");
    const files = ((complaints ?? []) as Loose[]).flatMap((c) => [...(c.attachments_json ?? []), ...(c.response_attachments_json ?? [])]).map((a: Loose) => a?.path).filter((p: unknown): p is string => typeof p === "string" && p.startsWith(`${viewer.tenantId}/`));
    const { error } = await db().from("deletion_request").update({ subject_json: { ...subject, files } }).eq("tenant_id", viewer.tenantId).eq("id", id);
    check(error);
    await ev("started", { clients: (subject.contact_ids as unknown[]).length, leads: (subject.lead_ids as unknown[]).length });
  }
  for (const group of PURGE_GROUPS) {
    const { error } = await db().rpc("data_subject_purge_group", { p_request_id: id, p_group: group, p_actor: actor });
    if (error) {
      await ev("failed", { group, error: error.message }).catch(() => undefined);
      check(error);
    }
  }
  r = await getDeletionRequest(viewer, id);
  const { data: subjectRow } = await db().from("deletion_request").select("subject_json").eq("id", id).maybeSingle();
  const files = Array.isArray(subjectRow?.subject_json?.files) ? (subjectRow.subject_json.files as string[]) : [];
  if (files.length) {
    const { error } = await db().storage.from(COMPLAINT_BUCKET).remove(files);
    if (error) {
      // Not silent: the request stays open (not completed) and says why, so it is retried.
      await ev("failed", { group: "files", error: error.message }).catch(() => undefined);
      throw new DeletionError(`The complaint files could not be removed (${error.message}); the request stays open and will be retried.`, 502);
    }
  }
  // Close it: only counts stay on the request. What identified the person goes.
  const counts = Object.fromEntries(["contact_ids", "lead_ids", "application_ids", "policies", "raw_row_ids", "phones", "emails"].map((k) => [k, Array.isArray(subjectRow?.subject_json?.[k]) ? subjectRow.subject_json[k].length : 0]));
  const { error } = await db().from("deletion_request").update({
    status: "completed", completed_at: new Date().toISOString(), performed_by: actor, subject_json: { counts, files_removed: files.length, automatic },
    // The number stays (it is the do-not-call entry); the email goes unless it is all the request has.
    email: r.phoneDigits || r.contactId ? null : r.email, requester_name: null, certificate_url: `/api/app/compliance/deletions/${id}/certificate`,
    // The channel it came from identified the person too: it goes with the rest.
    ...(r.requesterPhone || r.requesterEmail ? { requester_phone_digits: null, requester_email: null } : {}),
  }).eq("tenant_id", viewer.tenantId).eq("id", id);
  check(error);
  await ev("completed", { files_removed: files.length });
  return getDeletionRequest(viewer, id);
}

async function systemEvent(tenantId: string, requestId: string, action: string, detail: Record<string, unknown>) {
  const { error } = await db().from("deletion_request_event").insert({ request_id: requestId, tenant_id: tenantId, actor_user_id: null, action, detail });
  check(error);
}

/**
 * LA-6.5 · the scheduled perform: every verified request whose hold has ended is deleted without
 * waiting for someone to press the button (a legal clock runs). One request failing does not stop
 * the others; it stays open, its failure is in its events, and the next run retries it.
 */
export async function performDueDeletions(now = new Date(), limit = 25): Promise<{ performed: string[]; failed: { id: string; error: string }[] }> {
  const { data, error } = await db().from("deletion_request").select("id, tenant_id").eq("status", "scheduled").lte("scheduled_purge_at", now.toISOString()).order("scheduled_purge_at").limit(limit);
  check(error);
  const performed: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const row of (data ?? []) as Loose[]) {
    try {
      await performDeletionAs({ tenantId: row.tenant_id, userId: "", role: "system" }, row.id, true);
      performed.push(row.id);
    } catch (e) {
      failed.push({ id: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { performed, failed };
}
