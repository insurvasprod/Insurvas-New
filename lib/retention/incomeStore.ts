import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { computeRadar } from "./radarStore";
import { IncomeRuleError, toRecord, type ContactIncomeType, type IncomeInput, type IncomeSource, type IncomeSurface } from "./income";

/**
 * LA-5.10 (Notion sprint) · a client's monthly income, server side. One row per person
 * (contact_income), whichever of the three places captured it: the interview, the draft-date setup,
 * or a retention call. Every read and change by a person is logged (contact_income_access_log).
 *
 * A lead becomes a client only when a carrier file proves the sale, so during the sale the figure is
 * held on the lead (lead_income) and the database moves it to the client when that link is made
 * (20261014700000). Contacts never fills with people who did not buy (owner decision, 2026-10-14).
 *
 * Who may see it is decided by the routes: owners and producers (the writing agent), never setters,
 * assistants (who do the buffer work) or bookkeepers — and partner users have no route to it at all.
 * It never goes to an AI provider: nothing in lib/retention imports one (a test holds that).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const INCOME_PENDING_MESSAGE = "Income capture needs a database update (20261014700000).";

export class IncomeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "IncomeError";
  }
}

export type Viewer = { tenantId: string; userId: string; role: string };

/** Where the figure lives: the client, or — before the sale's client exists — the lead. */
export type IncomeTarget = { contactId: string | null; leadId: string | null; unavailable: string | null };

export type IncomeView = {
  contactId: string | null;
  /** True while the figure is held on the lead, waiting for the sale's client. */
  onLead: boolean;
  /** Why there is nowhere to record it, when there is nowhere. */
  unavailable: string | null;
  income: { monthlyIncomeCents: number; incomeType: ContactIncomeType | null; householdTotal: boolean; source: IncomeSource; confidence: "stated" | "estimated"; capturedAt: string } | null;
};

function holder(target: IncomeTarget) {
  if (target.contactId) return { table: "contact_income", key: "contact_id", id: target.contactId };
  if (target.leadId) return { table: "lead_income", key: "lead_id", id: target.leadId };
  return null;
}

async function log(viewer: Viewer, target: IncomeTarget, action: "view" | "save" | "clear", surface: IncomeSurface) {
  const { error } = await db().from("contact_income_access_log").insert({
    tenant_id: viewer.tenantId, user_id: viewer.userId, contact_id: target.contactId, lead_id: target.contactId ? null : target.leadId, action, surface,
  });
  if (error) {
    if (isSchemaGap(error)) throw new IncomeError(INCOME_PENDING_MESSAGE, 503);
    // A read that cannot be logged is not served.
    throw new Error(`Could not record the access: ${error.message}`);
  }
}

/** Where an application's figure lives: its lead's client, else the lead. A spouse's attempt shares the primary's lead, so only the primary records it. */
export async function contactForApplication(viewer: Viewer, applicationId: string): Promise<IncomeTarget> {
  const { data: app, error } = await db().from("tenant_applications").select("lead_id, insured_role, created_by").eq("tenant_id", viewer.tenantId).eq("id", applicationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!app) throw new IncomeError("That application isn't here.", 404);
  if (app.insured_role === "spouse") return { contactId: null, leadId: null, unavailable: "Recorded on the primary insured's interview." };
  const { data: lead } = await db().from("agent_leads").select("id, contact_id").eq("tenant_id", viewer.tenantId).eq("id", app.lead_id).maybeSingle();
  if (!lead) return { contactId: null, leadId: null, unavailable: "This application's lead is gone, so there is nowhere to keep it." };
  return { contactId: (lead.contact_id as string | null) ?? null, leadId: lead.id as string, unavailable: null };
}

/** The contact behind a policy, for a retention call (a producer reaches only the policies credited to them). */
export async function contactForPolicy(viewer: Viewer, carrierId: string, policyNumber: string): Promise<IncomeTarget> {
  const { data: p, error } = await db().from("policy_current").select("contact_id, agent_user_id").eq("tenant_id", viewer.tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).maybeSingle();
  if (error) throw new Error(error.message);
  if (!p || (viewer.role === "producer" && p.agent_user_id !== viewer.userId)) throw new IncomeError("That policy isn't in your book.", 404);
  if (!p.contact_id) return { contactId: null, leadId: null, unavailable: "No client is linked to this policy yet." };
  return { contactId: p.contact_id as string, leadId: null, unavailable: null };
}

/** Read it (logged). */
export async function readIncome(viewer: Viewer, target: IncomeTarget, surface: IncomeSurface): Promise<IncomeView> {
  const at = holder(target);
  if (!at) return { contactId: null, onLead: false, unavailable: target.unavailable ?? "There is nowhere to keep it.", income: null };
  const { data, error } = await db().from(at.table).select("monthly_income_cents, income_type, is_household_total, source, confidence, captured_at, updated_at").eq("tenant_id", viewer.tenantId).eq(at.key, at.id).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) throw new IncomeError(INCOME_PENDING_MESSAGE, 503);
    throw new Error(error.message);
  }
  if (data) await log(viewer, target, "view", surface);
  return {
    contactId: target.contactId,
    onLead: !target.contactId,
    unavailable: null,
    income: data ? { monthlyIncomeCents: Number(data.monthly_income_cents), incomeType: data.income_type, householdTotal: data.is_household_total, source: data.source, confidence: data.confidence, capturedAt: data.updated_at ?? data.captured_at } : null,
  };
}

/** Save it — or clear it with null. Logged, and the client's in-force policies are rescored. */
export async function saveIncome(viewer: Viewer, target: IncomeTarget, input: IncomeInput | null, surface: IncomeSurface) {
  const at = holder(target);
  if (!at) throw new IncomeError(target.unavailable ?? "There is nowhere to keep it.", 409);
  if (input === null) {
    const { error } = await db().from(at.table).delete().eq("tenant_id", viewer.tenantId).eq(at.key, at.id);
    if (error) {
      if (isSchemaGap(error)) throw new IncomeError(INCOME_PENDING_MESSAGE, 503);
      throw new Error(error.message);
    }
    await log(viewer, target, "clear", surface);
  } else {
    let record;
    try {
      record = toRecord(input, surface);
    } catch (e) {
      if (e instanceof IncomeRuleError) throw new IncomeError(e.message, 400);
      throw e;
    }
    const now = new Date().toISOString();
    const { error } = await db().from(at.table).upsert({
      [at.key]: at.id, tenant_id: viewer.tenantId, monthly_income_cents: record.monthlyIncomeCents, income_type: record.incomeType,
      is_household_total: record.householdTotal, source: record.source, confidence: record.confidence, captured_by: viewer.userId, captured_at: now, updated_at: now,
    }, { onConflict: at.key });
    if (error) {
      if (isSchemaGap(error)) throw new IncomeError(INCOME_PENDING_MESSAGE, 503);
      throw new Error(`Could not save the income: ${error.message}`);
    }
    await log(viewer, target, "save", surface);
  }
  // Held on a lead: there is no client yet, so no policy to score.
  const contactId = target.contactId;
  if (!contactId) return;
  // The client's own policies (and the household's, for a household total) score again now.
  try {
    const { data: contact } = await db().from("contacts").select("household_id").eq("tenant_id", viewer.tenantId).eq("id", contactId).maybeSingle();
    let q = db().from("policy_current").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId).in("status_normalized", ["active", "at_risk", "approved_unpaid"]);
    q = contact?.household_id ? q.or(`contact_id.eq.${contactId},household_id.eq.${contact.household_id}`) : q.eq("contact_id", contactId);
    const { data: policies } = await q.limit(50);
    const byCarrier = new Map<string, string[]>();
    for (const p of (policies ?? []) as Loose[]) byCarrier.set(p.carrier_id, [...(byCarrier.get(p.carrier_id) ?? []), p.policy_number]);
    for (const [carrierId, numbers] of byCarrier) await computeRadar(viewer.tenantId, { carrierId, policyNumbers: numbers });
  } catch (e) {
    console.error("[income] the policies could not be rescored", e);
  }
}
