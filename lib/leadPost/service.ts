import "server-only";

// LA-2.5 · Accepting a real-time lead from a vendor.
//
// A lead posted by a vendor is scrubbed, queued at the top and on screen within seconds — while the
// person is still on the website. Calling within the first minute rather than half an hour later is
// the difference between a conversation and a voicemail.
//
// Two rules shape every decision here, and both come from the task rather than from taste:
//
//   REJECTIONS ARE THE BILLING MECHANISM. A litigator hit or a duplicate returned as a rejection is
//   a lead the tenant does not pay for. So every exit from this function records a `reason_code`
//   from a closed vocabulary, and the log keeps the raw payload — that row is what a vendor's
//   invoice is disputed against.
//
//   THE SCRUB FAILS CLOSED. "A scrub-vendor outage rejects rather than accepting unscrubbed." An
//   accepted lead is one somebody will dial, so an unscrubbed acceptance is a $500–$1,500 exposure
//   that arrives looking like a normal lead. Rejecting costs one lead; accepting costs a lawsuit.

// No timing-safe comparison here, deliberately. The key is looked up BY its SHA-256 hash, so the
// comparison is an indexed equality inside Postgres on a value an attacker cannot influence the
// length of — there is no string compare in this process to leak a timing signal. A
// timingSafeEqual on the hash against itself would look like a precaution and be none.
import { createHash, randomBytes } from "node:crypto";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveUnpartneredEntry } from "@/lib/pipelines/service";
import { claim, retryAfterSeconds, LEAD_POST_PER_KEY } from "@/lib/rateLimit";
import { notifyTenantAgents } from "@/lib/agentAlerts/service";
import { autoRoutePostedLead } from "@/lib/assignment/autoRoute";
import { screenPartnerPhone } from "@/lib/compliance/screening";
import { applyFieldMap } from "./fieldMap";
import { isMissingSchema } from "./schemaGap";
import { consentIpOf, consentTextOf, LEGACY_LOG_CODE, parseUsDateOfBirth, type ValidationReasonCode } from "./validation";

// The field map's reader lives in a plain module so the settings screen reads a map exactly the way
// this path applies it — including maps stored backwards by the old mint dialog. See fieldMap.ts.
export { applyFieldMap } from "./fieldMap";

export type PostReasonCode =
  | "accepted"
  | "duplicate"
  | "suppressed_litigator"
  | "suppressed_internal"
  | "suppressed_dnc"
  | "invalid_phone"
  | "missing_required_field"
  | "unknown_state"
  | "campaign_not_accepting"
  | "scrub_unavailable"
  | "rate_limited"
  | "unauthorised"
  // The Lead posting board's four (validation.ts): text, IP, date of birth, licence.
  | ValidationReasonCode;

export type PostOutcome = {
  status: number;
  outcome: "accepted" | "rejected" | "error";
  reasonCode: PostReasonCode;
  leadId: string | null;
  /** Plain-language, for a vendor engineer reading a 4xx at 2am. */
  message: string;
  retryAfterSeconds?: number;
};

/** Keys are shown once, at creation. Only the hash is stored. */
export function generatePostKey(): { key: string; hash: string; prefix: string } {
  const key = `lpk_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashPostKey(key), prefix: key.slice(0, 12) };
}

export function hashPostKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Ten digits, leading 1 dropped. Anything else is not a US phone and is not dialable. */
export function normalisePhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[0-9]{10}$/.test(ten) ? ten : null;
}

type KeyRow = {
  id: string;
  tenant_id: string;
  vendor_id: string;
  field_map: Record<string, string>;
  is_active: boolean;
  /** Bound campaign, if any. Absent until migration 20260924130000 is applied. */
  campaign_id?: string | null;
};

/**
 * The whole post path.
 *
 * Returns rather than throws for every rejection, because each one is a billing fact that must be
 * logged with its reason — an exception would lose the reason on the way out.
 */
export async function acceptPostedLead(input: {
  key: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  /** Set by the per-workspace URL (/api/post/<workspace>): the key must belong to that workspace. */
  workspaceId?: string | null;
}): Promise<PostOutcome> {
  const startedAt = Date.now();
  const supabase = getSupabaseServiceClient();

  // ── the key ───────────────────────────────────────────────────────────────
  const hash = hashPostKey(input.key);
  const readKey = (columns: string) =>
    supabase.from("tenant_vendor_post_keys").select(columns).eq("key_hash", hash).maybeSingle<KeyRow>();
  let { data: keyRow, error: keyError } = await readKey("id, tenant_id, vendor_id, field_map, is_active, campaign_id");
  // Before the campaign-binding column exists every key is unbound, which is what it was.
  if (isMissingSchema(keyError)) ({ data: keyRow, error: keyError } = await readKey("id, tenant_id, vendor_id, field_map, is_active"));

  if (keyError) {
    return { status: 500, outcome: "error", reasonCode: "unauthorised", leadId: null, message: "The key could not be checked." };
  }
  if (!keyRow || !keyRow.is_active) {
    // Same answer for "no such key" and "key disabled": telling the caller which one would let
    // somebody enumerate valid keys.
    return { status: 401, outcome: "rejected", reasonCode: "unauthorised", leadId: null, message: "That posting key is not valid." };
  }

  const log = async (outcome: PostOutcome, extra: { campaignId?: string | null } = {}) => {
    const row = {
      tenant_id: keyRow.tenant_id,
      vendor_id: keyRow.vendor_id,
      campaign_id: extra.campaignId ?? null,
      completed_at: new Date().toISOString(),
      outcome: outcome.outcome,
      reason_code: outcome.reasonCode,
      lead_id: outcome.leadId,
      raw_payload: input.payload as never,
      processing_ms: Date.now() - startedAt,
      http_status: outcome.status,
      idempotency_key: input.idempotencyKey,
    };
    // Which key the post arrived on, so the settings screen can count posts per key. Retried
    // without it until the column exists: losing the key id is fine, losing the log row is not —
    // it is what the vendor's invoice is disputed against.
    let { error } = await supabase.from("tenant_lead_post_log").insert({ ...row, key_id: keyRow.id } as never);
    if (isMissingSchema(error)) ({ error } = await supabase.from("tenant_lead_post_log").insert(row));
    // The four newer reason codes need 20260924240000 in the log's check constraint. Until then the
    // row is kept under the nearest older code; the vendor was still answered with the precise one.
    const legacy = LEGACY_LOG_CODE[outcome.reasonCode as ValidationReasonCode];
    if (error?.code === "23514" && legacy) {
      const older = { ...row, reason_code: legacy };
      ({ error } = await supabase.from("tenant_lead_post_log").insert({ ...older, key_id: keyRow.id } as never));
      if (isMissingSchema(error)) await supabase.from("tenant_lead_post_log").insert(older);
    }
    return outcome;
  };

  // The per-workspace URL names the workspace; a key from another one is refused as an invalid key
  // would be, and logged against the key's own workspace so its owner can see the misdirected post.
  if (input.workspaceId && input.workspaceId !== keyRow.tenant_id) {
    return log({ status: 401, outcome: "rejected", reasonCode: "unauthorised", leadId: null, message: "That posting key is not valid for this URL. Post to the URL your key was issued with." });
  }

  // ── rate limit, per key ───────────────────────────────────────────────────
  const limited = await claim(LEAD_POST_PER_KEY, keyRow.id);
  if (!limited.allowed) {
    return log({
      status: 429,
      outcome: "rejected",
      reasonCode: "rate_limited",
      leadId: null,
      message: "Too many posts on this key. Slow down and retry.",
      retryAfterSeconds: retryAfterSeconds(limited.rule),
    });
  }

  // ── idempotency ───────────────────────────────────────────────────────────
  if (input.idempotencyKey) {
    const { data: seen } = await supabase
      .from("tenant_lead_post_log")
      .select("lead_id, outcome, reason_code, http_status")
      .eq("tenant_id", keyRow.tenant_id)
      .eq("vendor_id", keyRow.vendor_id)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle<{ lead_id: string | null; outcome: string; reason_code: PostReasonCode; http_status: number }>();

    // A retry replays the original answer rather than creating a second lead — and rather than
    // reporting a duplicate, which would be a rejection the vendor is not paid for twice over.
    if (seen) {
      return {
        status: seen.http_status,
        outcome: seen.outcome as PostOutcome["outcome"],
        reasonCode: seen.reason_code,
        leadId: seen.lead_id,
        message: "This post was already processed.",
      };
    }
  }

  const values = applyFieldMap(input.payload, keyRow.field_map ?? {});

  // ── validate ──────────────────────────────────────────────────────────────
  const phone = normalisePhone(values.phone ?? values.phone_number ?? values.primary_phone);
  if (!phone) {
    return log({ status: 422, outcome: "rejected", reasonCode: "invalid_phone", leadId: null, message: "No usable ten-digit US phone number was supplied." });
  }

  const state = typeof values.state === "string" && /^[A-Za-z]{2}$/.test(values.state.trim())
    ? values.state.trim().toUpperCase()
    : null;
  if (!state) {
    // Not pedantry: LA-2.4 refuses to dial a lead with no state, because there is no way to know
    // its local time. Accepting one would mean paying for a lead nobody may legally call.
    return log({ status: 422, outcome: "rejected", reasonCode: "unknown_state", leadId: null, message: "A two-letter state is required; without it the lead cannot legally be dialled." });
  }

  const firstName = typeof values.first_name === "string" ? values.first_name.trim() : "";
  const lastName = typeof values.last_name === "string" ? values.last_name.trim() : "";
  if (!firstName && !lastName && typeof values.full_name !== "string") {
    return log({ status: 422, outcome: "rejected", reasonCode: "missing_required_field", leadId: null, message: "A name is required." });
  }

  // Consent, as the Lead posting board states it: the text the person agreed to, and the IP they
  // agreed from. Without either there is no record that this person asked to be called, and a lead
  // nobody may call is a lead the agency should not pay for. (A missing TrustedForm or Jornaya
  // certificate is still only flagged — see captureConsentArtefact.)
  const consentText = consentTextOf(values);
  if (!consentText) {
    return log({ status: 422, outcome: "rejected", reasonCode: "missing_consent_text", leadId: null, message: "The consent text the person agreed to is required (consent_text), stored verbatim." });
  }
  const consentIp = consentIpOf(values);
  if (!consentIp) {
    return log({ status: 422, outcome: "rejected", reasonCode: "missing_consent_ip", leadId: null, message: "The IP address consent was given from is required (consent_ip), as an IPv4 or IPv6 address." });
  }

  // Read month-first, as US vendors send it, and stored as YYYY-MM-DD. Absent is allowed; sent and
  // unreadable is not, because a wrong date of birth is a wrong quote.
  const dateOfBirth = parseUsDateOfBirth(values.date_of_birth);
  if (dateOfBirth.status === "invalid") {
    return log({ status: 422, outcome: "rejected", reasonCode: "invalid_date_of_birth", leadId: null, message: "The date of birth could not be read. Send MM/DD/YYYY or YYYY-MM-DD, a real date in the past." });
  }

  // ── the campaign must be accepting ───────────────────────────────────────
  // campaigns_servable carries LA-2.3's scrub gate as well as the active check, so an unscrubbed
  // campaign cannot take real-time leads either. One gate, read from one place.
  //
  // A key bound to a campaign posts to that campaign or not at all. An unbound key takes the
  // vendor's accepting campaign, as every key did before binding existed.
  let campaignQuery = supabase
    .from("campaigns_servable")
    .select("id")
    .eq("tenant_id", keyRow.tenant_id)
    .eq("vendor_id", keyRow.vendor_id);
  if (keyRow.campaign_id) campaignQuery = campaignQuery.eq("id", keyRow.campaign_id);
  const { data: campaign, error: campaignError } = await campaignQuery.limit(1).maybeSingle<{ id: string }>();

  if (campaignError) {
    return log({ status: 503, outcome: "error", reasonCode: "campaign_not_accepting", leadId: null, message: "The campaign could not be checked." });
  }
  if (!campaign) {
    return log({ status: 409, outcome: "rejected", reasonCode: "campaign_not_accepting", leadId: null, message: keyRow.campaign_id ? "The campaign this key is bound to is not active and scrubbed, so it is not accepting leads." : "No active, scrubbed campaign for this vendor is accepting leads." });
  }

  // ── the agency must be licensed in the lead's state ──────────────────────
  // The same rule assignment and the dialer apply (assignment_candidate_is_eligible): a licence in
  // that state that has not expired. A lead in a state nobody here may sell in is one nobody may
  // work, so it is refused rather than paid for.
  const { data: licence, error: licenceError } = await supabase
    .from("licenses")
    .select("expires_at")
    .eq("tenant_id", keyRow.tenant_id)
    .eq("state", state)
    .maybeSingle<{ expires_at: string | null }>();
  if (licenceError) {
    return log({ status: 503, outcome: "error", reasonCode: "state_not_licensed", leadId: null, message: "The agency's licences could not be checked. Retry shortly." }, { campaignId: campaign.id });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!licence || (licence.expires_at !== null && licence.expires_at < today)) {
    return log({
      status: 422,
      outcome: "rejected",
      reasonCode: "state_not_licensed",
      leadId: null,
      message: licence ? `The agency's ${state} licence has expired, so ${state} leads are not accepted.` : `The agency is not licensed in ${state}, so ${state} leads are not accepted.`,
    }, { campaignId: campaign.id });
  }

  // ── the scrub, synchronously, failing closed ─────────────────────────────
  const { data: suppression, error: scrubError } = await supabase
    .rpc("is_phone_suppressed", { p_tenant_id: keyRow.tenant_id, p_phone: phone });

  if (scrubError) {
    // The criterion, exactly: reject rather than accept unscrubbed.
    return log({
      status: 503,
      outcome: "rejected",
      reasonCode: "scrub_unavailable",
      leadId: null,
      message: "The suppression check is unavailable, so this lead cannot be accepted. Retry shortly.",
    }, { campaignId: campaign.id });
  }

  const hit = Array.isArray(suppression) ? suppression[0] : suppression;
  if (hit?.suppressed) {
    const code: PostReasonCode =
      hit.list_type === "tcpa_litigator" ? "suppressed_litigator"
      : hit.list_type === "internal" ? "suppressed_internal"
      : "suppressed_dnc";
    return log({
      status: 409,
      outcome: "rejected",
      reasonCode: code,
      leadId: null,
      message: `This number is suppressed (${hit.list_type}) and will not be accepted.`,
    }, { campaignId: campaign.id });
  }

  // ── the vendor scrub: litigator and federal/state DNC ──────────────────────
  //
  // is_phone_suppressed above reads only the tenant's own lists. A litigator or registry DNC number
  // the vendor sold was accepted and queued until the dial preflight caught it (found 2026-09-25).
  // This is the screening every import row gets, with the same cache and meters, failing closed.
  let screening: Awaited<ReturnType<typeof screenPartnerPhone>> | null = null;
  try {
    screening = await screenPartnerPhone({ tenantId: keyRow.tenant_id, partnerId: null, userId: null, phone });
  } catch {
    screening = null;
  }
  if (!screening || screening.outcome === "unavailable") {
    return log({
      status: 503,
      outcome: "rejected",
      reasonCode: "scrub_unavailable",
      leadId: null,
      message: "The litigator and do-not-call check is unavailable, so this lead cannot be accepted. Retry shortly.",
    }, { campaignId: campaign.id });
  }
  if (screening.outcome === "invalid_phone") {
    return log({ status: 422, outcome: "rejected", reasonCode: "invalid_phone", leadId: null, message: "No usable ten-digit US phone number was supplied." }, { campaignId: campaign.id });
  }
  if (screening.outcome === "tcpa_litigator" || screening.outcome === "dnc") {
    return log({
      status: 409,
      outcome: "rejected",
      reasonCode: screening.outcome === "tcpa_litigator" ? "suppressed_litigator" : "suppressed_dnc",
      leadId: null,
      message: screening.outcome === "tcpa_litigator"
        ? "This number matched a TCPA litigator list and will not be accepted."
        : "This number is on a do-not-call registry and will not be accepted.",
    }, { campaignId: campaign.id });
  }

  // ── dedupe ────────────────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("agent_leads")
    .select("id")
    .eq("tenant_id", keyRow.tenant_id)
    .eq("values->>phone", phone)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing) {
    return log({ status: 409, outcome: "rejected", reasonCode: "duplicate", leadId: existing.id, message: "This person is already in the system." }, { campaignId: campaign.id });
  }

  // ── accept ────────────────────────────────────────────────────────────────
  //
  // agent_leads.template_id is NOT NULL with no default: a lead belongs to the intake template that
  // defines its fields. A posted lead has no template of its own, so it takes the tenant's active
  // one for the product — which is also what makes the lead openable in the workspace, since the
  // form renders from that template.
  const productLine = typeof values.product_line === "string" ? values.product_line : "term_life";

  // Taken from the tenant's existing leads rather than from a template query.
  //
  // agent_leads.template_id references `templates`, and which template a tenant uses for a product
  // is already settled by whatever created its other leads. Re-deriving it here would be a second
  // opinion about the same question, and the two would diverge the first time a template was
  // versioned. Reading the answer the tenant is already using cannot diverge.
  const { data: template } = await supabase
    .from("agent_leads")
    .select("template_id, template_version")
    .eq("tenant_id", keyRow.tenant_id)
    .eq("product_line", productLine)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ template_id: string; template_version: number }>();

  if (!template) {
    // Refused rather than invented. A lead attached to no template is a lead no screen can open,
    // and a vendor billed for it would be billed for something unusable.
    return log({
      status: 409,
      outcome: "rejected",
      reasonCode: "campaign_not_accepting",
      leadId: null,
      message: `This workspace has no intake template for ${productLine} yet, so the lead cannot be accepted.`,
    }, { campaignId: campaign.id });
  }

  // LA-1.9 criterion 5: "A lead's stage is stored once, as an id."
  //
  // Both writes below set only the legacy `stage_key` text, so a posted lead landed on no pipeline
  // stage at all — neither the lead row nor its queue row. Every other intake path resolves a real
  // stage through `resolveRuntimeStage`.
  //
  // This is a latent defect rather than an observed one: on 2026-09-22 no row in `agent_leads` had
  // `posted_at` set, so this path had never accepted a lead on this project. (The five queue rows
  // that do have a null `stage_id` are older rows from elsewhere, with varied `stage_key` values —
  // not this path's doing.) Fixing it before it runs is cheaper than reconciling the rows afterwards.
  //
  // Resolution is best-effort on purpose. `resolveRuntimeStage` throws when a tenant has no default
  // marketing pipeline, and this file's own rule is that a lead created but never queued "is a lead
  // nobody will ever see". An unstaged row is recoverable; a missing lead is not. So a failure here
  // writes exactly what it wrote before rather than costing the lead.
  let postedStage: { pipelineId: string; stageId: string } | null = null;
  try {
    // A posted lead has no partner: the default pipeline with no partner type when there is one,
    // otherwise the default marketing pipeline's entry stage, as before.
    const resolved = await resolveUnpartneredEntry(keyRow.tenant_id);
    postedStage = { pipelineId: resolved.pipelineId, stageId: resolved.stage.id };
  } catch {
    postedStage = null;
  }

  const { data: created, error: createError } = await supabase
    .from("agent_leads")
    .insert({
      tenant_id: keyRow.tenant_id,
      campaign_id: campaign.id,
      template_id: template.template_id,
      template_version: template.template_version,
      product_line: productLine,
      posted_at: new Date().toISOString(),
      // The same screening stamp an imported row carries, so claims and the dialer see the result.
      screening_result_id: screening.resultId,
      screening_version: screening.version,
      screening_outcome: screening.outcome,
      screening_warning: screening.warning,
      screening_checked_at: screening.checkedAt,
      ...(postedStage ? { pipeline_id: postedStage.pipelineId, stage_id: postedStage.stageId } : {}),
      values: {
        ...values,
        phone,
        state,
        consent_ip: consentIp,
        ...(dateOfBirth.status === "ok" ? { date_of_birth: dateOfBirth.iso } : {}),
      },
    // The insert is cast because `values` is jsonb and the generated Json type does not accept a
    // bare Record<string, unknown>. Widening the column's declared type to satisfy the compiler
    // would make every other reader of it less safe, so the cast is kept local to this one write.
    } as never)
    .select("id")
    .single<{ id: string }>();

  if (createError || !created) {
    return log({ status: 500, outcome: "error", reasonCode: "missing_required_field", leadId: null, message: `The lead could not be created: ${createError?.message ?? "unknown"}` }, { campaignId: campaign.id });
  }

  const { error: queueError } = await supabase.from("lead_queue").insert({
    tenant_id: keyRow.tenant_id,
    lead_id: created.id,
    product_line: productLine,
    ...(postedStage ? { pipeline_id: postedStage.pipelineId, stage_id: postedStage.stageId } : {}),
    stage_key: "new",
    // `unclaimed`, not `queued`. The vocabulary is LA-1.14's: a work item nobody has picked up is
    // unclaimed, and `queued` is not one of the nine values the check constraint allows.
    status: "unclaimed",
    // Tier 0: ahead of every list lead, regardless of scoring. This is the criterion.
    tier: 0,
  } as never);

  // Reported, not swallowed. A lead created but never queued is a lead nobody will ever see, and
  // from the vendor's side it would look like a successful post.
  if (queueError) {
    return log({
      status: 500,
      outcome: "error",
      reasonCode: "campaign_not_accepting",
      leadId: created.id,
      message: `The lead was created but could not be queued: ${queueError.message}`,
    }, { campaignId: campaign.id });
  }

  await supabase.from("tenant_vendor_post_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id);

  // LA-2.6 · the consent artefact arrives on the same call. Flagged, never blocking: many
  // legitimate lists carry none, and refusing them would throw away leads that were paid for.
  await captureConsentArtefact(keyRow.tenant_id, created.id, values);

  // Lead assignment › "Route posted leads on arrival" (off unless the tenant turned it on). Through
  // the tenant's real-time rules only, behind every gate the router applies; a lead nobody may take
  // stays in the pool. Never throws: the post is already accepted and queued.
  await autoRoutePostedLead(keyRow.tenant_id, created.id);

  // LA-2.5 · make an accepted post visible to the agent surface before returning. Alert delivery is
  // deliberately isolated from lead acceptance: an alert-table outage must not make a vendor
  // retry a successful post and create a duplicate. The durable notification is idempotent by key.
  await notifyTenantAgents({
    tenantId: keyRow.tenant_id,
    roles: ["owner", "producer", "assistant"],
    kind: "new_unclaimed_lead",
    title: "New real-time lead available",
    // Not "in the Agent Floor": a posted lead has no partner, so it is a dialer lead and the inbound
    // inbox and floor never list it (20260924160000). The link still opens it.
    body: "A new lead was posted and is queued for the dialer.",
    link: `/app/leads/${created.id}`,
    sourceKey: `lead-post:${created.id}`,
  }).catch((error) => {
    // The lead and queue remain authoritative; the next queue refresh still exposes the work.
    console.error(`[lead-post] agent alert not stored for lead ${created.id}: ${error instanceof Error ? error.message : "unknown error"}`);
  });

  return log({ status: 201, outcome: "accepted", reasonCode: "accepted", leadId: created.id, message: "Accepted." }, { campaignId: campaign.id });
}

/**
 * LA-2.6 · record whatever consent evidence came with the post.
 *
 * `pending` rather than `claimed`: we have a URL, not a copy. An unclaimed TrustedForm certificate
 * expires, so claiming it is a separate step against the provider's API — and one that needs real
 * credentials, which is why it is not done here. Recording the URL now is what makes the claim
 * possible later; discarding it because we cannot claim it yet would be the expensive mistake.
 */
export async function captureConsentArtefact(
  tenantId: string,
  leadId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const certificateUrl =
    typeof values.trusted_form_cert_url === "string" ? values.trusted_form_cert_url
    : typeof values.trustedform_url === "string" ? values.trustedform_url
    : typeof values.jornaya_leadid === "string" ? values.jornaya_leadid
    : null;

  if (!certificateUrl) return;

  const provider = /trustedform/i.test(certificateUrl) ? "trustedform"
    : typeof values.jornaya_leadid === "string" ? "jornaya"
    : "other";

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("tenant_consent_artefacts").insert({
    tenant_id: tenantId,
    lead_id: leadId,
    provider,
    certificate_url: certificateUrl,
    certificate_id: typeof values.jornaya_leadid === "string" ? values.jornaya_leadid : null,
    consent_timestamp: typeof values.consent_timestamp === "string" ? values.consent_timestamp : null,
    ip: typeof values.consent_ip === "string" ? values.consent_ip : typeof values.ip === "string" ? values.ip : null,
    source_url: typeof values.source_url === "string" ? values.source_url : null,
    landing_page: typeof values.landing_page === "string" ? values.landing_page : null,
    capture_status: "pending",
  });

  // Never fatal. A lead accepted and then lost because its certificate could not be filed would be
  // a worse outcome than a lead held without one, which the task explicitly permits.
  if (error) console.error(`[lead-post] consent artefact not stored for lead ${leadId}: ${error.message}`);
}
