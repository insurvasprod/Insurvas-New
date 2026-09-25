import "server-only";

import { audit } from "@/lib/audit/log";
import { intakeLocalDate, localRangeToUtc } from "@/lib/dealFlow/localDate";
import { getPartnerChannelFacts } from "@/lib/partnerChat/partnerFacts";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { screeningLadder, type ScreeningLadder } from "./screeningLadder";
import { transferCustomerName } from "./service";

/**
 * What the Inbox concept board adds around the transfer table, all read from existing records:
 *
 * - Lost transfers: partner leads the intake accepted (the partner got a 201) whose lead_queue insert
 *   failed. writePartnerIntakeArtifacts records each one in intake_failures (step work_item); until
 *   now nothing read that table. Recovery performs the same insert intake would have, marks the
 *   failure resolved and acknowledges its alert. It never adds a lead_queue column or trigger.
 * - Today by partner: sent, completed and dropped (partnerFacts), plus flagged = today's partner
 *   leads whose screening was not clear.
 * - Row facts: an open call's start, a logged outcome and an SLA escalation, per work item, so a row
 *   can say "On a call 4m 12s", "Claimed 22m, no call", "Submitted" or "Escalated".
 */

export type LostTransfer = { failureId: string; leadId: string; customer: string; partnerName: string | null; productLine: string | null; failedAt: string; error: string; alreadyQueued: boolean };

export async function listLostTransfers(tenantId: string): Promise<LostTransfer[]> {
  const db = getSupabaseServiceClient();
  const failures = await db.from("intake_failures").select("id, lead_id, error_message, created_at").eq("tenant_id", tenantId).eq("step", "work_item").is("resolved_at", null).order("created_at", { ascending: true }).limit(200);
  if (failures.error) throw new Error(`Could not read intake failures: ${failures.error.message}`);
  const rows = failures.data ?? [];
  if (!rows.length) return [];
  const leadIds = [...new Set(rows.map((row) => row.lead_id))];
  const [leads, queued] = await Promise.all([
    db.from("agent_leads").select("id, values, partner_id, product_line").eq("tenant_id", tenantId).in("id", leadIds),
    db.from("lead_queue").select("lead_id").eq("tenant_id", tenantId).in("lead_id", leadIds),
  ]);
  if (leads.error || queued.error) throw new Error(`Could not read lost transfers: ${(leads.error ?? queued.error)?.message}`);
  const partnerIds = [...new Set((leads.data ?? []).map((lead) => lead.partner_id).filter((id): id is string => !!id))];
  const partners = partnerIds.length ? await db.from("partners").select("id, name").eq("tenant_id", tenantId).in("id", partnerIds) : { data: [], error: null };
  if (partners.error) throw new Error(`Could not read partners: ${partners.error.message}`);
  const leadById = new Map((leads.data ?? []).map((lead) => [lead.id, lead]));
  const partnerName = new Map((partners.data ?? []).map((partner) => [partner.id, partner.name]));
  const inQueue = new Set((queued.data ?? []).map((row) => row.lead_id));
  return rows.map((row) => {
    const lead = leadById.get(row.lead_id);
    return {
      failureId: row.id,
      leadId: row.lead_id,
      customer: lead ? transferCustomerName(lead.values) : "Customer",
      partnerName: lead?.partner_id ? partnerName.get(lead.partner_id) ?? null : null,
      productLine: lead?.product_line ?? null,
      failedAt: row.created_at,
      error: row.error_message,
      alreadyQueued: inQueue.has(row.lead_id),
    };
  });
}

/** Puts each lost transfer into the inbox, exactly as intake would have, and closes its failure. */
export async function recoverLostTransfers(input: { tenantId: string; userId: string; failureIds: string[]; request: Request }) {
  const db = getSupabaseServiceClient();
  const failures = await db.from("intake_failures").select("id, lead_id, metadata").eq("tenant_id", input.tenantId).eq("step", "work_item").is("resolved_at", null).in("id", input.failureIds);
  if (failures.error) throw new Error(`Could not read intake failures: ${failures.error.message}`);
  const results: Array<{ failureId: string; leadId: string; outcome: "recovered" | "already_queued" | "failed"; error?: string }> = [];
  for (const failure of failures.data ?? []) {
    const lead = await db.from("agent_leads").select("id, partner_id, product_line, pipeline_id, stage_id").eq("tenant_id", input.tenantId).eq("id", failure.lead_id).maybeSingle();
    if (lead.error || !lead.data) { results.push({ failureId: failure.id, leadId: failure.lead_id, outcome: "failed", error: "The lead no longer exists" }); continue; }
    const metadata = (failure.metadata ?? {}) as Record<string, unknown>;
    const affiliateLinkId = typeof metadata.affiliateLinkId === "string" ? metadata.affiliateLinkId : null;
    const inserted = await db.from("lead_queue").insert({
      tenant_id: input.tenantId,
      lead_id: lead.data.id,
      partner_id: lead.data.partner_id,
      product_line: lead.data.product_line,
      pipeline_id: lead.data.pipeline_id,
      stage_id: lead.data.stage_id,
      ...(affiliateLinkId ? { affiliate_link_id: affiliateLinkId } : {}),
    });
    // 23505: the lead already has a work item (someone recovered it by hand); the failure is still over.
    if (inserted.error && inserted.error.code !== "23505") { results.push({ failureId: failure.id, leadId: failure.lead_id, outcome: "failed", error: inserted.error.message }); continue; }
    const now = new Date().toISOString();
    const [resolved, acknowledged] = await Promise.all([
      db.from("intake_failures").update({ resolved_at: now }).eq("tenant_id", input.tenantId).eq("id", failure.id),
      db.from("intake_alerts").update({ status: "acknowledged", acknowledged_at: now }).eq("tenant_id", input.tenantId).eq("intake_failure_id", failure.id).eq("status", "open"),
    ]);
    if (resolved.error) console.error("[inbox] intake failure could not be marked resolved", resolved.error);
    if (acknowledged.error) console.error("[inbox] intake alert could not be acknowledged", acknowledged.error);
    const outcome = inserted.error ? "already_queued" : "recovered";
    results.push({ failureId: failure.id, leadId: failure.lead_id, outcome });
    await audit({ actorType: "tenant", actorId: input.userId, action: "tenant.intake_work_item_recovered", targetType: "agent_lead", targetId: failure.lead_id, metadata: { intakeFailureId: failure.id, outcome }, request: input.request });
  }
  return results;
}

export type PartnerToday = { partnerId: string; name: string; status: string; sent: number; completed: number; dropped: number; flagged: number };

export async function todayByPartner(tenantId: string, timeZone: string | null): Promise<PartnerToday[]> {
  const db = getSupabaseServiceClient();
  const zone = timeZone || "UTC";
  const today = intakeLocalDate(zone);
  const { gte, lt } = localRangeToUtc(today, today, zone);
  const [facts, partners, leads] = await Promise.all([
    getPartnerChannelFacts(tenantId, zone),
    db.from("partners").select("id, name").eq("tenant_id", tenantId),
    db.from("agent_leads").select("partner_id, screening_outcome").eq("tenant_id", tenantId).not("partner_id", "is", null).gte("created_at", gte).lt("created_at", lt).limit(10000),
  ]);
  if (partners.error || leads.error) throw new Error(`Could not read today's partners: ${(partners.error ?? leads.error)?.message}`);
  const names = new Map((partners.data ?? []).map((partner) => [partner.id, partner.name]));
  const flagged = new Map<string, number>();
  for (const lead of leads.data ?? []) {
    const outcome = (lead as { screening_outcome?: string | null }).screening_outcome;
    if (lead.partner_id && outcome && outcome !== "clear") flagged.set(lead.partner_id, (flagged.get(lead.partner_id) ?? 0) + 1);
  }
  return facts
    .filter((fact) => fact.transfersToday > 0 || fact.status === "active")
    .map((fact) => ({ partnerId: fact.partnerId, name: names.get(fact.partnerId) ?? "Partner", status: fact.status, sent: fact.transfersToday, completed: fact.completedToday, dropped: fact.droppedToday, flagged: flagged.get(fact.partnerId) ?? 0 }))
    .sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
}

export type RowFact = { callStartedAt: string | null; outcome: string | null; escalatedAt: string | null };

/**
 * Per-row facts, read from three small sets rather than by id (the inbox holds up to 500 rows and
 * polls every second): open calls, today's logged outcomes and unclaimed rows already escalated.
 */
export async function inboxRowFacts(tenantId: string): Promise<Record<string, RowFact>> {
  const db = getSupabaseServiceClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [calls, outcomes, escalated, labels] = await Promise.all([
    db.from("active_calls").select("work_item_id, started_at").eq("tenant_id", tenantId).is("ended_at", null).limit(2000),
    db.from("lead_queue").select("id, disposition").eq("tenant_id", tenantId).not("disposition", "is", null).gte("disposition_at", since).limit(2000),
    // sla_escalated_at is written by run_unclaimed_sla (20260924250100) but is not in the generated
    // types yet, so this one read goes through an untyped client.
    (db as unknown as { from: (table: string) => { select: (columns: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => { not: (c: string, op: string, v: null) => { limit: (n: number) => PromiseLike<{ data: Array<{ id: string; sla_escalated_at: string | null }> | null; error: { message: string } | null }> } } } } } })
      .from("lead_queue").select("id, sla_escalated_at").eq("tenant_id", tenantId).eq("status", "unclaimed").not("sla_escalated_at", "is", null).limit(2000),
    db.from("dispositions").select("disposition_key, label").eq("tenant_id", tenantId),
  ]);
  const facts: Record<string, RowFact> = {};
  const fact = (id: string) => (facts[id] ??= { callStartedAt: null, outcome: null, escalatedAt: null });
  if (!calls.error) for (const row of calls.data ?? []) fact(row.work_item_id).callStartedAt = row.started_at;
  const label = new Map((labels.data ?? []).map((row) => [row.disposition_key, row.label]));
  if (!outcomes.error) for (const row of outcomes.data ?? []) if (row.disposition) fact(row.id).outcome = label.get(row.disposition) ?? row.disposition.replaceAll("_", " ");
  if (!escalated.error) for (const row of escalated.data ?? []) fact(row.id).escalatedAt = row.sla_escalated_at;
  return facts;
}

export async function screeningForWorkItem(tenantId: string, workItemId: string): Promise<(ScreeningLadder & { checkedAt: string | null; warning: string | null }) | null> {
  const db = getSupabaseServiceClient();
  const item = await db.from("lead_queue").select("lead_id").eq("tenant_id", tenantId).eq("id", workItemId).maybeSingle();
  if (item.error || !item.data) return null;
  const lead = await db.from("agent_leads").select("screening_outcome, screening_result_id, screening_checked_at, screening_warning").eq("tenant_id", tenantId).eq("id", item.data.lead_id).maybeSingle();
  if (lead.error || !lead.data) return null;
  const row = lead.data as { screening_outcome: string | null; screening_result_id: string | null; screening_checked_at: string | null; screening_warning: string | null };
  return { ...screeningLadder({ outcome: row.screening_outcome, resultId: row.screening_result_id }), checkedAt: row.screening_checked_at, warning: row.screening_warning };
}
