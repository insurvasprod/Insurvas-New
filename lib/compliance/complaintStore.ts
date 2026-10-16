import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { loadBusinessIdentity } from "@/lib/agencyProfile/identity";
import { BUSINESS_FIELD_ANCHORS, missingFor, requirementMessage } from "@/lib/agencyProfile/requirements";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { buildEvidencePdf } from "./evidencePdf";
import { buildEvidenceReport, EvidenceError, mayGenerateReports } from "./evidenceReport";
import { lookupComplianceEvents } from "./recordIndex";
import { getUsPhone10Digits } from "./scrub";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CHANNELS,
  COMPLAINT_OUTCOMES,
  COMPLAINT_STATUSES,
  COMPLAINT_VIA,
  DEADLINE_CHANNELS,
  DEFAULT_THRESHOLDS,
  countdown,
  deadlineCoverage,
  sortComplaints,
  type Countdown,
  type Thresholds,
} from "./complaints";

/**
 * LA-6.4 (Notion sprint, Module 6 — Compliance) · complaints, server side.
 *
 * Opening one goes through open_complaint (20261015130000), which for unwanted calls puts the number
 * on the internal do-not-call list in the same transaction. The evidence report for the number
 * (LA-6.3) is then attached. We never write the response: the agent signs a regulator response, so
 * nothing here drafts one — there is no AI anywhere in this file.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const COMPLAINTS_PENDING_MESSAGE = "Complaints need a database update (20261015130000).";
export const COMPLAINT_BUCKET = "compliance-files";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "text/plain", "message/rfc822", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

export class ComplaintError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ComplaintError";
  }
}

export type Viewer = { tenantId: string; userId: string; role: string };

export type Attachment = { kind: "file" | "evidence_report"; name: string; path?: string; size?: number; contentType?: string; addedAt: string; addedBy?: string | null; generatedAt?: string; gaps?: number; records?: number; link?: string; frozen?: boolean };

/** What happened to the evidence report a new complaint carries: attached (a frozen copy), or why not. */
export type EvidenceAttachResult = { attached: true; path: string } | { attached: false; reason: string } | { attached: false; reason: null };

export type ComplaintRow = {
  id: string;
  channel: string;
  regulatorState: string | null;
  receivedAt: string;
  receivedVia: string;
  complainantName: string | null;
  phoneDigits: string | null;
  contactId: string | null;
  policyNumber: string | null;
  aboutAgent: { id: string; name: string } | null;
  partner: { id: string; name: string } | null;
  category: string;
  summary: string;
  attachments: Attachment[];
  responseDueAt: string | null;
  respondedAt: string | null;
  responseText: string | null;
  responseAttachments: Attachment[];
  checklist: Record<string, boolean>;
  status: string;
  outcome: string | null;
  owner: { id: string; name: string };
  dncAddedAt: string | null;
  resolvedAt: string | null;
  notes: string | null;
  countdown: Countdown;
};

const COLUMNS = "id, channel, regulator_state, received_at, received_via, complainant_name, phone_digits, contact_id, policy_number, about_agent_user_id, partner_id, category, summary, attachments_json, response_due_at, responded_at, response_text, response_attachments_json, checklist_json, status, outcome, owner_user_id, dnc_entry_id, dnc_added_at, resolved_at, notes";

function pending(error: { code?: string; message: string } | null) {
  if (error && (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883")) throw new ComplaintError(COMPLAINTS_PENDING_MESSAGE, 503);
  if (error) throw new Error(error.message);
}

export async function loadThresholds(tenantId: string): Promise<Thresholds> {
  const { data, error } = await db().from("compliance_settings").select("complaint_amber_days, complaint_red_days").eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return DEFAULT_THRESHOLDS;
  return { amberDays: Number(data.complaint_amber_days) || DEFAULT_THRESHOLDS.amberDays, redDays: Number(data.complaint_red_days) || DEFAULT_THRESHOLDS.redDays };
}

async function names(ids: string[], table: "users" | "partners", tenantId: string) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  let q = db().from(table).select("id, name").in("id", unique);
  if (table === "partners") q = q.eq("tenant_id", tenantId);
  const { data } = await q;
  return new Map(((data ?? []) as Loose[]).map((r) => [r.id as string, (r.name as string | null) ?? "Unnamed"]));
}

async function toRows(tenantId: string, raw: Loose[], now: Date): Promise<ComplaintRow[]> {
  const [thresholds, users, partners] = await Promise.all([
    loadThresholds(tenantId),
    names(raw.flatMap((r) => [r.owner_user_id, r.about_agent_user_id]), "users", tenantId),
    names(raw.map((r) => r.partner_id), "partners", tenantId),
  ]);
  return raw.map((r) => ({
    id: r.id,
    channel: r.channel,
    regulatorState: r.regulator_state ?? null,
    receivedAt: r.received_at,
    receivedVia: r.received_via,
    complainantName: r.complainant_name ?? null,
    phoneDigits: r.phone_digits ?? null,
    contactId: r.contact_id ?? null,
    policyNumber: r.policy_number ?? null,
    aboutAgent: r.about_agent_user_id ? { id: r.about_agent_user_id, name: users.get(r.about_agent_user_id) ?? "Unknown" } : null,
    partner: r.partner_id ? { id: r.partner_id, name: partners.get(r.partner_id) ?? "Unknown partner" } : null,
    category: r.category,
    summary: r.summary,
    attachments: Array.isArray(r.attachments_json) ? r.attachments_json : [],
    responseDueAt: r.response_due_at ?? null,
    respondedAt: r.responded_at ?? null,
    responseText: r.response_text ?? null,
    responseAttachments: Array.isArray(r.response_attachments_json) ? r.response_attachments_json : [],
    checklist: r.checklist_json && typeof r.checklist_json === "object" ? r.checklist_json : {},
    status: r.status,
    outcome: r.outcome ?? null,
    owner: { id: r.owner_user_id, name: users.get(r.owner_user_id) ?? "Unknown" },
    dncAddedAt: r.dnc_added_at ?? null,
    resolvedAt: r.resolved_at ?? null,
    notes: r.notes ?? null,
    countdown: countdown({ channel: r.channel, status: r.status, responseDueAt: r.response_due_at ?? null, respondedAt: r.responded_at ?? null }, now, thresholds),
  }));
}

/** Every complaint, days remaining first. `search` reads the summary, the response and the name — so last year's response is a precedent. */
export async function listComplaints(viewer: Viewer, opts: { search?: string; open?: boolean } = {}): Promise<ComplaintRow[]> {
  let q = db().from("complaint").select(COLUMNS).eq("tenant_id", viewer.tenantId);
  if (opts.open) q = q.neq("status", "resolved");
  const term = (opts.search ?? "").trim().replace(/[%,()]/g, " ").slice(0, 80);
  if (term) q = q.or(`summary.ilike.%${term}%,response_text.ilike.%${term}%,complainant_name.ilike.%${term}%,policy_number.ilike.%${term}%`);
  const { data, error } = await q.order("received_at", { ascending: false }).limit(1000);
  pending(error);
  return sortComplaints(await toRows(viewer.tenantId, (data ?? []) as Loose[], new Date()));
}

export async function getComplaint(viewer: Viewer, id: string): Promise<ComplaintRow> {
  const { data, error } = await db().from("complaint").select(COLUMNS).eq("tenant_id", viewer.tenantId).eq("id", id).maybeSingle();
  pending(error);
  if (!data) throw new ComplaintError("That complaint isn't here.", 404);
  return (await toRows(viewer.tenantId, [data], new Date()))[0];
}

/**
 * LA-8.3 · who answers a regulator: the business identity's legal name and NPN, and the agency's
 * licence in the complaint's state (LA-0.5). The response stays the agent's own words; this is the
 * block it is written under. When the legal name or NPN is missing, the prompt names it.
 */
export type Respondent = {
  legalName: string | null;
  npn: string | null;
  licence: { state: string; number: string } | null;
  /** "Add your NPN before preparing a DOI complaint response. …" — null when nothing is missing. */
  missing: string | null;
  /** Where the first missing field is fixed. */
  fixHref: string | null;
};

export async function respondentFor(tenantId: string, regulatorState: string | null): Promise<Respondent> {
  const [identity, licence] = await Promise.all([
    loadBusinessIdentity(tenantId),
    regulatorState
      ? db().from("licenses").select("license_number").eq("tenant_id", tenantId).eq("state", regulatorState).order("expires_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const missing = missingFor(identity, "doi_response");
  return {
    legalName: identity?.legalName ?? null,
    npn: identity?.npn ?? null,
    licence: regulatorState && licence.data?.license_number ? { state: regulatorState, number: licence.data.license_number as string } : null,
    missing: missing.length ? requirementMessage("doi_response", missing) : null,
    fixHref: missing.length ? `/app/settings#business-identity/${BUSINESS_FIELD_ANCHORS[missing[0]]}` : null,
  };
}

/** What a response typically needs: the items for every complaint, then the category's own. */
export async function checklistFor(category: string): Promise<{ key: string; item: string }[]> {
  const { data } = await db().from("compliance_complaint_checklist").select("category, position, item").in("category", ["any", category]).order("position");
  const rows = ((data ?? []) as Loose[]).sort((a, b) => (a.category === "any" ? 0 : 1) - (b.category === "any" ? 0 : 1) || a.position - b.position);
  return rows.map((r) => ({ key: `${r.category}:${r.position}`, item: r.item }));
}

export type OpenInput = {
  channel: string;
  regulatorState: string | null;
  receivedAt: string | null;
  receivedVia: string;
  complainantName: string | null;
  phone: string | null;
  policyNumber: string | null;
  aboutAgentUserId: string | null;
  partnerId: string | null;
  category: string;
  summary: string;
  ownerUserId: string | null;
  notes: string | null;
};

/** The client and the supplying partner, found from what we already hold about the number. */
async function attribution(tenantId: string, phoneDigits: string) {
  const events = await lookupComplianceEvents(tenantId, { phoneDigits }).catch(() => []);
  const contactId = [...events].reverse().find((e) => e.contactId)?.contactId ?? null;
  const leadIds = [...new Set(events.map((e) => e.leadId).filter((x): x is string => Boolean(x)))];
  let partnerId: string | null = null;
  if (leadIds.length) {
    const { data } = await db().from("agent_leads").select("partner_id, created_at").eq("tenant_id", tenantId).in("id", leadIds.slice(0, 200)).not("partner_id", "is", null).order("created_at", { ascending: false }).limit(1);
    partnerId = (data?.[0]?.partner_id as string | undefined) ?? null;
  }
  return { contactId, partnerId };
}

export async function openComplaint(viewer: Viewer, input: OpenInput): Promise<{ id: string; evidence: EvidenceAttachResult }> {
  if (!(COMPLAINT_CHANNELS as readonly string[]).includes(input.channel)) throw new ComplaintError("Choose where the complaint was made.", 400);
  if (!(COMPLAINT_VIA as readonly string[]).includes(input.receivedVia)) throw new ComplaintError("Choose how it arrived.", 400);
  if (!(COMPLAINT_CATEGORIES as readonly string[]).includes(input.category)) throw new ComplaintError("Choose what it is about.", 400);
  if (!input.summary.trim()) throw new ComplaintError("Say what the complaint is.", 400);
  if (input.channel === "doi" && !/^[A-Z]{2}$/.test(input.regulatorState ?? "")) throw new ComplaintError("Choose which state's insurance department.", 400);
  let phoneDigits: string | null = null;
  if (input.phone && input.phone.trim()) {
    try {
      phoneDigits = getUsPhone10Digits(input.phone);
    } catch (e) {
      throw new ComplaintError(e instanceof Error ? e.message : "Enter a valid US phone number", 400);
    }
  }
  if (input.category === "unwanted_calls" && !phoneDigits) throw new ComplaintError("An unwanted-calls complaint needs the number, so it can go on your do-not-call list.", 400);
  const found = phoneDigits ? await attribution(viewer.tenantId, phoneDigits) : { contactId: null, partnerId: null };

  const { data, error } = await db().rpc("open_complaint", {
    p_tenant_id: viewer.tenantId,
    p_actor: viewer.userId,
    p: {
      channel: input.channel,
      regulator_state: input.regulatorState,
      received_at: input.receivedAt,
      received_via: input.receivedVia,
      complainant_name: input.complainantName,
      phone: phoneDigits,
      contact_id: found.contactId,
      policy_number: input.policyNumber,
      about_agent_user_id: input.aboutAgentUserId,
      partner_id: input.partnerId ?? found.partnerId,
      category: input.category,
      summary: input.summary.trim(),
      owner_user_id: input.ownerUserId,
      notes: input.notes,
    },
  });
  pending(error);
  const id = data as string;

  const evidence = phoneDigits ? await attachEvidenceSnapshot(viewer, id, phoneDigits) : ({ attached: false, reason: null } as const);
  return { id, evidence };
}

/**
 * The evidence report for the number, attached on creation (LA-6.3; its generation is logged there)
 * as a FROZEN copy: the PDF as it stood when the complaint arrived, stored with the complaint's
 * files. A link that regenerates the report would show later records (or none, after a purge) —
 * evidence must say what we held then. Generating it goes through the report's own access rule
 * (report roles; a producer only for leads they worked), so a complaint is not a way round it.
 * A failure is returned, never swallowed: the complaint is open either way, and the caller says
 * the report is missing.
 */
async function attachEvidenceSnapshot(viewer: Viewer, id: string, phoneDigits: string): Promise<EvidenceAttachResult> {
  try {
    const report = await buildEvidenceReport(viewer, { type: "phone", phone: phoneDigits }, {}, "pdf");
    const bytes = await buildEvidencePdf(report);
    const path = `${viewer.tenantId}/complaints/${id}/evidence-report-${report.generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}.pdf`;
    const { error } = await db().storage.from(COMPLAINT_BUCKET).upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: false });
    if (error) throw new Error(`the copy could not be stored: ${error.message}`);
    const entry: Attachment = {
      kind: "evidence_report", name: `Evidence report as of ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC`, addedAt: report.generatedAt, addedBy: viewer.userId,
      generatedAt: report.generatedAt, gaps: report.gaps.length, records: report.timeline.length, path, size: bytes.byteLength, contentType: "application/pdf", frozen: true,
      link: `/api/app/compliance/complaints/${id}/attachments?path=${encodeURIComponent(path)}`,
    };
    await appendAttachment(viewer.tenantId, id, "attachments_json", entry);
    return { attached: true, path };
  } catch (e) {
    const reason = e instanceof EvidenceError || e instanceof ComplaintError ? e.message : `The evidence report could not be attached (${e instanceof Error ? e.message : "unknown error"}).`;
    console.error("[complaints] the evidence report could not be attached", e);
    return { attached: false, reason };
  }
}

async function appendAttachment(tenantId: string, id: string, column: "attachments_json" | "response_attachments_json", entry: Attachment) {
  const { data, error } = await db().from("complaint").select(column).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  pending(error);
  if (!data) throw new ComplaintError("That complaint isn't here.", 404);
  const list = Array.isArray(data[column]) ? data[column] : [];
  const { error: upd } = await db().from("complaint").update({ [column]: [...list, entry] }).eq("tenant_id", tenantId).eq("id", id);
  pending(upd);
}

export type ComplaintPatch = {
  status?: string;
  outcome?: string | null;
  ownerUserId?: string;
  responseText?: string | null;
  respondedAt?: string | null;
  notes?: string | null;
  checklist?: Record<string, boolean>;
  regulatorState?: string | null;
};

/** Move the workflow. What was received, and when, never changes (the database refuses it too). */
export async function updateComplaint(viewer: Viewer, id: string, patch: ComplaintPatch): Promise<ComplaintRow> {
  const current = await getComplaint(viewer, id);
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (!(COMPLAINT_STATUSES as readonly string[]).includes(patch.status)) throw new ComplaintError("Choose a status.", 400);
    update.status = patch.status;
    update.resolved_at = patch.status === "resolved" ? current.resolvedAt ?? new Date().toISOString() : null;
    if (patch.status === "responded" && !current.respondedAt && patch.respondedAt === undefined) update.responded_at = new Date().toISOString();
  }
  if (patch.outcome !== undefined) {
    if (patch.outcome !== null && !(COMPLAINT_OUTCOMES as readonly string[]).includes(patch.outcome)) throw new ComplaintError("Choose an outcome.", 400);
    update.outcome = patch.outcome;
  }
  if (patch.ownerUserId !== undefined) {
    const { data } = await db().from("tenant_users").select("user_id").eq("tenant_id", viewer.tenantId).eq("user_id", patch.ownerUserId).maybeSingle();
    if (!data) throw new ComplaintError("The owner must be someone in this agency.", 400);
    update.owner_user_id = patch.ownerUserId;
  }
  if (patch.responseText !== undefined) update.response_text = patch.responseText?.trim() ? patch.responseText.trim().slice(0, 20000) : null;
  if (patch.respondedAt !== undefined) update.responded_at = patch.respondedAt;
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() ? patch.notes.trim().slice(0, 4000) : null;
  if (patch.checklist !== undefined) update.checklist_json = Object.fromEntries(Object.entries(patch.checklist).filter(([k, v]) => /^[a-z_]+:\d+$/.test(k) && typeof v === "boolean").slice(0, 50));
  if (patch.regulatorState !== undefined && current.channel === "doi") {
    if (!/^[A-Z]{2}$/.test(patch.regulatorState ?? "")) throw new ComplaintError("Choose which state's insurance department.", 400);
    update.regulator_state = patch.regulatorState;
  }
  if (Object.keys(update).length) {
    const { error } = await db().from("complaint").update(update).eq("tenant_id", viewer.tenantId).eq("id", id);
    pending(error);
  }
  return getComplaint(viewer, id);
}

/**
 * Set the response days for this complaint's regulator (the prompt shown when none is configured),
 * and apply it to this complaint. The deadline is the regulator's for every later complaint too
 * (LA-6.8 lists and edits them all).
 */
export async function setRegulatorDeadline(viewer: Viewer, id: string, responseDays: number): Promise<ComplaintRow> {
  if (!Number.isInteger(responseDays) || responseDays < 1 || responseDays > 180) throw new ComplaintError("Response days must be a whole number from 1 to 180.", 400);
  const c = await getComplaint(viewer, id);
  if (!(DEADLINE_CHANNELS as readonly string[]).includes(c.channel)) throw new ComplaintError("Only a DOI or FTC complaint has a statutory deadline.", 400);
  const regulator = c.channel === "ftc" ? "FTC" : c.regulatorState;
  if (!regulator) throw new ComplaintError("Choose which state's insurance department first.", 400);
  const { error } = await db().from("compliance_complaint_deadline").upsert({ tenant_id: viewer.tenantId, regulator, response_days: responseDays, set_by: viewer.userId, set_at: new Date().toISOString() }, { onConflict: "tenant_id,regulator" });
  pending(error);
  if (!c.responseDueAt) {
    const due = new Date(Date.parse(c.receivedAt) + responseDays * 86_400_000).toISOString();
    const { error: upd } = await db().from("complaint").update({ response_due_at: due }).eq("tenant_id", viewer.tenantId).eq("id", id).is("response_due_at", null);
    pending(upd);
  }
  return getComplaint(viewer, id);
}

/** Store a letter, notice or the response sent back. */
export async function addAttachment(viewer: Viewer, id: string, side: "complaint" | "response", file: File): Promise<ComplaintRow> {
  if (!file.size) throw new ComplaintError("That file is empty.", 400);
  if (file.size > MAX_BYTES) throw new ComplaintError("Files up to 10 MB.", 400);
  if (!ALLOWED_TYPES.includes(file.type)) throw new ComplaintError("PDF, image, text, email or Word files only.", 400);
  await getComplaint(viewer, id);
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "file";
  const path = `${viewer.tenantId}/complaints/${id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await db().storage.from(COMPLAINT_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) throw new ComplaintError(/bucket/i.test(error.message) ? COMPLAINTS_PENDING_MESSAGE : `Could not store the file: ${error.message}`, /bucket/i.test(error.message) ? 503 : 500);
  await appendAttachment(viewer.tenantId, id, side === "response" ? "response_attachments_json" : "attachments_json", { kind: "file", name: file.name.slice(0, 200), path, size: file.size, contentType: file.type, addedAt: new Date().toISOString(), addedBy: viewer.userId });
  return getComplaint(viewer, id);
}

/** A 60-second link to one stored file of this complaint. */
export async function attachmentUrl(viewer: Viewer, id: string, path: string): Promise<string> {
  const c = await getComplaint(viewer, id);
  const file = [...c.attachments, ...c.responseAttachments].find((a) => a.path === path);
  if (!file || !path.startsWith(`${viewer.tenantId}/complaints/${id}/`)) throw new ComplaintError("That file isn't on this complaint.", 404);
  // A stored evidence report is a report: the agency's report roles apply to opening it too.
  if (file.kind === "evidence_report" && !(await mayGenerateReports(viewer.tenantId, viewer.role))) throw new ComplaintError("Your agency has not allowed your role to open compliance reports.", 403);
  const { data, error } = await db().storage.from(COMPLAINT_BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new ComplaintError("The file could not be opened.", 500);
  return data.signedUrl;
}

/** The regulators configured, and the coverage sentence over the agency's licensed states (LA-0.5). */
export async function deadlineSetup(tenantId: string) {
  const [deadlines, licenses] = await Promise.all([
    db().from("compliance_complaint_deadline").select("regulator, response_days, notes, set_at").eq("tenant_id", tenantId).order("regulator"),
    db().from("licenses").select("state").eq("tenant_id", tenantId),
  ]);
  const rows = ((deadlines.data ?? []) as Loose[]).map((d) => ({ regulator: d.regulator as string, responseDays: Number(d.response_days), notes: (d.notes as string | null) ?? null, setAt: d.set_at as string }));
  return { available: !deadlines.error, rows, coverage: deadlineCoverage(((licenses.data ?? []) as Loose[]).map((l) => l.state as string), rows.map((r) => r.regulator)) };
}

/** Complaints against each partner in a period, for partner quality (LA-1.18). */
export async function complaintsByPartner(tenantId: string, from: string, to: string, partnerId?: string): Promise<Map<string, number>> {
  let q = db().from("complaint").select("partner_id").eq("tenant_id", tenantId).not("partner_id", "is", null).gte("received_at", `${from}T00:00:00Z`).lte("received_at", `${to}T23:59:59.999Z`);
  if (partnerId) q = q.eq("partner_id", partnerId);
  const { data, error } = await q.limit(5000);
  const out = new Map<string, number>();
  if (error) return out;
  for (const r of (data ?? []) as Loose[]) out.set(r.partner_id, (out.get(r.partner_id) ?? 0) + 1);
  return out;
}
