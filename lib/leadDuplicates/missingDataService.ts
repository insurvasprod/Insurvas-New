import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getAgentTemplate, updateAgentLead, type AgentTemplate } from "@/lib/agentTemplates/service";
import { LeadPhoneScreeningError } from "@/lib/compliance/phoneEdit";
import { leadDisplayName } from "./types";
import {
  MISSING_COLUMNS, MISSING_DOWNLOAD_LIMIT, MISSING_SAVE_LIMIT, missingOrFilter, normalizeMissingValue, valueUnder,
  type MissingColumn, type MissingCounts, type MissingDataPage, type MissingDataRow, type MissingEdits, type MissingFilter, type MissingSaveResult,
} from "./missingData";

/**
 * Clean › Missing data (board LirK2). The read is tenant-scoped and paged along a tenant-leading
 * index: (tenant_id, created_at desc, id desc), or (tenant_id, campaign_id, created_at desc) with a
 * campaign picked. An order by id alone walks every tenant's leads (Lead lists, 2026-10-05).
 *
 * The write never touches `values` itself: each lead goes through updateAgentLead, the lead edit,
 * with its own stage, so the lead form's checks apply and a new phone number is screened
 * (lib/compliance/phoneEdit.ts) and refused when it is listed, invalid or cannot be screened.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb path filters are not in the generated types
const loose = () => getSupabaseServiceClient() as any;

type LeadRow = { id: string; values: Record<string, unknown> | null; campaign_id: string | null; tenant_template_id: string | null; stage_id?: string | null };

const STATEMENT_TIMEOUT = "57014";

/** The key your lead form stores a column under, or null when the form has no such field. */
function formKey(template: AgentTemplate | null, column: MissingColumn): string | null {
  if (!template) return null;
  const fields = new Set(template.template.fields.map((field) => field.field_key));
  const formFields = template.template.form_definition?.sections.flatMap((section) => section.fields.map((item) => item.field_key)) ?? [];
  const onForm = formFields.length ? new Set(formFields) : fields;
  const keys = MISSING_COLUMNS.find((item) => item.key === column)?.keys ?? [];
  return keys.find((key) => fields.has(key) && onForm.has(key)) ?? null;
}

async function templateOf(tenantId: string, userId: string): Promise<AgentTemplate | null> {
  try { return await getAgentTemplate(tenantId, userId); } catch { return null; }
}

function rowOf(lead: LeadRow, names: Map<string, string>, template: AgentTemplate | null): MissingDataRow {
  const values = lead.values ?? {};
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) if (typeof value === "string" && value.trim()) strings[key] = value.trim();
  const of = (column: MissingColumn) => valueUnder(values, MISSING_COLUMNS.find((item) => item.key === column)!.keys);
  return {
    id: lead.id,
    name: leadDisplayName(strings),
    campaignId: lead.campaign_id,
    campaign: lead.campaign_id ? names.get(lead.campaign_id) ?? null : null,
    phone: of("phone"), state: of("state"), dob: of("dob"), address: of("address"),
    editable: Boolean(template && lead.tenant_template_id === template.tenant_template_id),
  };
}

async function campaignsOf(tenantId: string) {
  const result = await loose().from("tenant_campaigns").select("id, name").eq("tenant_id", tenantId).order("name").limit(500);
  return (result.error ? [] : result.data ?? []) as Array<{ id: string; name: string }>;
}

function leadQuery(tenantId: string, filter: MissingFilter, campaignId: string | null, count: boolean) {
  let query = loose().from("agent_leads")
    .select("id, values, campaign_id, tenant_template_id", count ? { count: "exact" } : undefined)
    .eq("tenant_id", tenantId)
    // A consumer deletion keeps the row with its values wiped: nothing to fix there.
    .is("values->>_erased", null)
    .or(missingOrFilter(filter));
  if (campaignId) query = query.eq("campaign_id", campaignId).order("campaign_id");
  return query.order("created_at", { ascending: false }).order("id", { ascending: false });
}

export async function listMissingData(tenantId: string, userId: string, options: { filter: MissingFilter; campaignId: string | null; page: number; pageSize: number }): Promise<MissingDataPage> {
  const pageSize = Math.min(100, Math.max(5, Math.floor(options.pageSize) || 25));
  const page = Math.max(0, Math.floor(options.page) || 0);
  const from = page * pageSize;
  const [template, campaigns] = await Promise.all([templateOf(tenantId, userId), campaignsOf(tenantId)]);
  let result = await leadQuery(tenantId, options.filter, options.campaignId, true).range(from, from + pageSize - 1);
  // The count reads every one of the tenant's leads; when that cannot finish in time the page still shows.
  if (result.error?.code === STATEMENT_TIMEOUT) result = await leadQuery(tenantId, options.filter, options.campaignId, false).range(from, from + pageSize - 1);
  if (result.error) throw new Error(`Could not load leads with missing data: ${result.error.message}`);
  const names = new Map(campaigns.map((item) => [item.id, item.name]));
  return {
    rows: ((result.data ?? []) as LeadRow[]).map((lead) => rowOf(lead, names, template)),
    total: typeof result.count === "number" ? result.count : null,
    page, pageSize, campaigns,
    editable: Object.fromEntries(MISSING_COLUMNS.map((column) => [column.key, formKey(template, column.key) !== null])) as Record<MissingColumn, boolean>,
  };
}

/** How long one missing-field count may take before the page goes on without it. */
const COUNT_BUDGET_MS = 2500;

/**
 * Clean's "next up" line and the Missing filter's counts: how many leads miss each field. Four head
 * counts (no rows), tenant-scoped, run side by side; each one that errors, hits the statement timeout or
 * runs past COUNT_BUDGET_MS is null, so a big tenant gets the page without that count instead of a wait.
 */
export async function countMissingData(tenantId: string): Promise<MissingCounts> {
  const one = async (column: MissingColumn): Promise<number | null> => {
    try {
      const result = await loose().from("agent_leads")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("values->>_erased", null)
        .or(missingOrFilter(column))
        .abortSignal(AbortSignal.timeout(COUNT_BUDGET_MS));
      return !result.error && typeof result.count === "number" ? result.count : null;
    } catch { return null; }
  };
  const [phone, state, dob, address] = await Promise.all(MISSING_COLUMNS.map((column) => one(column.key)));
  return { phone, state, dob, address };
}

/** Every filtered row, for the download (up to MISSING_DOWNLOAD_LIMIT), a page of 1,000 at a time. */
export async function allMissingData(tenantId: string, userId: string, filter: MissingFilter, campaignId: string | null): Promise<MissingDataRow[]> {
  const [template, campaigns] = await Promise.all([templateOf(tenantId, userId), campaignsOf(tenantId)]);
  const names = new Map(campaigns.map((item) => [item.id, item.name]));
  const rows: MissingDataRow[] = [];
  for (let from = 0; from < MISSING_DOWNLOAD_LIMIT; from += 1000) {
    const result = await leadQuery(tenantId, filter, campaignId, false).range(from, Math.min(from + 999, MISSING_DOWNLOAD_LIMIT - 1));
    if (result.error) throw new Error(`Could not read leads with missing data: ${result.error.message}`);
    const page = (result.data ?? []) as LeadRow[];
    rows.push(...page.map((lead) => rowOf(lead, names, template)));
    if (page.length < 1000) break;
  }
  return rows;
}

/**
 * Saves the held edits, one lead at a time through the lead edit. A lead that fails (screening, the
 * lead form's checks, a value it already has) is reported and the rest still save.
 */
export async function saveMissingData(tenantId: string, userId: string, edits: MissingEdits): Promise<MissingSaveResult> {
  const ids = Object.keys(edits).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) throw new Error("Nothing to save");
  if (ids.length > MISSING_SAVE_LIMIT) throw new Error(`Save at most ${MISSING_SAVE_LIMIT} leads at a time`);
  const template = await getAgentTemplate(tenantId, userId);
  const leads = new Map<string, LeadRow>();
  for (let at = 0; at < ids.length; at += 200) {
    const read = await loose().from("agent_leads").select("id, values, campaign_id, tenant_template_id, stage_id").eq("tenant_id", tenantId).in("id", ids.slice(at, at + 200));
    if (read.error) throw new Error(`Could not read the leads: ${read.error.message}`);
    for (const lead of (read.data ?? []) as LeadRow[]) leads.set(lead.id, lead);
  }
  const result: MissingSaveResult = { saved: [], failed: [] };
  for (const leadId of ids) {
    const lead = leads.get(leadId);
    const fail = (error: string) => result.failed.push({ leadId, error });
    if (!lead) { fail("This lead is no longer here"); continue; }
    if (lead.values && "_erased" in lead.values) { fail("This lead was erased"); continue; }
    if (lead.tenant_template_id !== template.tenant_template_id) { fail("This lead was made on another lead form; open it to fix it"); continue; }
    // The edit keeps the lead where it is: without a stage it would be placed on the default one.
    if (!lead.stage_id) { fail("This lead has no stage; open it to fix it"); continue; }
    const values: Record<string, unknown> = { ...(lead.values ?? {}) };
    let problem: string | null = null;
    let changed = 0;
    for (const [column, raw] of Object.entries(edits[leadId] ?? {}) as Array<[MissingColumn, string]>) {
      const meta = MISSING_COLUMNS.find((item) => item.key === column);
      if (!meta || typeof raw !== "string") { problem = "Unknown column"; break; }
      const checked = normalizeMissingValue(column, raw);
      if ("error" in checked) { problem = `${meta.label}: ${checked.error}`; break; }
      // Only what is missing is filled here; a value the lead has is changed on the lead itself. A
      // fixed file carries the values the lead already had: the same value back is not a change.
      const existing = valueUnder(lead.values, meta.keys);
      if (existing) {
        const before = normalizeMissingValue(column, existing);
        if ("value" in before && before.value === checked.value) continue;
        problem = `It already has a ${meta.label.toLowerCase()}; change it on the lead`;
        break;
      }
      const key = formKey(template, column);
      if (!key) { problem = `Your lead form has no ${meta.label.toLowerCase()} field`; break; }
      values[key] = checked.value;
      changed += 1;
    }
    if (problem) { fail(problem); continue; }
    if (!changed) { result.saved.push(leadId); continue; }
    try {
      await updateAgentLead(tenantId, leadId, template, values, lead.stage_id, userId);
      result.saved.push(leadId);
    } catch (error) {
      fail(error instanceof LeadPhoneScreeningError ? error.message : error instanceof Error ? error.message : "Could not save");
    }
  }
  return result;
}
