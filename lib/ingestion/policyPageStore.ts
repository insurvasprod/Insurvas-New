import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { scopeQuery } from "@/lib/agency/visibility";

import { changeValue, fieldWord } from "./policyBook";
import type { Viewer } from "./policyBookStore";
import type { PolicyHistoryRow } from "./policyPage";

/**
 * Book of business, round 2 · the reads behind the policy page's tabs that loadPolicy (policyBookStore.ts)
 * does not already make: the History tab's every change, the Client tab's link and its history, the
 * Pipeline tab's card moves, the Commissions tab's findings and the Files tab. Each read is this one
 * policy's, tenant-filtered; each degrades to `available: false` when its table is not there yet.
 *
 * Carrier data is read-only here, as everywhere in the book.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const STAGE_HISTORY_PENDING_MESSAGE = "Card history needs a database update (20260925100000).";
export const LINKS_PENDING_MESSAGE = "Client links need a database update (20261008170000).";
export const FINDINGS_PENDING_MESSAGE = "Findings from carrier files need a database update (20261008250000).";

const fullName = (row: Loose) => [row?.first_name, row?.last_name].filter(Boolean).join(" ") || null;
const leadPersonName = (values: Loose) => {
  if (!values || typeof values !== "object") return null;
  const part = (key: string) => (typeof values[key] === "string" ? values[key].trim() : "");
  return [part("first_name"), part("last_name")].filter(Boolean).join(" ") || part("full_name") || part("name") || null;
};

async function userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (!unique.length) return new Map();
  const { data } = await db().from("users").select("id, name, email").in("id", unique);
  return new Map<string, string>((data ?? []).map((row: Loose) => [row.id, row.name || row.email]));
}

async function fileNames(tenantId: string, ids: Array<string | null | undefined>): Promise<Map<string, Loose>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (!unique.length) return new Map();
  const { data } = await db().from("file_registry").select("id, original_filename, file_date, file_type, received_at, status").eq("tenant_id", tenantId).in("id", unique.slice(0, 500));
  return new Map<string, Loose>((data ?? []).map((row: Loose) => [row.id, row]));
}

// ─── the keys every tab hangs from ──────────────────────────────────────────────────────────────

export type PolicyKeys = {
  applicationId: string | null; caseId: string | null; leadId: string | null; contactId: string | null; leadName: string | null;
  /** The current link's target and method (showsProvisional), or null when the policy is not linked. */
  link: { type: string | null; method: string | null } | null;
  /** The sale behind the policy (its application's case, else its Daily deal flow sale): where it came from and who sold it. */
  sale: { source: string | null; date: string | null; agentUserId: string | null; agentName: string | null } | null;
  /** Who the carrier's writing number maps to (carrier_agent_map, through policy_current.agent_user_id). */
  carrierAgent: { userId: string | null; name: string | null };
};

/**
 * The policy's application, case, lead and client, by the same visibility as loadPolicy: a producer only
 * for a policy credited to them, a narrowed agency session only over its producers. Null when the policy
 * is not in this viewer's book.
 */
export async function policyKeys(viewer: Viewer, carrierId: string, policyNumber: string): Promise<PolicyKeys | null> {
  let query = db().from("policy_current").select("application_id, contact_id, agent_user_id").eq("tenant_id", viewer.tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber);
  if (viewer.role === "producer") query = query.eq("agent_user_id", viewer.userId);
  const { data: row, error } = await scopeQuery(query, "agent_user_id", viewer.scope ?? null).maybeSingle();
  if (error || !row) return null;
  let leadId: string | null = null;
  let caseId: string | null = null;
  let sale: { source: string | null; date: string | null; agentUserId: string | null } | null = null;
  const { data: link } = await db().from("policy_match").select("matched_to_type, matched_to_id, method").eq("tenant_id", viewer.tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).is("superseded_by_id", null).maybeSingle();
  if (row.application_id) {
    const { data: app } = await db().from("tenant_applications").select("lead_id, case_id, submitted_at, created_at").eq("tenant_id", viewer.tenantId).eq("id", row.application_id).maybeSingle();
    leadId = app?.lead_id ?? null;
    caseId = app?.case_id ?? null;
    if (caseId) {
      // AG-1.4 credits the application to whoever opened its case: the same person here.
      const { data: c } = await db().from("tenant_application_cases").select("source, opened_by").eq("tenant_id", viewer.tenantId).eq("id", caseId).maybeSingle();
      if (c) sale = { source: c.source ?? null, date: app?.submitted_at ?? app?.created_at ?? null, agentUserId: c.opened_by ?? null };
    }
  }
  if (!leadId && link?.matched_to_type === "deal_flow" && link.matched_to_id) {
    // A policy linked to a Daily deal flow sale: the sale's lead, and who worked it.
    const { data: deal } = await db().from("deal_flow").select("lead_id, source, local_date, worked_by").eq("tenant_id", viewer.tenantId).eq("id", link.matched_to_id).maybeSingle();
    leadId = deal?.lead_id ?? null;
    if (deal) sale = { source: deal.source ?? null, date: deal.local_date ?? null, agentUserId: deal.worked_by ?? null };
  }
  let leadName: string | null = null;
  if (leadId) {
    const { data: lead } = await db().from("agent_leads").select("values").eq("tenant_id", viewer.tenantId).eq("id", leadId).maybeSingle();
    leadName = leadPersonName(lead?.values);
  }
  const names = await userNames([row.agent_user_id, sale?.agentUserId]);
  return {
    applicationId: row.application_id ?? null, caseId, leadId, contactId: row.contact_id ?? null, leadName,
    link: link ? { type: link.matched_to_type ?? null, method: link.method ?? null } : null,
    sale: sale ? { ...sale, agentName: sale.agentUserId ? names.get(sale.agentUserId) ?? null : null } : null,
    carrierAgent: { userId: row.agent_user_id ?? null, name: row.agent_user_id ? names.get(row.agent_user_id) ?? null : null },
  };
}

// ─── the tab counts ─────────────────────────────────────────────────────────────────────────────

/** The small counts on the tabs: changes, card moves and open findings. Head-only counts; a failed one is no count. */
export async function policyTabCounts(tenantId: string, carrierId: string, policyNumber: string, leadId: string | null): Promise<{ history: number | null; pipeline: number | null; findings: number | null }> {
  const head = { count: "exact" as const, head: true };
  const [history, pipeline, findings] = await Promise.all([
    db().from("policy_change").select("field_name", head).eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber),
    leadId ? db().from("tenant_lead_stage_events").select("id", head).eq("tenant_id", tenantId).eq("lead_id", leadId) : { count: null, error: null },
    db().from("commission_discrepancy").select("id", head).eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).in("status", ["open", "disputed"]),
  ]);
  const n = (read: Loose) => (read.error || read.count === null || read.count === undefined ? null : Number(read.count));
  return { history: n(history), pipeline: n(pipeline), findings: n(findings) };
}

// ─── History ────────────────────────────────────────────────────────────────────────────────────

/**
 * Every policy_change for this policy, newest first, each with the file and row that made it (the
 * policy's snapshot in that file), and the first sighting as the last row. carrier_status_raw is kept:
 * the History tab shows every field, not the timeline's summary.
 */
export async function loadPolicyHistory(tenantId: string, carrierId: string, policyNumber: string): Promise<{ available: boolean; rows: PolicyHistoryRow[]; truncated: boolean }> {
  const LIMIT = 2000;
  const [changes, events, snapshots] = await Promise.all([
    db().from("policy_change").select("field_name, old_value, new_value, to_snapshot_date, to_file_id, detected_at").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).order("to_snapshot_date", { ascending: false }).order("detected_at", { ascending: false }).limit(LIMIT),
    db().from("policy_event").select("event_type, snapshot_date, file_id").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).eq("event_type", "first_seen").limit(5),
    db().from("policy_snapshot").select("file_id, raw_row_id, snapshot_date").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).order("snapshot_date").limit(1000),
  ]);
  if (changes.error) {
    if (isSchemaGap(changes.error)) return { available: false, rows: [], truncated: false };
    throw new Error(`Could not load the policy's history: ${changes.error.message}`);
  }
  const snaps = (snapshots.data ?? []) as Loose[];
  const rawIds = snaps.map((s) => s.raw_row_id).filter(Boolean);
  const [files, rowNumbers] = await Promise.all([
    fileNames(tenantId, [...(changes.data ?? []).map((c: Loose) => c.to_file_id), ...(events.data ?? []).map((e: Loose) => e.file_id)]),
    rawIds.length ? db().from("raw_rows").select("id, row_number").eq("tenant_id", tenantId).in("id", rawIds.slice(0, 500)) : { data: [] },
  ]);
  const rowOf = new Map<string, number>(((rowNumbers.data ?? []) as Loose[]).map((r) => [r.id, r.row_number]));
  const source = (fileId: string | null) => {
    if (!fileId) return null;
    const snap = snaps.find((s) => s.file_id === fileId);
    return { fileId, fileName: (files.get(fileId)?.original_filename ?? null) as string | null, rowNumber: snap?.raw_row_id ? rowOf.get(snap.raw_row_id) ?? null : null };
  };
  const rows: PolicyHistoryRow[] = ((changes.data ?? []) as Loose[]).map((c) => ({
    date: c.to_snapshot_date,
    field: c.field_name,
    fieldLabel: c.field_name === "carrier_status_raw" ? "Carrier's status word" : capitalise(fieldWord(c.field_name)),
    from: c.old_value === null || c.old_value === "" ? null : changeValue(c.field_name, c.old_value),
    to: changeValue(c.field_name, c.new_value),
    source: source(c.to_file_id),
  }));
  const first = ((events.data ?? []) as Loose[]).sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)))[0];
  if (first) rows.push({ date: first.snapshot_date, field: "first_seen", fieldLabel: "In the file", from: null, to: "First seen", source: source(first.file_id) });
  return { available: true, rows, truncated: (changes.data ?? []).length >= LIMIT };
}

const capitalise = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

// ─── Client ─────────────────────────────────────────────────────────────────────────────────────

export type PolicyLinkEntry = { id: string; at: string; method: string; type: string; clientName: string | null; by: string | null; reason: string | null; current: boolean };
export type PolicyLink = {
  available: boolean;
  current: (PolicyLinkEntry & { confirmed: boolean; contactId: string | null; dob: string | null }) | null;
  /** Newest first: every link this policy has had, the current one included. */
  history: PolicyLinkEntry[];
  sale: { kind: "application" | "deal_flow"; date: string | null; agentName: string | null; caseId: string | null; status: string | null } | null;
  /** The number on the submitted application (its latest submission), when one was recorded. */
  submittedNumber: string | null;
};

export async function loadPolicyLink(tenantId: string, carrierId: string, policyNumber: string, keys: PolicyKeys | null): Promise<PolicyLink> {
  const [links, submission, application] = await Promise.all([
    db().from("policy_match").select("id, method, matched_to_type, matched_to_id, contact_id, reasoning, confirmed_at, created_by, created_at, superseded_by_id").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).order("created_at", { ascending: false }).limit(50),
    keys?.applicationId ? db().from("tenant_application_submissions").select("policy_number, submitted_at").eq("tenant_id", tenantId).eq("application_id", keys.applicationId).order("submitted_at", { ascending: false }).limit(1).maybeSingle() : { data: null },
    keys?.applicationId ? db().from("tenant_applications").select("created_at, submitted_at, created_by, status, outcome, case_id").eq("tenant_id", tenantId).eq("id", keys.applicationId).maybeSingle() : { data: null },
  ]);
  if (links.error) {
    if (isSchemaGap(links.error)) return { available: false, current: null, history: [], sale: null, submittedNumber: null };
    throw new Error(`Could not load the policy's client link: ${links.error.message}`);
  }
  const rows = (links.data ?? []) as Loose[];
  const currentRow = rows.find((row) => !row.superseded_by_id) ?? null;
  const dealId = currentRow?.matched_to_type === "deal_flow" ? currentRow.matched_to_id : null;
  const [contacts, deal] = await Promise.all([
    rows.some((r) => r.contact_id) ? db().from("contacts").select("id, first_name, last_name, dob, provisional").eq("tenant_id", tenantId).in("id", [...new Set(rows.map((r) => r.contact_id).filter(Boolean))]) : { data: [] },
    dealId ? db().from("deal_flow").select("local_date, worked_by").eq("tenant_id", tenantId).eq("id", dealId).maybeSingle() : { data: null },
  ]);
  const contact = new Map<string, Loose>(((contacts.data ?? []) as Loose[]).map((c) => [c.id, c]));
  const users = await userNames([...rows.map((r) => r.created_by), deal.data?.worked_by, application.data?.created_by]);
  const entry = (row: Loose): PolicyLinkEntry => ({
    id: row.id, at: row.created_at, method: row.method, type: row.matched_to_type,
    clientName: row.contact_id ? fullName(contact.get(row.contact_id)) : null,
    by: row.created_by ? users.get(row.created_by) ?? "A person" : "Insurvas",
    reason: row.reasoning ?? null, current: !row.superseded_by_id,
  });
  const sale: PolicyLink["sale"] = application.data
    ? { kind: "application", date: application.data.submitted_at ?? application.data.created_at ?? null, agentName: application.data.created_by ? users.get(application.data.created_by) ?? null : null, caseId: application.data.case_id ?? null, status: (application.data.outcome ?? application.data.status ?? null) as string | null }
    : deal.data ? { kind: "deal_flow", date: deal.data.local_date ?? null, agentName: deal.data.worked_by ? users.get(deal.data.worked_by) ?? null : null, caseId: null, status: null } : null;
  return {
    available: true,
    current: currentRow ? { ...entry(currentRow), confirmed: Boolean(currentRow.confirmed_at), contactId: currentRow.contact_id ?? null, dob: currentRow.contact_id ? contact.get(currentRow.contact_id)?.dob ?? null : null } : null,
    history: rows.map(entry),
    sale,
    submittedNumber: (submission.data?.policy_number ?? null) as string | null,
  };
}

// ─── Pipeline ───────────────────────────────────────────────────────────────────────────────────

export type CardMove = { id: string; at: string; from: string | null; to: string; pipeline: string | null; source: string; outcome: string | null; by: string | null };
export type PolicyPipeline = {
  available: boolean;
  card: { pipeline: string | null; stage: string | null; stageId: string | null } | null;
  /** Newest first. */
  moves: CardMove[];
  /**
   * PIPELINE RULES EXTENSION SPOT. The pipeline rules' lines for this policy: each rule evaluation that moved
   * the card (with the rule and its version), each forecast line ("Would move Issued → Past due") and each
   * skip with its reason. Empty here; the policy page fills it from lib/pipelineRules (loadPolicyRuleEvents),
   * and the Pipeline tab draws whatever is in it (components/app/book/policy/pipeline-tab.tsx).
   */
  ruleLines: Array<{ at: string; text: string; reason: string | null; rule: string | null; mode: "live" | "forecast" | "skipped" }>;
};

/** The card moves for this policy's lead (tenant_lead_stage_events), newest first, with stage names. */
export async function loadPolicyPipeline(tenantId: string, leadId: string | null): Promise<PolicyPipeline> {
  if (!leadId) return { available: true, card: null, moves: [], ruleLines: [] };
  const [events, lead] = await Promise.all([
    db().from("tenant_lead_stage_events").select("id, from_stage_id, to_stage_id, to_pipeline_id, disposition_key, source, actor_user_id, created_at").eq("tenant_id", tenantId).eq("lead_id", leadId).order("created_at", { ascending: false }).limit(200),
    db().from("agent_leads").select("pipeline_id, stage_id").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle(),
  ]);
  if (events.error) {
    if (isSchemaGap(events.error)) return { available: false, card: null, moves: [], ruleLines: [] };
    throw new Error(`Could not load the card's moves: ${events.error.message}`);
  }
  const rows = (events.data ?? []) as Loose[];
  const stageIds = [...new Set([...rows.flatMap((r) => [r.from_stage_id, r.to_stage_id]), lead.data?.stage_id].filter(Boolean))] as string[];
  const pipelineIds = [...new Set([...rows.map((r) => r.to_pipeline_id), lead.data?.pipeline_id].filter(Boolean))] as string[];
  const [stages, pipelines, users] = await Promise.all([
    stageIds.length ? db().from("tenant_pipeline_stages").select("id, name, tenant_pipelines!inner(tenant_id)").in("id", stageIds).eq("tenant_pipelines.tenant_id", tenantId) : { data: [] },
    pipelineIds.length ? db().from("tenant_pipelines").select("id, name").eq("tenant_id", tenantId).in("id", pipelineIds) : { data: [] },
    userNames(rows.map((r) => r.actor_user_id)),
  ]);
  const stage = new Map<string, string>(((stages.data ?? []) as Loose[]).map((s) => [s.id, s.name]));
  const pipeline = new Map<string, string>(((pipelines.data ?? []) as Loose[]).map((p) => [p.id, p.name]));
  return {
    available: true,
    card: lead.data ? { pipeline: lead.data.pipeline_id ? pipeline.get(lead.data.pipeline_id) ?? null : null, stage: lead.data.stage_id ? stage.get(lead.data.stage_id) ?? null : null, stageId: lead.data.stage_id ?? null } : null,
    moves: rows.map((r) => ({
      id: r.id, at: r.created_at,
      from: r.from_stage_id ? stage.get(r.from_stage_id) ?? "A stage no longer on the board" : null,
      to: stage.get(r.to_stage_id) ?? "A stage no longer on the board",
      pipeline: pipeline.get(r.to_pipeline_id) ?? null,
      source: r.source, outcome: r.disposition_key ? String(r.disposition_key).replaceAll("_", " ") : null,
      by: r.actor_user_id ? users.get(r.actor_user_id) ?? "A person" : null,
    })),
    ruleLines: [],
  };
}

// ─── Commissions: findings ──────────────────────────────────────────────────────────────────────

export type PolicyFinding = { id: string; type: string; severity: string; status: string; explanation: string | null; expectedCents: number | null; reportedCents: number | null; differenceCents: number | null; lastSeenAt: string | null };

export const FINDING_WORDS: Record<string, string> = {
  missing: "Commission missing", short_paid: "Paid short", over_paid: "Paid over", mis_rated: "Wrong rate",
  duplicate_chargeback: "Charged back twice", unexpected_chargeback: "Unexpected chargeback", missing_chargeback: "Chargeback expected, not taken",
  held_building_up: "Held money building up", debit_balance_growing: "Debit balance growing",
};

/** The discrepancy engine's open findings for this policy (LA-4.15), worst first. */
export async function loadPolicyFindings(tenantId: string, carrierId: string, policyNumber: string): Promise<{ available: boolean; items: PolicyFinding[] }> {
  const { data, error } = await db().from("commission_discrepancy").select("id, discrepancy_type, severity, status, explanation, expected_amount_cents, reported_amount_cents, difference_cents, last_seen_at").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).in("status", ["open", "disputed"]).limit(100);
  if (error) {
    if (isSchemaGap(error)) return { available: false, items: [] };
    throw new Error(`Could not load the policy's findings: ${error.message}`);
  }
  const rank: Record<string, number> = { action: 0, warning: 1, info: 2 };
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    available: true,
    items: ((data ?? []) as Loose[]).sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)).map((d) => ({ id: d.id, type: d.discrepancy_type, severity: d.severity, status: d.status, explanation: d.explanation, expectedCents: n(d.expected_amount_cents), reportedCents: n(d.reported_amount_cents), differenceCents: n(d.difference_cents), lastSeenAt: d.last_seen_at })),
  };
}

// ─── Files ──────────────────────────────────────────────────────────────────────────────────────

export type PolicyFile = { fileId: string; name: string; date: string | null; kind: "policies" | "commissions"; rowNumbers: number[]; status: string | null };

/** Every file that mentioned this policy — its policy rows (snapshots) and its commission lines — newest first. */
export async function loadPolicyFiles(tenantId: string, carrierId: string, policyNumber: string): Promise<PolicyFile[]> {
  const [snapshots, entries] = await Promise.all([
    db().from("policy_snapshot").select("file_id, raw_row_id, snapshot_date").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).limit(1000),
    db().from("commission_entry").select("file_id, row_number").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).limit(2000),
  ]);
  const snaps = (snapshots.error ? [] : snapshots.data ?? []) as Loose[];
  const lines = (entries.error ? [] : entries.data ?? []) as Loose[];
  const rawIds = snaps.map((s) => s.raw_row_id).filter(Boolean);
  const [files, rowNumbers] = await Promise.all([
    fileNames(tenantId, [...snaps.map((s) => s.file_id), ...lines.map((l) => l.file_id)]),
    rawIds.length ? db().from("raw_rows").select("id, row_number").eq("tenant_id", tenantId).in("id", rawIds.slice(0, 500)) : { data: [] },
  ]);
  const rowOf = new Map<string, number>(((rowNumbers.data ?? []) as Loose[]).map((r) => [r.id, r.row_number]));
  const out = new Map<string, PolicyFile>();
  const add = (fileId: string, kind: PolicyFile["kind"], rowNumber: number | null, fallbackDate: string | null) => {
    const file = files.get(fileId);
    const entry: PolicyFile = out.get(fileId) ?? { fileId, name: file?.original_filename ?? "A carrier file", date: file?.file_date ?? fallbackDate ?? (file?.received_at ? String(file.received_at).slice(0, 10) : null), kind: (file?.file_type === "commissions" ? "commissions" : file?.file_type === "policies" ? "policies" : kind) as PolicyFile["kind"], rowNumbers: [], status: file?.status ?? null };
    if (rowNumber !== null && !entry.rowNumbers.includes(rowNumber)) entry.rowNumbers.push(rowNumber);
    out.set(fileId, entry);
  };
  for (const s of snaps) add(s.file_id, "policies", s.raw_row_id ? rowOf.get(s.raw_row_id) ?? null : null, s.snapshot_date);
  for (const l of lines) add(l.file_id, "commissions", l.row_number ?? null, null);
  return [...out.values()].map((f) => ({ ...f, rowNumbers: f.rowNumbers.sort((a, b) => a - b) })).sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) || a.name.localeCompare(b.name));
}
