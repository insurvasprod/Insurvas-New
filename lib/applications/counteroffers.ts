import "server-only";

import { auditAfterSubmit } from "./afterAudit";
import { TIER_LABEL } from "./constants";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError } from "./db";
import { attemptHead, fail, moveAttempt, type Actor } from "./requirements";
import { regenerateWelcomePack } from "./welcomePack";

/**
 * LA-3.26 counteroffers. The carrier approved different terms; the offer is recorded BESIDE the
 * application — the applied-for values and the original quote are never touched — and a
 * waiting-on-client requirement is raised. The client's answer closes the loop:
 *
 *   accept  → pending_carrier; the offered terms become the effective coverage (cov.* values,
 *             source 'quote'); the welcome pack is regenerated; the FYC estimate follows
 *   reject  → closed / declined_by_client
 *   expire  → closed / offer_expired (also la3_expire_counteroffers() for the sweep)
 *
 * Nothing here deletes a counteroffer (DELETE is revoked on the table).
 */

type OfferRow = {
  id: string; application_id: string; received_at: string; offered_tier: string | null; offered_health_class: string | null;
  offered_face_cents: number | null; offered_monthly_premium_cents: number | null; offered_annual_premium_cents: number | null;
  reason_code: string | null; reason_text: string | null; expires_at: string | null; status: "pending_client" | "accepted" | "rejected" | "expired";
  responded_at: string | null; client_response_note: string | null; requirement_id: string | null;
  applied_effective_on?: string | null; offered_effective_on?: string | null;
};

const OFFER_COLUMNS = "id, application_id, received_at, offered_tier, offered_health_class, offered_face_cents, offered_monthly_premium_cents, offered_annual_premium_cents, reason_code, reason_text, expires_at, status, responded_at, client_response_note, requirement_id";

const face = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The coverage the attempt applied for: the selected quote (never the counteroffer). */
async function appliedCoverage(tenantId: string, quoteId: string | null) {
  if (!quoteId) return null;
  const q = await db().from("tenant_quotes").select("id, carrier_id, product_code, tier, assumed_health_class, face_amount_cents, monthly_premium_cents").eq("tenant_id", tenantId).eq("id", quoteId).maybeSingle();
  return (q.data ?? null) as { id: string; carrier_id: string; product_code: string; tier: string | null; assumed_health_class: string | null; face_amount_cents: number; monthly_premium_cents: number } | null;
}

// ── FYC, the same arithmetic as the case read (integer cents, half-up) ──────

type Effective = { effective_from: string };
const latest = <T extends Effective>(list: T[], day: string) => [...list].filter((x) => x.effective_from <= day).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];

export async function estimateFyc(tenantId: string, carrierId: string, productCode: string, monthlyCents: number): Promise<number | null> {
  const client = db();
  const day = new Date().toISOString().slice(0, 10);
  const [contracts, schedules] = await Promise.all([
    client.from("tenant_carriers").select("carrier_id, contract_level_bp, effective_from, is_active").eq("tenant_id", tenantId).eq("carrier_id", carrierId),
    client.from("commission_schedules").select("carrier_id, product_code, contract_level_bp, policy_year, rate_bp, effective_from").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_year", 1).eq("product_code", productCode),
  ]);
  const contract = latest(rows<{ contract_level_bp: number; effective_from: string; is_active: boolean }>(contracts.data).filter((c) => c.is_active), day);
  if (!contract) return null;
  const sched = latest(rows<{ contract_level_bp: number; rate_bp: number; effective_from: string }>(schedules.data).filter((s) => s.contract_level_bp === contract.contract_level_bp), day);
  if (!sched) return null;
  return Math.floor((monthlyCents * 12 * sched.rate_bp * 2 + 10_000) / 20_000);
}

// ── reads ──────────────────────────────────────────────────────────────────

export type CounterofferDetail = {
  id: string; status: OfferRow["status"]; receivedAt: string; expiresAt: string | null; respondedAt: string | null; reason: string; note: string | null; requirementId: string | null;
  applied: { tier: string | null; healthClass: string | null; faceCents: number; monthlyCents: number; effectiveOn: string | null; fycCents: number | null };
  offered: { tier: string | null; healthClass: string | null; faceCents: number; monthlyCents: number; annualCents: number | null; effectiveOn: string | null; fycCents: number | null };
};

export async function listCounteroffers(tenantId: string, applicationId: string): Promise<CounterofferDetail[]> {
  const a = await attemptHead(tenantId, applicationId, { allowClosed: true });
  let q = await db().from("tenant_application_counteroffers").select(`${OFFER_COLUMNS}, applied_effective_on, offered_effective_on`).eq("tenant_id", tenantId).eq("application_id", a.id).order("received_at");
  // The effective-date columns arrive with 20260926102210; read without them until then.
  if (q.error && isMissingSchema(q.error)) q = await db().from("tenant_application_counteroffers").select(OFFER_COLUMNS).eq("tenant_id", tenantId).eq("application_id", a.id).order("received_at");
  if (q.error) { if (isMissingSchema(q.error)) return []; fail(q.error, "Could not load the counteroffers"); }
  const list = rows<OfferRow>(q.data);
  if (!list.length) return [];
  const quote = await appliedCoverage(tenantId, a.quote_id);
  const appliedFyc = quote ? await estimateFyc(tenantId, quote.carrier_id, quote.product_code, quote.monthly_premium_cents) : null;
  return Promise.all(list.map(async (o) => ({
    id: o.id, status: o.status, receivedAt: o.received_at, expiresAt: o.expires_at, respondedAt: o.responded_at, reason: o.reason_text ?? o.reason_code ?? "", note: o.client_response_note, requirementId: o.requirement_id,
    applied: { tier: quote?.tier ?? null, healthClass: quote?.assumed_health_class ?? null, faceCents: quote?.face_amount_cents ?? 0, monthlyCents: quote?.monthly_premium_cents ?? 0, effectiveOn: o.applied_effective_on ?? null, fycCents: appliedFyc },
    offered: {
      tier: o.offered_tier, healthClass: o.offered_health_class, faceCents: o.offered_face_cents ?? 0, monthlyCents: o.offered_monthly_premium_cents ?? 0, annualCents: o.offered_annual_premium_cents,
      effectiveOn: o.offered_effective_on ?? null,
      fycCents: quote && o.offered_monthly_premium_cents ? await estimateFyc(tenantId, quote.carrier_id, quote.product_code, o.offered_monthly_premium_cents) : null,
    },
  })));
}

// ── record ─────────────────────────────────────────────────────────────────

export async function recordCounteroffer(actor: Actor, applicationId: string, input: {
  offered_tier?: string | null; offered_health_class?: string | null; offered_face_cents: number; offered_monthly_premium_cents: number; offered_annual_premium_cents?: number | null;
  reason_text: string; expires_at: string; received_at?: string | null; applied_effective_on?: string | null; offered_effective_on?: string | null;
}) {
  const a = await attemptHead(actor.tenantId, applicationId);
  if (a.status !== "submitted" && a.status !== "pending_carrier") {
    throw new ApplicationError("COUNTEROFFER_NOT_ALLOWED", a.status === "counteroffer_pending" ? "There is already a counteroffer waiting on the client." : "A counteroffer comes after submission.", 409);
  }
  if (input.offered_monthly_premium_cents >= input.offered_face_cents) throw new ApplicationError("COUNTEROFFER_PREMIUM_OVER_FACE", "The monthly premium can't be as much as the face amount — check the figures.");
  const received = input.received_at ? new Date(input.received_at) : new Date();
  const expires = new Date(input.expires_at);
  if (!(expires.getTime() > received.getTime()) || expires.getTime() <= Date.now()) throw new ApplicationError("COUNTEROFFER_EXPIRY", "The offer has to expire after today.");

  const client = db();
  const quote = await appliedCoverage(actor.tenantId, a.quote_id);
  const tierLabel = (t: string | null | undefined) => (t ? TIER_LABEL[t] ?? t : "the offered terms");
  const description = `Counteroffer: ${tierLabel(input.offered_tier)} · ${face(input.offered_face_cents)} at ${money(input.offered_monthly_premium_cents)} a month${quote ? `, against ${face(quote.face_amount_cents)} at ${money(quote.monthly_premium_cents)} applied for` : ""}. The client accepts or refuses.`;
  const today = new Date().toISOString().slice(0, 10);
  const req = await client.from("tenant_application_requirements").insert({
    tenant_id: actor.tenantId, application_id: a.id, kind: "counteroffer", description: description.slice(0, 1000), waiting_on: "client", status: "open",
    raised_at: today, due_at: expires.toISOString().slice(0, 10) >= today ? expires.toISOString().slice(0, 10) : null, created_by: actor.userId,
  }).select("id").single();
  if (req.error) fail(req.error, "Could not record the counteroffer");

  const row: Record<string, unknown> = {
    tenant_id: actor.tenantId, application_id: a.id, received_at: received.toISOString(), offered_tier: input.offered_tier ?? null, offered_health_class: input.offered_health_class ?? null,
    offered_face_cents: input.offered_face_cents, offered_monthly_premium_cents: input.offered_monthly_premium_cents, offered_annual_premium_cents: input.offered_annual_premium_cents ?? null,
    reason_text: input.reason_text.trim(), expires_at: expires.toISOString(), status: "pending_client", requirement_id: req.data.id, created_by: actor.userId,
  };
  if (input.applied_effective_on || input.offered_effective_on) { row.applied_effective_on = input.applied_effective_on ?? null; row.offered_effective_on = input.offered_effective_on ?? null; }
  const ins = await client.from("tenant_application_counteroffers").insert(row).select("id").single();
  if (ins.error) {
    // The requirement stays as the record of the attempt; mark it so it does not wait on anyone.
    await client.from("tenant_application_requirements").update({ status: "waived", satisfied_at: today, note: "The counteroffer could not be saved." }).eq("tenant_id", actor.tenantId).eq("id", req.data.id);
    if (ins.error.code === "23505") throw new ApplicationError("COUNTEROFFER_PENDING", "There is already a counteroffer waiting on the client.", 409);
    fail(ins.error, "Could not record the counteroffer");
  }
  await moveAttempt(actor, a.id, "counteroffer_pending", { why: "counteroffer_recorded" });
  await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_counteroffer_recorded", targetId: a.id, metadata: { counterofferId: ins.data.id, offeredFaceCents: input.offered_face_cents, offeredMonthlyCents: input.offered_monthly_premium_cents, expiresAt: expires.toISOString() }, request: actor.request });
  return { id: ins.data.id as string, requirementId: req.data.id as string };
}

// ── respond ────────────────────────────────────────────────────────────────

export async function respondCounteroffer(actor: Actor, applicationId: string, counterofferId: string, input: { response: "accept" | "reject" | "expire"; note?: string | null }) {
  const a = await attemptHead(actor.tenantId, applicationId);
  const client = db();
  const found = await client.from("tenant_application_counteroffers").select(OFFER_COLUMNS).eq("tenant_id", actor.tenantId).eq("application_id", a.id).eq("id", counterofferId).maybeSingle();
  if (found.error) fail(found.error, "Could not load the counteroffer");
  if (!found.data) throw new ApplicationError("COUNTEROFFER_NOT_FOUND", "That counteroffer could not be found.", 404);
  const o = found.data as OfferRow;
  if (o.status !== "pending_client" || a.status !== "counteroffer_pending") throw new ApplicationError("COUNTEROFFER_ANSWERED", "This counteroffer has already been answered.", 409);

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const status = input.response === "accept" ? "accepted" : input.response === "reject" ? "rejected" : "expired";
  // Compare-and-set: two agents answering at once cannot both win.
  const upd = await client.from("tenant_application_counteroffers").update({
    status, responded_at: input.response === "expire" ? null : now, responded_by: input.response === "expire" ? null : actor.userId, client_response_note: input.note?.trim() || null,
  }).eq("tenant_id", actor.tenantId).eq("id", o.id).eq("status", "pending_client").select("id");
  if (upd.error) fail(upd.error, "Could not record the answer");
  if (!rows(upd.data).length) throw new ApplicationError("COUNTEROFFER_ANSWERED", "This counteroffer has already been answered.", 409);
  if (o.requirement_id) {
    const reqStatus = input.response === "accept" ? "satisfied" : input.response === "reject" ? "waived" : "expired";
    await client.from("tenant_application_requirements").update({ status: reqStatus, satisfied_at: reqStatus === "expired" ? null : today }).eq("tenant_id", actor.tenantId).eq("id", o.requirement_id).in("status", ["open", "in_progress"]);
  }

  let fyc: { before: number | null; after: number | null } | null = null;
  let pack: { version: number } | null = null;
  if (input.response === "accept") {
    await moveAttempt(actor, a.id, "pending_carrier", { why: "counteroffer_accepted" });
    // Effective coverage = the offered terms. The quote row is left exactly as it was.
    const cov: { key: string; value: string | number }[] = [];
    if (o.offered_face_cents) cov.push({ key: "cov.face_amount", value: o.offered_face_cents });
    if (o.offered_monthly_premium_cents) cov.push({ key: "cov.monthly_premium", value: o.offered_monthly_premium_cents });
    if (o.offered_tier) cov.push({ key: "cov.product_tier", value: o.offered_tier });
    if (cov.length) {
      const up = await client.from("tenant_application_values").upsert(cov.map((c) => ({
        application_id: a.id, tenant_id: actor.tenantId, field_key: c.key, value: c.value, value_ciphertext: null, value_last4: null, key_version: null,
        source: "quote", reviewed_at: now, reviewed_by: actor.userId, updated_by: actor.userId,
      })), { onConflict: "application_id,field_key" });
      if (up.error) fail(up.error, "Could not update the coverage");
    }
    // The deal row follows the attempt's effective figures (LA-1.13), so commission estimates do too.
    if (o.offered_monthly_premium_cents) {
      await client.from("deal_flow").update({ monthly_premium_cents: o.offered_monthly_premium_cents, ...(o.offered_face_cents ? { face_amount_cents: o.offered_face_cents } : {}), updated_at: now })
        .eq("tenant_id", actor.tenantId).eq("lead_id", a.lead_id);
    }
    const quote = await appliedCoverage(actor.tenantId, a.quote_id);
    if (quote && o.offered_monthly_premium_cents) {
      fyc = { before: await estimateFyc(actor.tenantId, quote.carrier_id, quote.product_code, quote.monthly_premium_cents), after: await estimateFyc(actor.tenantId, quote.carrier_id, quote.product_code, o.offered_monthly_premium_cents) };
    }
    try {
      pack = await regenerateWelcomePack(actor, a.id, "Updated for the accepted counteroffer.");
    } catch (error) {
      if (!(error instanceof ApplicationError) || error.code === "APPLICATION_UNAVAILABLE") throw error;
      pack = null; // No pack yet (e.g. the schema is pending): the next generation reads the new values.
    }
  } else {
    await moveAttempt(actor, a.id, "closed", {
      outcome: input.response === "reject" ? "declined_by_client" : "offer_expired",
      reasonText: input.note?.trim() || (input.response === "reject" ? "Client refused the counteroffer." : "The counteroffer expired without an answer."),
      why: `counteroffer_${status}`,
    });
  }
  await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_counteroffer_answered", targetId: a.id, metadata: { counterofferId: o.id, response: input.response, offeredMonthlyCents: o.offered_monthly_premium_cents, offeredFaceCents: o.offered_face_cents, fyc }, request: actor.request });
  return { status, fyc, welcomePack: pack };
}

/** The sweep (STATUS-MODEL §4, `now() > expires_at`), for a scheduler to call as service_role. */
export async function expireDueCounteroffers() {
  const { data, error } = await db().rpc("la3_expire_counteroffers");
  if (error) {
    if (isMissingSchema(error)) throw new SchemaPendingError("Counteroffer expiry");
    fail(error, "Could not expire counteroffers");
  }
  return rows<{ counteroffer_id: string; application_id: string }>(data);
}
