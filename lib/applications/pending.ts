import "server-only";

import { audit } from "@/lib/audit/log";
import type { AuditAction } from "@/lib/audit/actions";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { resolveSalesSettings } from "@/lib/salesSettings/schema";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError } from "./db";
import { PRODUCT_LABEL, type ApplicationOutcome, type ApplicationStatus, type InsuredRole, type RequirementKind, type WaitingOn } from "./constants";
import { inChunks, insuredNames } from "./lists";
import {
  ageingFor, localDay, missingNumber, summarise, wholeDaysSince,
  type AwaitingNumberRow, type CounterofferRow, type PendingSummary, type RequirementRow,
} from "./listRules";

/**
 * Pending cases (LA-3.18, 3.26, 3.15): the open requirements across the tenant, the counteroffers
 * waiting on the client, and the submitted applications still missing a number. Plus the one-click
 * chase. Every query names the tenant.
 */

type Actor = { tenantId: string; userId: string; request: Request };

type Requirement = {
  id: string; application_id: string; kind: RequirementKind; description: string | null; waiting_on: WaitingOn; status: RequirementRow["status"];
  raised_at: string; due_at: string | null; last_chased_at: string | null; chase_count: number; exam_vendor: string | null; last_chased_by?: string | null;
};
type Attempt = { id: string; case_id: string; lead_id: string; insured_role: InsuredRole; attempt_no: number; carrier_id: string | null; carrier_product_id: string | null; product_code: string | null; quote_id: string | null; status: ApplicationStatus; outcome: ApplicationOutcome | null; updated_at: string; submitted_at: string | null };

const OPEN = ["open", "in_progress"] as const;
const REQ_COLUMNS = "id, application_id, kind, description, waiting_on, status, raised_at, due_at, last_chased_at, chase_count, exam_vendor";
// This literal is not in lib/audit/actions.ts yet (a shared file); typed as string so the cast holds.
const REQUIREMENT_CHASED: string = "tenant.application_requirement_chased";

export type PendingData = {
  requirements: RequirementRow[];
  counteroffers: CounterofferRow[];
  awaiting: AwaitingNumberRow[];
  ageingDays: number;
  summary: PendingSummary;
};

export async function ageingDaysFor(tenantId: string) {
  const s = await db().from("tenant_sales_settings").select("settings").eq("tenant_id", tenantId).maybeSingle();
  return resolveSalesSettings(s.error ? null : s.data?.settings).requirementAgeingDays;
}

/** Requirements, with last_chased_by when 20260926102300 is applied, without it before. */
async function openRequirements(tenantId: string): Promise<Requirement[]> {
  const client = db();
  const withBy = await client.from("tenant_application_requirements").select(`${REQ_COLUMNS}, last_chased_by`).eq("tenant_id", tenantId).in("status", OPEN).order("raised_at").limit(2000);
  if (!withBy.error) return rows<Requirement>(withBy.data);
  if (isMissingSchema(withBy.error) && /last_chased_by/.test(withBy.error.message ?? "")) {
    const plain = await client.from("tenant_application_requirements").select(REQ_COLUMNS).eq("tenant_id", tenantId).in("status", OPEN).order("raised_at").limit(2000);
    if (plain.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", plain.error.message, 500);
    return rows<Requirement>(plain.data);
  }
  if (isMissingSchema(withBy.error)) throw new SchemaPendingError("Carrier requirements");
  throw new ApplicationError("APPLICATION_UNAVAILABLE", withBy.error.message, 500);
}

export async function loadPending(tenantId: string, now = Date.now()): Promise<PendingData> {
  const client = db();
  const [requirements, counterQ, awaitingQ, ageingDays] = await Promise.all([
    openRequirements(tenantId),
    client.from("tenant_application_counteroffers").select("id, application_id, received_at, offered_tier, offered_health_class, offered_face_cents, offered_monthly_premium_cents, reason_code, reason_text, expires_at, status")
      .eq("tenant_id", tenantId).eq("status", "pending_client").order("expires_at", { ascending: true, nullsFirst: false }).limit(1000),
    client.from("tenant_applications").select("id, case_id, lead_id, insured_role, attempt_no, carrier_id, carrier_product_id, product_code, quote_id, status, outcome, updated_at, submitted_at")
      .eq("tenant_id", tenantId).or("status.in.(submitted,pending_carrier,counteroffer_pending),and(status.eq.closed,outcome.eq.issued)").limit(3000),
    ageingDaysFor(tenantId),
  ]);
  if (counterQ.error && !isMissingSchema(counterQ.error)) throw new ApplicationError("APPLICATION_UNAVAILABLE", counterQ.error.message, 500);
  if (awaitingQ.error && isMissingSchema(awaitingQ.error)) throw new SchemaPendingError("The application record");
  if (awaitingQ.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", awaitingQ.error.message, 500);
  const counters = rows<{ id: string; application_id: string; received_at: string; offered_tier: string | null; offered_health_class: string | null; offered_face_cents: number | null; offered_monthly_premium_cents: number | null; reason_code: string | null; reason_text: string | null; expires_at: string | null; status: CounterofferRow["status"] }>(counterQ.data);
  const candidates = rows<Attempt>(awaitingQ.data);

  // Every attempt any of the three lists points at.
  const knownIds = new Set(candidates.map((a) => a.id));
  const extraIds = [...new Set([...requirements.map((r) => r.application_id), ...counters.map((o) => o.application_id)])].filter((id) => !knownIds.has(id));
  const extra = await inChunks<Attempt>(extraIds, (chunk) => client.from("tenant_applications").select("id, case_id, lead_id, insured_role, attempt_no, carrier_id, carrier_product_id, product_code, quote_id, status, outcome, updated_at, submitted_at").eq("tenant_id", tenantId).in("id", chunk));
  const attempts = [...candidates, ...extra];
  const attemptBy = new Map(attempts.map((a) => [a.id, a]));

  const chaserIds = requirements.map((r) => r.last_chased_by).filter((x): x is string => Boolean(x));
  const [names, carriers, products, quotes, submissions, chasers] = await Promise.all([
    insuredNames(tenantId, attempts),
    inChunks<{ id: string; name: string }>(attempts.map((a) => a.carrier_id).filter((x): x is string => Boolean(x)), (chunk) => client.from("carriers").select("id, name").in("id", chunk)),
    inChunks<{ id: string; name: string }>(attempts.map((a) => a.carrier_product_id).filter((x): x is string => Boolean(x)), (chunk) => client.from("carrier_products").select("id, name").in("id", chunk)),
    inChunks<{ id: string; tier: string | null; assumed_health_class: string | null; face_amount_cents: number; monthly_premium_cents: number }>(attempts.map((a) => a.quote_id).filter((x): x is string => Boolean(x)), (chunk) =>
      client.from("tenant_quotes").select("id, tier, assumed_health_class, face_amount_cents, monthly_premium_cents").eq("tenant_id", tenantId).in("id", chunk)),
    inChunks<{ application_id: string; carrier_reference: string | null; policy_number: string | null; submitted_at: string }>(candidates.map((a) => a.id), (chunk) =>
      client.from("tenant_application_submissions").select("application_id, carrier_reference, policy_number, submitted_at").eq("tenant_id", tenantId).in("application_id", chunk)),
    // users has no tenant_id; these ids came from this tenant's own rows.
    inChunks<{ id: string; name: string | null }>(chaserIds, (chunk) => client.from("users").select("id, name").in("id", chunk)),
  ]);
  const carrierBy = new Map(carriers.map((c) => [c.id, c.name]));
  const productBy = new Map(products.map((p) => [p.id, p.name]));
  const quoteBy = new Map(quotes.map((q) => [q.id, q]));
  const chaserBy = new Map(chasers.map((u) => [u.id, u.name ?? null]));
  const latestSub = new Map<string, { carrier_reference: string | null; policy_number: string | null; submitted_at: string }>();
  for (const s of submissions) { const cur = latestSub.get(s.application_id); if (!cur || s.submitted_at > cur.submitted_at) latestSub.set(s.application_id, s); }

  const requirementRows: RequirementRow[] = requirements.flatMap((r) => {
    const a = attemptBy.get(r.application_id);
    // A closed attempt waits on nobody, whatever its old rows still say.
    if (!a || a.status === "closed") return [];
    const daysOpen = wholeDaysSince(r.raised_at, now) ?? 0;
    return [{
      id: r.id, applicationId: a.id, caseId: a.case_id, clientName: names.nameFor(a), insuredRole: a.insured_role,
      carrierName: a.carrier_id ? carrierBy.get(a.carrier_id) ?? null : null,
      monthlyPremiumCents: a.quote_id ? quoteBy.get(a.quote_id)?.monthly_premium_cents ?? null : null,
      kind: r.kind, description: r.description ?? "", waitingOn: r.waiting_on, status: r.status, raisedAt: r.raised_at, dueAt: r.due_at,
      lastChasedAt: r.last_chased_at, chaseCount: r.chase_count, examVendor: r.exam_vendor,
      lastChasedByName: r.last_chased_by ? chaserBy.get(r.last_chased_by) ?? null : null,
      daysOpen, daysSinceChase: wholeDaysSince(r.last_chased_at, now), ageing: ageingFor(daysOpen, ageingDays),
    }];
  });

  const counterRows: CounterofferRow[] = counters.flatMap((o) => {
    const a = attemptBy.get(o.application_id);
    if (!a || a.status === "closed") return [];
    const q = a.quote_id ? quoteBy.get(a.quote_id) : undefined;
    return [{
      id: o.id, applicationId: a.id, caseId: a.case_id, clientName: names.nameFor(a), insuredRole: a.insured_role,
      carrierName: a.carrier_id ? carrierBy.get(a.carrier_id) ?? null : null, receivedAt: o.received_at,
      // The applied-for terms are the attempt's selected quote — kept, never overwritten (LA-3.26).
      applied: { tier: q?.tier ?? null, healthClass: q?.assumed_health_class ?? null, faceCents: q?.face_amount_cents ?? 0, monthlyCents: q?.monthly_premium_cents ?? 0 },
      offered: { tier: o.offered_tier, healthClass: o.offered_health_class, faceCents: o.offered_face_cents ?? q?.face_amount_cents ?? 0, monthlyCents: o.offered_monthly_premium_cents ?? q?.monthly_premium_cents ?? 0 },
      reason: o.reason_text ?? o.reason_code?.replace(/_/g, " ") ?? "", expiresAt: o.expires_at, status: o.status,
    }];
  });

  const awaiting: AwaitingNumberRow[] = candidates.flatMap((a) => {
    const sub = latestSub.get(a.id);
    const missing = missingNumber({ status: a.status, outcome: a.outcome, reference: sub?.carrier_reference ?? null, policyNumber: sub?.policy_number ?? null });
    if (!missing) return [];
    return [{
      caseId: a.case_id, applicationId: a.id, leadId: a.lead_id, clientName: names.nameFor(a), insuredRole: a.insured_role, state: names.stateFor(a.lead_id),
      carrierName: a.carrier_id ? carrierBy.get(a.carrier_id) ?? null : null,
      productLabel: (a.carrier_product_id && productBy.get(a.carrier_product_id)) || (a.product_code ? PRODUCT_LABEL[a.product_code] ?? a.product_code : null),
      attemptNo: a.attempt_no, status: a.status, outcome: a.outcome, monthlyPremiumCents: a.quote_id ? quoteBy.get(a.quote_id)?.monthly_premium_cents ?? null : null,
      qaVerdict: null, reference: sub?.carrier_reference ?? null, policyNumber: sub?.policy_number ?? null, updatedAt: a.updated_at,
      submittedAt: sub?.submitted_at ?? a.submitted_at ?? a.updated_at, missing,
    }];
  });

  return { requirements: requirementRows, counteroffers: counterRows, awaiting, ageingDays, summary: summarise({ requirements: requirementRows, counteroffers: counterRows, awaiting, ageingDays, now }) };
}

/** The dashboard's three figures. The same rows as the page, so the two never disagree. */
export async function pendingSummary(tenantId: string): Promise<PendingSummary> {
  return (await loadPending(tenantId)).summary;
}

// ── Log a chase (LA-3.18) ────────────────────────────────────────────────────

/** chase_count + 1 and last_chased_at = now, in one click. Optimistic on chase_count so two clicks count twice, never once. */
export async function chaseRequirement(actor: Actor, requirementId: string) {
  const client = db();
  for (let tries = 0; tries < 3; tries += 1) {
    const cur = await client.from("tenant_application_requirements").select("id, application_id, status, chase_count").eq("tenant_id", actor.tenantId).eq("id", requirementId).maybeSingle();
    if (isMissingSchema(cur.error)) throw new SchemaPendingError("Carrier requirements");
    if (cur.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", cur.error.message, 500);
    if (!cur.data) throw new ApplicationError("REQUIREMENT_NOT_FOUND", "That requirement could not be found.", 404);
    if (!(OPEN as readonly string[]).includes(cur.data.status)) throw new ApplicationError("REQUIREMENT_CLOSED", "This requirement is already met — there is nothing to chase.", 409);
    const at = new Date().toISOString();
    const patch: Record<string, unknown> = { chase_count: cur.data.chase_count + 1, last_chased_at: at, last_chased_by: actor.userId };
    let up = await client.from("tenant_application_requirements").update(patch).eq("tenant_id", actor.tenantId).eq("id", requirementId).eq("chase_count", cur.data.chase_count).select("id, chase_count, last_chased_at");
    if (up.error && isMissingSchema(up.error) && /last_chased_by/.test(up.error.message ?? "")) {
      delete patch.last_chased_by;
      up = await client.from("tenant_application_requirements").update(patch).eq("tenant_id", actor.tenantId).eq("id", requirementId).eq("chase_count", cur.data.chase_count).select("id, chase_count, last_chased_at");
    }
    if (up.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", up.error.message, 500);
    const saved = rows<{ id: string; chase_count: number; last_chased_at: string }>(up.data)[0];
    if (!saved) continue; // someone chased it between the read and the write; read again
    await audit({ actorType: "tenant", actorId: actor.userId, action: REQUIREMENT_CHASED as AuditAction, targetType: "tenant_application", targetId: cur.data.application_id, metadata: { requirementId, chaseCount: saved.chase_count, via: "pending_cases" }, request: actor.request });
    return { id: saved.id, chaseCount: saved.chase_count, lastChasedAt: saved.last_chased_at };
  }
  throw new ApplicationError("REQUIREMENT_BUSY", "Someone else is chasing this one right now — refresh and try again.", 409);
}

/** "Chase everything overdue": one chase on every red requirement not already chased today. */
export async function chaseOverdue(actor: Actor, now = Date.now()) {
  const [requirements, ageingDays, zone] = await Promise.all([openRequirements(actor.tenantId), ageingDaysFor(actor.tenantId), getWorkspaceTimezone(actor.tenantId).catch(() => null)]);
  const tz = zone ?? "UTC";
  const today = localDay(new Date(now).toISOString(), tz);
  const due = requirements.filter((r) => ageingFor(wholeDaysSince(r.raised_at, now) ?? 0, ageingDays) === "red" && !(r.last_chased_at && localDay(r.last_chased_at, tz) === today));
  const chased: { id: string; chaseCount: number; lastChasedAt: string }[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const r of due) {
    try { chased.push(await chaseRequirement(actor, r.id)); } catch (error) { failed.push({ id: r.id, error: error instanceof Error ? error.message : "Could not log the chase" }); }
  }
  return { chased, failed, skippedChasedToday: requirements.filter((r) => ageingFor(wholeDaysSince(r.raised_at, now) ?? 0, ageingDays) === "red").length - due.length };
}

