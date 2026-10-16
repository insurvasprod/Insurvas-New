import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { PROVIDER_CLAIM_WINDOW_HOURS, claimWindowFor } from "@/lib/consent/claimWindow";

import { lookupComplianceEvents, phoneKey, RecordIndexError, type ComplianceEvent } from "./recordIndex";
import { gapsSection, GAP_CATEGORIES, GAP_KEYS, type BookGapLine, type GapItem, type GapRow } from "./evidenceGaps";
import { consentValidAt } from "./consentValidity";

/**
 * LA-6.3 (Notion sprint, Module 6 — Compliance) · the compliance evidence report: for one number,
 * one lead or one client — every compliance record we hold, and every gap.
 *
 * It reads the LA-6.1 index for the records and compliance_gaps (20261015120000) for the gaps, so
 * the report, the book-wide scan and the LA-6.7 dashboard all answer from the same place. Every
 * generation is logged (compliance_report_log): a report discloses a consumer's personal data.
 *
 * Who may run it is decided by the routes: owners and producers (the writing agent) — never setters,
 * assistants (who do the buffer work), bookkeepers or partner users.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const EVIDENCE_PENDING_MESSAGE = "The evidence report needs a database update (20261015100000–20261015120000).";

export type Viewer = { tenantId: string; userId: string; role: string };
export type EvidenceScope = { type: "phone"; phone: string } | { type: "lead"; leadId: string } | { type: "contact"; contactId: string };
export type EvidenceRange = { from?: string | null; to?: string | null };
export type EvidenceOutput = "screen" | "pdf" | "csv";

export type TimelineItem = {
  at: string;
  eventType: string;
  module: string;
  sourceTable: string;
  sourceId: string;
  sourceSubId: string | null;
  phoneDigits: string;
  summary: string;
  /** Extra facts from the source row: the agent, the disposition, the window, the certificate. */
  facts: string[];
};

export type ConsentItem = {
  artefactId: string;
  phoneDigits: string;
  provider: string;
  certificateId: string | null;
  certificateUrl: string | null;
  status: string;
  consentAt: string | null;
  capturedAt: string;
  claimedAt: string | null;
  sourceUrl: string | null;
  /** Retained (claimed), or still inside its claim window. */
  valid: boolean;
  validity: string;
};

export type LeadItem = { leadId: string; createdAt: string; partner: string | null; campaign: string | null; name: string | null };

export type EvidenceReport = {
  scope: EvidenceScope;
  scopeLabel: string;
  range: EvidenceRange;
  generatedAt: string;
  generatedBy: string;
  phones: string[];
  names: string[];
  gaps: GapItem[];
  undetermined: GapItem[];
  gapsChecked: number;
  consent: ConsentItem[];
  leads: LeadItem[];
  timeline: TimelineItem[];
};

export class EvidenceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "EvidenceError";
  }
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The claim windows LA-2.6 enforces, as compliance_gaps takes them. */
export const CLAIM_HOURS = JSON.stringify(PROVIDER_CLAIM_WINDOW_HOURS);

export const EVIDENCE_BUSY_MESSAGE = "The compliance records are busy right now. Try again in a minute.";

/**
 * A missing function is a pending migration; a database too busy to answer is not. PostgREST's
 * PGRST002 ("could not query the database for the schema cache") and a statement timeout both
 * mention neither a table nor a column, but the first matches isSchemaGap's "schema cache" phrase.
 */
function rpcFailure(error: { code?: string; message: string }): never {
  if (error.code === "PGRST002" || error.code === "57014") throw new EvidenceError(EVIDENCE_BUSY_MESSAGE, 503);
  if (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883") throw new EvidenceError(EVIDENCE_PENDING_MESSAGE, 503);
  throw new Error(error.message);
}

async function log(viewer: Viewer, input: { scopeType: "phone" | "lead" | "contact" | "date_range" | "book_scan"; scopeValue: string | null; range: EvidenceRange; output: EvidenceOutput; eventCount: number | null; gapCount: number | null }) {
  const { error } = await db().from("compliance_report_log").insert({
    tenant_id: viewer.tenantId,
    user_id: viewer.userId,
    scope_type: input.scopeType,
    scope_value: input.scopeValue,
    range_from: input.range.from ?? null,
    range_to: input.range.to ?? null,
    output: input.output,
    event_count: input.eventCount,
    gap_count: input.gapCount,
  });
  if (error) {
    if (isSchemaGap(error)) throw new EvidenceError(EVIDENCE_PENDING_MESSAGE, 503);
    // A report that cannot be logged is not served.
    throw new Error(`Could not record the report: ${error.message}`);
  }
}

/** Which gap checks the agency runs (LA-6.8). A check switched off reads as switched off — never as passed. */
async function enabledChecks(tenantId: string): Promise<Set<string>> {
  const { data } = await db().from("compliance_settings").select("report_gap_checks").eq("tenant_id", tenantId).maybeSingle();
  return new Set(Array.isArray(data?.report_gap_checks) ? (data.report_gap_checks as string[]) : GAP_KEYS);
}

/** Who may generate a report (LA-6.8): owner always; producer unless the owner said otherwise. */
export async function mayGenerateReports(tenantId: string, role: string): Promise<boolean> {
  const { data } = await db().from("compliance_settings").select("report_roles").eq("tenant_id", tenantId).maybeSingle();
  const roles = Array.isArray(data?.report_roles) ? (data.report_roles as string[]) : ["owner", "producer"];
  return roles.includes(role);
}

/** The leads behind a report's scope: for a number, every lead the index has ever keyed to it. */
async function leadsBehind(tenantId: string, scope: EvidenceScope): Promise<string[]> {
  if (scope.type === "lead") return isUuid(scope.leadId) ? [scope.leadId] : [];
  if (scope.type === "contact") {
    if (!isUuid(scope.contactId)) return [];
    const { data } = await db().from("agent_leads").select("id").eq("tenant_id", tenantId).eq("contact_id", scope.contactId).limit(500);
    return ((data ?? []) as Loose[]).map((l) => l.id as string);
  }
  let digits: string;
  try {
    digits = phoneKey(scope.phone);
  } catch {
    return [];
  }
  const { data, error } = await db().from("compliance_index").select("lead_id").eq("tenant_id", tenantId).eq("phone_digits", digits).not("lead_id", "is", null).limit(1000);
  if (error) rpcFailure(error);
  return [...new Set(((data ?? []) as Loose[]).map((r) => r.lead_id as string))];
}

/** Whether this user worked any of these leads: created it, owns or claimed its work item, or dialled it. */
async function workedAnyLead(tenantId: string, userId: string, leadIds: string[]): Promise<boolean> {
  for (let i = 0; i < leadIds.length; i += 200) {
    const part = leadIds.slice(i, i + 200);
    const [created, owned, claimed, dialled] = await Promise.all([
      db().from("agent_leads").select("id").eq("tenant_id", tenantId).eq("created_by", userId).in("id", part).limit(1),
      db().from("lead_queue").select("id").eq("tenant_id", tenantId).eq("owner_user_id", userId).in("lead_id", part).limit(1),
      db().from("lead_queue").select("id").eq("tenant_id", tenantId).eq("claimed_by", userId).in("lead_id", part).limit(1),
      db().from("tenant_call_attempts").select("id").eq("tenant_id", tenantId).eq("agent_id", userId).in("lead_id", part).limit(1),
    ]);
    if ([created, owned, claimed, dialled].some((r: Loose) => (r.data ?? []).length > 0)) return true;
  }
  return false;
}

/**
 * Who may see the evidence for this scope, wherever it is generated (the route, the page, a
 * complaint's attachment): the roles the agency allows (LA-6.8 report_roles), and — below the owner —
 * only for leads the person worked. A report discloses a consumer's whole contact history.
 */
export async function assertEvidenceAccess(viewer: Viewer, scope: EvidenceScope): Promise<void> {
  if (!(await mayGenerateReports(viewer.tenantId, viewer.role))) throw new EvidenceError("Your agency has not allowed your role to generate compliance reports.", 403);
  if (viewer.role === "owner") return;
  const leads = await leadsBehind(viewer.tenantId, scope);
  if (!leads.length || !(await workedAnyLead(viewer.tenantId, viewer.userId, leads))) {
    throw new EvidenceError("You can open the evidence report only for leads you worked. Ask the agency owner for anyone else's.", 403);
  }
}

async function gapRows(tenantId: string, phone: string | null, range: EvidenceRange): Promise<GapRow[]> {
  const [rows, enabled] = await Promise.all([rawGapRows(tenantId, phone, range), enabledChecks(tenantId)]);
  const off = GAP_KEYS.filter((k) => !enabled.has(k));
  return [
    ...rows.filter((r) => enabled.has(r.category)),
    ...off.map((category) => ({ category, phone_digits: phone, status: "undetermined" as const, calls: 0, first_at: null, last_at: null, detail: { reason: "Switched off in compliance settings." } })),
  ];
}

async function rawGapRows(tenantId: string, phone: string | null, range: EvidenceRange): Promise<GapRow[]> {
  const { data, error } = await db().rpc("compliance_gaps", { p_tenant_id: tenantId, p_phone_digits: phone, p_from: range.from ?? null, p_to: range.to ?? null, p_claim_hours: JSON.parse(CLAIM_HOURS) });
  if (error) {
    rpcFailure(error);
  }
  return ((data ?? []) as Loose[]).map((r) => ({ category: r.category, phone_digits: r.phone_digits ?? null, status: r.status, calls: Number(r.calls ?? 0), first_at: r.first_at ?? null, last_at: r.last_at ?? null, detail: r.detail ?? null }));
}

async function resolvePhones(viewer: Viewer, scope: EvidenceScope): Promise<{ phones: string[]; label: string }> {
  if (scope.type === "phone") {
    const digits = phoneKey(scope.phone);
    return { phones: [digits], label: `Phone ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` };
  }
  const id = scope.type === "lead" ? scope.leadId : scope.contactId;
  if (!isUuid(id)) throw new EvidenceError(scope.type === "lead" ? "Choose a lead." : "Choose a client.", 400);
  const events = await lookupComplianceEvents(viewer.tenantId, scope.type === "lead" ? { leadId: id } : { contactId: id });
  const phones = new Set(events.map((e) => e.phoneDigits));
  // The lead's own number, even before anything was recorded against it.
  const q = db().from("agent_leads").select("values").eq("tenant_id", viewer.tenantId);
  const { data } = await (scope.type === "lead" ? q.eq("id", id) : q.eq("contact_id", id)).limit(50);
  for (const l of (data ?? []) as Loose[]) {
    const v = l.values ?? {};
    for (const raw of [v.phone, v.phone_number, v.primary_phone]) {
      try {
        if (raw) phones.add(phoneKey(raw));
      } catch {
        /* not a usable number */
      }
    }
  }
  if (scope.type === "contact" && !phones.size && !(data ?? []).length) throw new EvidenceError("That client isn't here.", 404);
  if (scope.type === "lead" && !(data ?? []).length) throw new EvidenceError("That lead isn't here.", 404);
  return { phones: [...phones], label: scope.type === "lead" ? `Lead ${id.slice(0, 8)}` : `Client ${id.slice(0, 8)}` };
}

const MIN = (m: unknown) => (typeof m === "number" ? `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` : null);

async function enrich(tenantId: string, events: ComplianceEvent[]) {
  const ids = (table: string) => [...new Set(events.filter((e) => e.sourceTable === table).map((e) => e.sourceId))];
  const callIds = ids("tenant_call_attempts");
  const consentIds = ids("tenant_consent_artefacts");
  const leadIds = [...new Set(events.map((e) => e.leadId).filter((x): x is string => Boolean(x)))];
  const chunks = <T,>(list: string[], run: (part: string[]) => Promise<T[]>) => Promise.all(Array.from({ length: Math.ceil(list.length / 200) }, (_, i) => run(list.slice(i * 200, i * 200 + 200)))).then((parts) => parts.flat());

  const calls = await chunks(callIds, async (part) => {
    const withWindow = await db().from("tenant_call_attempts").select("id, agent_id, disposition, attempt_number, window_verdict, window_state, window_local_minute, window_start_minute, window_end_minute, window_reason").eq("tenant_id", tenantId).in("id", part);
    if (!withWindow.error) return (withWindow.data ?? []) as Loose[];
    const plain = await db().from("tenant_call_attempts").select("id, agent_id, disposition, attempt_number").eq("tenant_id", tenantId).in("id", part);
    return (plain.data ?? []) as Loose[];
  });
  const artefacts = await chunks(consentIds, async (part) => ((await db().from("tenant_consent_artefacts").select("id, lead_id, provider, certificate_id, certificate_url, capture_status, consent_timestamp, captured_at, claimed_at, source_url").eq("tenant_id", tenantId).in("id", part)).data ?? []) as Loose[]);
  const leads = await chunks(leadIds, async (part) => ((await db().from("agent_leads").select("id, created_at, partner_id, campaign_id, values").eq("tenant_id", tenantId).in("id", part)).data ?? []) as Loose[]);
  const userIds = [...new Set(calls.map((c) => c.agent_id).filter(Boolean))] as string[];
  const partnerIds = [...new Set(leads.map((l) => l.partner_id).filter(Boolean))] as string[];
  const campaignIds = [...new Set(leads.map((l) => l.campaign_id).filter(Boolean))] as string[];
  const [users, partners, campaigns] = await Promise.all([
    chunks(userIds, async (part) => ((await db().from("users").select("id, name").in("id", part)).data ?? []) as Loose[]),
    chunks(partnerIds, async (part) => ((await db().from("partners").select("id, name").eq("tenant_id", tenantId).in("id", part)).data ?? []) as Loose[]),
    chunks(campaignIds, async (part) => ((await db().from("tenant_campaigns").select("id, name").eq("tenant_id", tenantId).in("id", part)).data ?? []) as Loose[]),
  ]);
  return {
    calls: new Map(calls.map((c) => [c.id as string, c])),
    artefacts,
    leads,
    userName: new Map(users.map((u) => [u.id as string, (u.name as string | null) ?? "Unnamed user"])),
    partnerName: new Map(partners.map((p) => [p.id as string, p.name as string])),
    campaignName: new Map(campaigns.map((c) => [c.id as string, c.name as string])),
  };
}

function consentItem(a: Loose, phone: string, now: Date): ConsentItem {
  const window = claimWindowFor({ provider: a.provider, createdAt: a.consent_timestamp ?? a.captured_at }, now);
  // The one rule the transfer gate and the gap checks also apply (consentValidity.ts).
  const valid = consentValidAt(a, now);
  const validity =
    a.capture_status === "claimed" ? "Retained with the provider."
      : a.capture_status === "pending" ? (window.closesAt ? (window.expired ? `Not retained; the claim window closed ${window.closesAt.slice(0, 10)}.` : `Not retained yet; claim by ${window.closesAt.slice(0, 16).replace("T", " ")} UTC.`) : "Not retained; this provider has no claim window.")
        : a.capture_status === "expired" ? "Expired before it was retained." : `Capture ${a.capture_status}.`;
  return {
    artefactId: a.id, phoneDigits: phone, provider: window.providerLabel, certificateId: a.certificate_id ?? null, certificateUrl: a.certificate_url ?? null,
    status: a.capture_status, consentAt: a.consent_timestamp ?? null, capturedAt: a.captured_at, claimedAt: a.claimed_at ?? null, sourceUrl: a.source_url ?? null, valid, validity,
  };
}

/** The report for one number, lead or client. Logged. */
export async function buildEvidenceReport(viewer: Viewer, scope: EvidenceScope, range: EvidenceRange, output: EvidenceOutput): Promise<EvidenceReport> {
  await assertEvidenceAccess(viewer, scope);
  let resolved: { phones: string[]; label: string };
  try {
    resolved = await resolvePhones(viewer, scope);
  } catch (e) {
    if (e instanceof RecordIndexError) throw new EvidenceError(e.message, e.status);
    throw e;
  }
  const now = new Date();
  const perPhone = await Promise.all(resolved.phones.map(async (p) => {
    try {
      return { p, events: await lookupComplianceEvents(viewer.tenantId, { phoneDigits: p }, { from: range.from ?? undefined, to: range.to ?? undefined }), gaps: await gapRows(viewer.tenantId, p, range) };
    } catch (e) {
      if (e instanceof RecordIndexError) throw new EvidenceError(e.message === "Enter a valid US phone number" ? e.message : EVIDENCE_PENDING_MESSAGE, e.status);
      throw e;
    }
  }));
  const events = perPhone.flatMap((x) => x.events).sort((a, b) => a.eventAt.localeCompare(b.eventAt));
  // A check that applies to the whole tenant (not set up yet) reports once, not once per number.
  const seen = new Set<string>();
  const gapList = perPhone.flatMap((x) => x.gaps).filter((g) => {
    const key = `${g.category}|${g.status}|${g.phone_digits ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const section = gapsSection(gapList, now);
  const facts = await enrich(viewer.tenantId, events);

  const timeline: TimelineItem[] = events.map((e) => {
    const extra: string[] = [];
    if (e.sourceTable === "tenant_call_attempts" && e.eventType === "call_attempt") {
      const c = facts.calls.get(e.sourceId);
      if (c?.agent_id) extra.push(`Agent: ${facts.userName.get(c.agent_id) ?? "unknown"}`);
      if (c?.disposition) extra.push(`Disposition: ${String(c.disposition).replace(/_/g, " ")}`);
      if (c?.window_verdict === "inside") extra.push(`Inside legal hours (${c.window_state ?? "?"} ${MIN(c.window_local_minute) ?? "?"} local)`);
      else if (c?.window_verdict === "outside") extra.push(`OUTSIDE legal hours: ${MIN(c.window_local_minute) ?? "?"} local; ${c.window_state ?? "the state"} window ${MIN(c.window_start_minute) ?? "?"}–${MIN(c.window_end_minute) ?? "?"}`);
      else if (c?.window_verdict === "undetermined") extra.push(`Legal hours undetermined (${String(c.window_reason ?? "unknown").replace(/_/g, " ")})`);
    }
    return { at: e.eventAt, eventType: e.eventType, module: e.module, sourceTable: e.sourceTable, sourceId: e.sourceId, sourceSubId: e.sourceSubId, phoneDigits: e.phoneDigits, summary: e.summary, facts: extra };
  });

  const leadPhone = new Map(events.filter((e) => e.leadId).map((e) => [e.leadId as string, e.phoneDigits]));
  const consent = facts.artefacts.map((a) => consentItem(a, leadPhone.get(a.lead_id) ?? resolved.phones[0] ?? "", now)).sort((a, b) => (a.consentAt ?? a.capturedAt).localeCompare(b.consentAt ?? b.capturedAt));
  const leads: LeadItem[] = facts.leads
    .map((l) => {
      const v = l.values ?? {};
      const name = [v.first_name, v.last_name].filter((x: unknown) => typeof x === "string" && x.trim()).join(" ") || (typeof v.full_name === "string" ? v.full_name : null);
      return { leadId: l.id, createdAt: l.created_at, partner: l.partner_id ? facts.partnerName.get(l.partner_id) ?? "Unknown partner" : null, campaign: l.campaign_id ? facts.campaignName.get(l.campaign_id) ?? null : null, name: name || null };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const { data: me } = await db().from("users").select("name, email").eq("id", viewer.userId).maybeSingle();

  await log(viewer, {
    scopeType: scope.type,
    scopeValue: scope.type === "phone" ? resolved.phones[0] : scope.type === "lead" ? scope.leadId : scope.contactId,
    range, output, eventCount: events.length, gapCount: section.gapCount,
  });

  return {
    scope, scopeLabel: resolved.label, range, generatedAt: now.toISOString(), generatedBy: (me?.name as string | null) ?? (me?.email as string | null) ?? "Unknown user",
    phones: resolved.phones, names: [...new Set(leads.map((l) => l.name).filter((n): n is string => Boolean(n)))],
    gaps: section.gaps, undetermined: section.undetermined, gapsChecked: section.checked, consent, leads, timeline,
  };
}

export type BookScan = { generatedAt: string; range: EvidenceRange; lines: BookGapLine[]; numbersByCategory: Record<string, { phone: string; count: number; firstAt: string | null; lastAt: string | null }[]> };

/** The same gap checks across the whole book, as a summary (and the numbers behind each line). Logged. */
export async function bookGapScan(viewer: Viewer, range: EvidenceRange, opts: { log?: boolean; numbers?: boolean } = {}): Promise<BookScan> {
  // Summarised in the database (20261015180000): per-number rows for a whole book run past the
  // API's 1,000-row cap, and a truncated scan is worse than none.
  const claim = JSON.parse(CLAIM_HOURS);
  const [summary, enabled] = await Promise.all([
    db().rpc("compliance_gap_summary", { p_tenant_id: viewer.tenantId, p_from: range.from ?? null, p_to: range.to ?? null, p_claim_hours: claim }),
    enabledChecks(viewer.tenantId),
  ]);
  if (summary.error) {
    rpcFailure(summary.error);
  }
  const rows = (summary.data ?? []) as Loose[];
  const lines: BookGapLine[] = GAP_CATEGORIES.map((c) => {
    if (!enabled.has(c.key)) return { category: c.key, label: c.label, severity: c.severity, numbers: 0, count: 0, undeterminedNumbers: 0, undeterminedCount: 0, undeterminedReason: "Switched off in compliance settings." };
    const gap = rows.find((r) => r.category === c.key && r.status === "gap");
    const und = rows.find((r) => r.category === c.key && r.status === "undetermined");
    return {
      category: c.key, label: c.label, severity: c.severity,
      numbers: Number(gap?.numbers ?? 0), count: Number(gap?.calls ?? 0),
      undeterminedNumbers: Number(und?.numbers ?? 0), undeterminedCount: Number(und?.calls ?? 0), undeterminedReason: (und?.reason as string | null) ?? null,
    };
  });
  const numbersByCategory: BookScan["numbersByCategory"] = {};
  // The numbers behind each line are the whole book's: the owner's to see, not a producer's.
  if (opts.numbers !== false && viewer.role === "owner") {
    await Promise.all(lines.filter((l) => l.numbers > 0).map(async (l) => {
      const { data } = await db().rpc("compliance_gap_numbers", { p_tenant_id: viewer.tenantId, p_category: l.category, p_from: range.from ?? null, p_to: range.to ?? null, p_claim_hours: claim, p_limit: 300 });
      numbersByCategory[l.category] = ((data ?? []) as Loose[]).map((r) => ({ phone: r.phone_digits as string, count: Number(r.calls), firstAt: r.first_at ?? null, lastAt: r.last_at ?? null }));
    }));
  }
  if (opts.log !== false) await log(viewer, { scopeType: range.from || range.to ? "date_range" : "book_scan", scopeValue: null, range, output: "screen", eventCount: null, gapCount: lines.filter((l) => l.numbers > 0).length });
  return { generatedAt: new Date().toISOString(), range, lines, numbersByCategory };
}