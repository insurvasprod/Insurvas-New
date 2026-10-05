import "server-only";

import { startApplicationFromLead } from "@/lib/outboundApplication/service";
import { appointmentIsActiveAt } from "@/lib/appointments/eligibility";
import { maskFromLast4, normaliseProse } from "./formats";
import { prefillFromLead } from "./prefill";
import { encryptSensitive } from "./crypto";
import { fieldSetRequired, interviewQuestions, type StoredDefinition } from "./templates";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError } from "./db";
import { effectiveCarrierFacts } from "@/lib/salesSettings/carriers";
import { resolveSalesSettings } from "@/lib/salesSettings/schema";
import type { CarrierFacts } from "@/lib/salesSettings/views";
import type {
  ApplicationListRow, AttemptView, BeneficiaryView, CaseView, CounterofferView, DisclosureView, FieldValue,
  InterviewView, PaymentView, QuoteView, RequirementView, SubmissionView,
} from "./types";
import { PRODUCT_LABEL } from "./constants";
import type { ApplicationOutcome, ApplicationStatus, InsuredRole, OutcomeReasonCode, PaymentMethod, ValueSource } from "./constants";

/**
 * LA-3 reads: the case the workspace renders, and the Applications list. Every query names the
 * tenant. Sensitive values leave this module masked — the reveal path is ./sensitive.ts, and it is
 * the only place ciphertext is read back.
 */

type CaseRow = { id: string; tenant_id: string; lead_id: string; work_item_id: string | null; product_line: string; source: "inbound" | "outbound" | "manual"; status: string; campaign_id: string | null; opened_at: string };
type AttemptRow = {
  id: string; case_id: string; lead_id: string; insured_role: InsuredRole; attempt_no: number; carrier_id: string | null; product_code: string | null;
  carrier_product_id: string | null; quote_id: string | null; status: ApplicationStatus; outcome: ApplicationOutcome | null; outcome_reason_code: string | null;
  outcome_reason_text: string | null; draft_day: number | null; created_at: string; submitted_at: string | null; closed_at: string | null; updated_at: string;
};
type ValueRow = { application_id: string; field_key: string; value: unknown; value_last4: string | null; value_ciphertext?: string | null; source: ValueSource; linked_to_primary: boolean; reviewed_at: string | null };
type PaymentRow = {
  application_id: string; method: PaymentMethod; routing_last4: string | null; account_last4: string | null; account_type: "checking" | "savings" | null; bank_name: string | null;
  name_on_account: string | null; card_last4: string | null; card_exp_month: number | null; card_exp_year: number | null; card_brand: string | null; name_on_card: string | null;
  billing_frequency: PaymentView["billingFrequency"]; draft_income_type: PaymentView["incomeType"]; draft_income_inputs: Record<string, unknown> | null;
  draft_day_recommended: number | null; draft_day_override_reason: string | null; linked_to_primary: boolean;
};

const PAYMENT_COLUMNS = "application_id, method, routing_last4, account_last4, account_type, bank_name, name_on_account, card_last4, card_exp_month, card_exp_year, card_brand, name_on_card, billing_frequency, draft_income_type, draft_income_inputs, draft_day_recommended, draft_day_override_reason, linked_to_primary";

function leadName(values: Record<string, unknown>) {
  const full = typeof values.full_name === "string" ? values.full_name.trim() : "";
  if (full) return full;
  return [values.first_name, values.last_name].filter((v) => typeof v === "string" && v.trim()).join(" ").trim() || "Unnamed client";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Optional reads for tables a later step adds: absent schema reads as empty, never as an error. */
async function optional<T>(query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error && isMissingSchema(error)) return [];
  if (error) throw new ApplicationError("APPLICATION_UNAVAILABLE", error.message ?? "Could not load the application", 500);
  return rows<T>(data);
}

// ── start (the one doorway) ────────────────────────────────────────────────

/**
 * Open or resume the case for a work item, and make sure the primary insured has a live attempt with
 * the lead's values prefilled. Inbound, outbound and lead-detail all call this (build it once): the
 * verification session, case and deal row come from the LA-2.14 RPC, unchanged.
 */
export async function startApplication(input: { tenantId: string; userId: string; workItemId: string; productLine?: string | null }) {
  const started = await startApplicationFromLead({ tenantId: input.tenantId, workItemId: input.workItemId, userId: input.userId, productLine: input.productLine ?? null });
  await ensurePrimaryAttempt({ tenantId: input.tenantId, userId: input.userId, caseId: started.applicationCaseId });
  return started;
}

export async function ensurePrimaryAttempt(input: { tenantId: string; userId: string; caseId: string; insuredRole?: InsuredRole }) {
  const role = input.insuredRole ?? "primary";
  const client = db();
  const existing = await client.from("tenant_applications").select("id").eq("tenant_id", input.tenantId).eq("case_id", input.caseId).eq("insured_role", role).limit(1);
  if (isMissingSchema(existing.error)) throw new SchemaPendingError("The application record");
  if (existing.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", existing.error.message, 500);
  if (rows(existing.data).length) return rows<{ id: string }>(existing.data)[0].id;

  const kase = await client.from("tenant_application_cases").select("id, lead_id, product_line").eq("tenant_id", input.tenantId).eq("id", input.caseId).maybeSingle();
  if (kase.error || !kase.data) throw new ApplicationError("CASE_NOT_FOUND", "That case could not be found.", 404);
  const created = await client.from("tenant_applications").insert({
    tenant_id: input.tenantId, case_id: input.caseId, lead_id: kase.data.lead_id, insured_role: role, attempt_no: 1,
    product_code: kase.data.product_line ?? null, created_by: input.userId,
  }).select("id").single();
  if (created.error) {
    // Two tabs opening the same case: the one-live-attempt index already has the row.
    if (created.error.code === "23505") return ensurePrimaryAttempt(input);
    throw new ApplicationError("APPLICATION_UNAVAILABLE", created.error.message, 500);
  }
  const applicationId = created.data.id as string;
  if (role === "primary") {
    const lead = await client.from("agent_leads").select("values").eq("tenant_id", input.tenantId).eq("id", kase.data.lead_id).maybeSingle();
    const values = (lead.data?.values ?? {}) as Record<string, unknown>;
    const prefill = prefillFromLead(values).map((p) => {
      if (p.sensitive) {
        const enc = encryptSensitive(String(p.value), { tenantId: input.tenantId, applicationId, fieldKey: p.key });
        return { application_id: applicationId, tenant_id: input.tenantId, field_key: p.key, value: null, value_ciphertext: enc.ciphertext, value_last4: String(p.value).slice(-4), key_version: enc.keyVersion, source: "lead", updated_by: input.userId };
      }
      return { application_id: applicationId, tenant_id: input.tenantId, field_key: p.key, value: p.value, source: "lead", updated_by: input.userId };
    });
    if (prefill.length) {
      const ins = await client.from("tenant_application_values").upsert(prefill, { onConflict: "application_id,field_key", ignoreDuplicates: true });
      if (ins.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", ins.error.message, 500);
    }
  }
  return applicationId;
}

// ── the case ───────────────────────────────────────────────────────────────

export async function getCaseView(tenantId: string, caseId: string): Promise<CaseView> {
  const client = db();
  const kase = await client.from("tenant_application_cases").select("id, tenant_id, lead_id, work_item_id, product_line, source, status, campaign_id, opened_at").eq("tenant_id", tenantId).eq("id", caseId).maybeSingle();
  if (kase.error && !isMissingSchema(kase.error)) throw new ApplicationError("APPLICATION_UNAVAILABLE", kase.error.message, 500);
  if (!kase.data) throw new ApplicationError("CASE_NOT_FOUND", "That case could not be found.", 404);
  const c = kase.data as CaseRow;

  const attemptsQ = await client.from("tenant_applications").select("id, case_id, lead_id, insured_role, attempt_no, carrier_id, product_code, carrier_product_id, quote_id, status, outcome, outcome_reason_code, outcome_reason_text, draft_day, created_at, submitted_at, closed_at, updated_at").eq("tenant_id", tenantId).eq("case_id", caseId).order("attempt_no");
  if (isMissingSchema(attemptsQ.error)) throw new SchemaPendingError("The application record");
  if (attemptsQ.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", attemptsQ.error.message, 500);
  const attempts = rows<AttemptRow>(attemptsQ.data);
  const ids = attempts.map((a) => a.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const inIds = ids.length ? ids : none;

  const [lead, campaign, values, payments, beneficiaries, disclosures, quotes, requirements, counteroffers, submissions, packs, interviews] = await Promise.all([
    client.from("agent_leads").select("values").eq("tenant_id", tenantId).eq("id", c.lead_id).maybeSingle(),
    c.campaign_id ? client.from("tenant_campaigns").select("name").eq("tenant_id", tenantId).eq("id", c.campaign_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    optional<ValueRow>(client.from("tenant_application_values").select("application_id, field_key, value, value_last4, source, linked_to_primary, reviewed_at").eq("tenant_id", tenantId).in("application_id", inIds)),
    optional<PaymentRow>(client.from("tenant_application_payment_methods").select(PAYMENT_COLUMNS).eq("tenant_id", tenantId).in("application_id", inIds)),
    optional<{ id: string; application_id: string; tier: "primary" | "contingent"; first_name: string; last_name: string; relationship: BeneficiaryView["relationship"]; relationship_other: string | null; dob: string | null; share_bp: number; phone: string | null; sort_order: number }>(
      client.from("tenant_application_beneficiaries").select("id, application_id, tier, first_name, last_name, relationship, relationship_other, dob, share_bp, phone, sort_order").eq("tenant_id", tenantId).in("application_id", inIds).order("sort_order")),
    optional<{ application_id: string; disclosure_id: string; disclosure_version: number; status: DisclosureView["status"]; method: DisclosureView["method"]; note: string | null; acknowledged_by: string | null; acknowledged_at: string | null }>(
      client.from("tenant_application_disclosures").select("application_id, disclosure_id, disclosure_version, status, method, note, acknowledged_by, acknowledged_at").eq("tenant_id", tenantId).in("application_id", inIds)),
    optional<{ id: string; application_id: string | null; insured_role: InsuredRole; carrier_id: string; carrier_product_id: string | null; product_code: string; tier: string; term_length: number | null; assumed_health_class: string | null; face_amount_cents: number; monthly_premium_cents: number; annual_premium_cents: number | null; age_used: number | null; riders: { name: string; monthly_premium_cents: number }[] | null; warnings: { code: string; message: string }[] | null; status: QuoteView["status"]; created_at: string }>(
      client.from("tenant_quotes").select("id, application_id, insured_role, carrier_id, carrier_product_id, product_code, tier, term_length, assumed_health_class, face_amount_cents, monthly_premium_cents, annual_premium_cents, age_used, riders, warnings, status, created_at").eq("tenant_id", tenantId).eq("case_id", caseId).order("created_at")),
    optional<{ id: string; application_id: string; kind: RequirementView["kind"]; description: string; waiting_on: RequirementView["waitingOn"]; status: RequirementView["status"]; raised_at: string; due_at: string | null; last_chased_at: string | null; chase_count: number; exam_vendor: string | null; exam_ordered_on: string | null; exam_scheduled_on: string | null; exam_completed_on: string | null; exam_results_on: string | null }>(
      client.from("tenant_application_requirements").select("id, application_id, kind, description, waiting_on, status, raised_at, due_at, last_chased_at, chase_count, exam_vendor, exam_ordered_on, exam_scheduled_on, exam_completed_on, exam_results_on").eq("tenant_id", tenantId).in("application_id", inIds).order("raised_at")),
    optional<{ id: string; application_id: string; received_at: string; offered_tier: string | null; offered_health_class: string | null; offered_face_cents: number; offered_monthly_premium_cents: number; reason_text: string | null; reason_code: string | null; expires_at: string; status: CounterofferView["status"] }>(
      client.from("tenant_application_counteroffers").select("id, application_id, received_at, offered_tier, offered_health_class, offered_face_cents, offered_monthly_premium_cents, reason_text, reason_code, expires_at, status").eq("tenant_id", tenantId).in("application_id", inIds).order("received_at")),
    optional<{ id: string; application_id: string; attempt_no: number; carrier_reference: string | null; reference_kind: SubmissionView["referenceKind"]; policy_number: string | null; submitted_at: string; submitted_via: SubmissionView["submittedVia"]; confirmation_path: string | null; qa_verdict: { verdict?: SubmissionView["qaVerdict"] } | null }>(
      client.from("tenant_application_submissions").select("id, application_id, attempt_no, carrier_reference, reference_kind, policy_number, submitted_at, submitted_via, confirmation_path, qa_verdict").eq("tenant_id", tenantId).in("application_id", inIds).order("submitted_at")),
    optional<{ application_id: string; email_status: NonNullable<AttemptView["welcomePack"]>["status"]; recipient_email: string | null; sent_at: string | null }>(
      client.from("tenant_welcome_packs").select("application_id, email_status, recipient_email, sent_at").eq("tenant_id", tenantId).in("application_id", inIds)),
    optional<{ id: string; insured_role: InsuredRole; sales_template_id: string | null; template_version: number | null; started_at: string; completed_at: string | null }>(
      client.from("tenant_uw_interviews").select("id, insured_role, sales_template_id, template_version, started_at, completed_at").eq("tenant_id", tenantId).eq("case_id", caseId)),
  ]);

  const leadValues = ((lead as { data: { values?: Record<string, unknown> } | null }).data?.values ?? {}) as Record<string, unknown>;
  const clientState = typeof leadValues.state === "string" ? leadValues.state.toUpperCase() : null;

  // Carriers, products, appointments, disclosure library, portal accounts, field sets, templates.
  const carrierIds = [...new Set([...attempts.map((a) => a.carrier_id), ...quotes.map((q) => q.carrier_id)].filter((x): x is string => Boolean(x)))];
  const productIds = [...new Set([...attempts.map((a) => a.carrier_product_id), ...quotes.map((q) => q.carrier_product_id)].filter((x): x is string => Boolean(x)))];
  const disclosureIds = [...new Set(disclosures.map((d) => d.disclosure_id))];
  const interviewIds = interviews.map((i) => i.id);
  const templateIds = [...new Set(interviews.map((i) => i.sales_template_id).filter((x): x is string => Boolean(x)))];
  // The agency's own portal origin where it set one (LA-3.17), else the library's. Started with the
  // batch below so it costs no extra round trip.
  const carrierFactsRead = effectiveCarrierFacts(tenantId, carrierIds).catch(() => new Map<string, CarrierFacts>());
  const [carriers, products, appointments, library, portals, fieldSets, templates, answers, medications, schedules] = await Promise.all([
    carrierIds.length ? optional<{ id: string; name: string; portal_origin: string | null }>(client.from("carriers").select("id, name, portal_origin").in("id", carrierIds)) : Promise.resolve([]),
    productIds.length ? optional<{ id: string; name: string; issue_age_min: number | null; issue_age_max: number | null; face_min_cents: number | null; face_max_cents: number | null; accepted_payment_methods: PaymentMethod[] | null; premium_per_1000_band_min: number | string | null; premium_per_1000_band_max: number | string | null }>(client.from("carrier_products").select("id, name, issue_age_min, issue_age_max, face_min_cents, face_max_cents, accepted_payment_methods, premium_per_1000_band_min, premium_per_1000_band_max").in("id", productIds).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)) : Promise.resolve([]),
    carrierIds.length ? optional<{ carrier_id: string; state: string; status: "pending" | "active" | "terminated"; effective_from: string; terminated_at: string | null; expires_at: string | null }>(client.from("appointments").select("carrier_id, state, status, effective_from, terminated_at, expires_at").eq("tenant_id", tenantId).in("carrier_id", carrierIds)) : Promise.resolve([]),
    disclosureIds.length ? optional<{ id: string; code: string; title: string; body_markdown: string; version: number }>(client.from("application_disclosures").select("id, code, title, body_markdown, version").in("id", disclosureIds)) : Promise.resolve([]),
    carrierIds.length ? optional<{ carrier_id: string; portal_url: string; username: string }>(client.from("tenant_carrier_portal_accounts").select("carrier_id, portal_url, username").eq("tenant_id", tenantId).in("carrier_id", carrierIds)) : Promise.resolve([]),
    optional<{ tenant_id: string | null; carrier_id: string | null; product_code: string; definition: StoredDefinition }>(client.from("sales_templates").select("tenant_id, carrier_id, product_code, definition, version").eq("kind", "application_field_set").eq("status", "published").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).order("version", { ascending: false })),
    templateIds.length ? optional<{ id: string; name: string; version: number; definition: StoredDefinition }>(client.from("sales_templates").select("id, name, version, definition").in("id", templateIds)) : Promise.resolve([]),
    interviewIds.length ? optional<{ interview_id: string; question_key: string; value: unknown; notes: string | null }>(client.from("tenant_uw_answers").select("interview_id, question_key, value, notes").eq("tenant_id", tenantId).in("interview_id", interviewIds)) : Promise.resolve([]),
    interviewIds.length ? optional<{ id: string; interview_id: string; name: string; dose: string | null; since: string | null; prescribed_for: string | null; prescribed_for_unknown: boolean; notes: string | null }>(client.from("tenant_medications").select("id, interview_id, name, dose, since, prescribed_for, prescribed_for_unknown, notes, sort_order").eq("tenant_id", tenantId).in("interview_id", interviewIds).order("sort_order")) : Promise.resolve([]),
    carrierIds.length ? optional<{ carrier_id: string; product_code: string; contract_level_bp: number; policy_year: number; rate_bp: number; effective_from: string }>(client.from("commission_schedules").select("carrier_id, product_code, contract_level_bp, policy_year, rate_bp, effective_from").eq("tenant_id", tenantId).eq("policy_year", 1).in("carrier_id", carrierIds)) : Promise.resolve([]),
  ]);
  const ackUserIds = [...new Set(disclosures.map((d) => d.acknowledged_by).filter((x): x is string => Boolean(x)))];
  const [contracts, advances, verificationRows, ackUsers, salesSettings] = await Promise.all([
    carrierIds.length ? optional<{ carrier_id: string; contract_level_bp: number; effective_from: string; is_active: boolean }>(client.from("tenant_carriers").select("carrier_id, contract_level_bp, effective_from, is_active").eq("tenant_id", tenantId).in("carrier_id", carrierIds)) : Promise.resolve([]),
    carrierIds.length ? optional<{ carrier_id: string; product_code: string; advance_months: number; advance_pct_bp: number; effective_from: string }>(client.from("advance_rules").select("carrier_id, product_code, advance_months, advance_pct_bp, effective_from").eq("tenant_id", tenantId).in("carrier_id", carrierIds)) : Promise.resolve([]),
    // The LA-1.11 verification session this case was opened with: complete when every required field was confirmed.
    c.work_item_id ? optional<{ progress_percentage: number | null; completed_at: string | null; started_at: string }>(client.from("tenant_verification_sessions").select("progress_percentage, completed_at, started_at").eq("tenant_id", tenantId).eq("work_item_id", c.work_item_id).order("started_at", { ascending: false }).limit(1)) : Promise.resolve([]),
    ackUserIds.length ? optional<{ id: string; name: string | null }>(client.from("users").select("id, name").in("id", ackUserIds)) : Promise.resolve([]),
    optional<{ settings: unknown }>(client.from("tenant_sales_settings").select("settings").eq("tenant_id", tenantId).limit(1)),
  ]);
  const qa = resolveSalesSettings(salesSettings[0]?.settings);
  const carrierFacts = await carrierFactsRead;
  // The spouse's linked draft day (LA-3.24). Its own read: the column arrives with its own migration.
  const spouseIds = attempts.filter((a) => a.insured_role === "spouse").map((a) => a.id);
  const draftLinks = spouseIds.length ? await optional<{ id: string; draft_day_linked: boolean }>(client.from("tenant_applications").select("id, draft_day_linked").eq("tenant_id", tenantId).in("id", spouseIds)).catch(() => []) : [];
  const draftDayLinked = new Set(draftLinks.filter((r) => r.draft_day_linked).map((r) => r.id));
  const verificationComplete = Boolean(verificationRows[0] && (verificationRows[0].completed_at || verificationRows[0].progress_percentage === 100));
  const userName = new Map(ackUsers.map((u) => [u.id, u.name ?? "A colleague"]));

  const carrierById = new Map(carriers.map((x) => [x.id, x]));
  const productById = new Map(products.map((x) => [x.id, x]));
  const portalByCarrier = new Map(portals.map((x) => [x.carrier_id, x]));
  const libraryById = new Map(library.map((x) => [x.id, x]));
  const t = today();

  const appointed = (carrierId: string | null): { ok: boolean; reason: string | null } => {
    if (!carrierId) return { ok: false, reason: "No carrier chosen." };
    const name = carrierById.get(carrierId)?.name ?? "this carrier";
    if (!clientState) return { ok: false, reason: `No state on file to check the ${name} appointment against.` };
    const rowsFor = appointments.filter((a) => a.carrier_id === carrierId && a.state === clientState);
    if (!rowsFor.length) return { ok: false, reason: `No ${name} appointment in ${clientState}.` };
    const live = rowsFor.find((a) => appointmentIsActiveAt(a, t));
    if (live) return { ok: true, reason: null };
    const pending = rowsFor.find((a) => a.status === "pending");
    return { ok: false, reason: pending ? `The ${name} appointment in ${clientState} is still pending.` : `The ${name} appointment in ${clientState} is not active.` };
  };

  const latest = <T extends { effective_from: string }>(list: T[]) => [...list].filter((x) => x.effective_from <= t).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const payoutFor = (carrierId: string, productCode: string, monthly: number): QuoteView["payout"] => {
    const contract = latest(contracts.filter((x) => x.carrier_id === carrierId && x.is_active));
    if (!contract) return null;
    const sched = latest(schedules.filter((s) => s.carrier_id === carrierId && s.product_code === productCode && s.contract_level_bp === contract.contract_level_bp));
    if (!sched) return null;
    const adv = latest(advances.filter((a) => a.carrier_id === carrierId && a.product_code === productCode));
    const annual = monthly * 12;
    const fyc = Math.floor((annual * sched.rate_bp * 2 + 10_000) / 20_000);
    const advance = adv ? Math.floor((fyc * adv.advance_pct_bp * adv.advance_months * 2 + 120_000) / 240_000) : 0;
    return { fycCents: fyc, advanceCents: advance, advanceMonths: adv?.advance_months ?? 0, contractLevelBp: contract.contract_level_bp };
  };

  const requiredFor = (carrierId: string | null, productCode: string | null) => {
    const code = productCode ?? "final_expense";
    // The carrier's own set (the agency's, then the platform's), then the product's general set (the
    // agency's, then the platform's) — what Settings › Field sets shows as in use — and only then the
    // Final Expense general set. `fieldSets` is newest version first.
    const mine = fieldSets.find((f) => f.tenant_id === tenantId && f.carrier_id === carrierId && f.product_code === code)
      ?? fieldSets.find((f) => f.tenant_id === null && f.carrier_id === carrierId && f.product_code === code)
      ?? fieldSets.find((f) => f.tenant_id === tenantId && f.carrier_id === null && f.product_code === code)
      ?? fieldSets.find((f) => f.tenant_id === null && f.carrier_id === null && f.product_code === code)
      ?? fieldSets.find((f) => f.tenant_id === null && f.carrier_id === null && f.product_code === "final_expense");
    return fieldSetRequired(mine?.definition);
  };

  const attemptViews: AttemptView[] = attempts.map((a) => {
    const vals: Record<string, FieldValue> = {};
    for (const v of values.filter((x) => x.application_id === a.id)) {
      const masked = v.value_last4 !== null && v.value === null;
      vals[v.field_key] = masked
        ? { value: null, source: v.source, reviewed: Boolean(v.reviewed_at) || v.source === "manual", masked: maskFromLast4(v.value_last4), hasValue: true, linked: v.linked_to_primary }
        : { value: (v.value as FieldValue["value"]) ?? null, source: v.source, reviewed: Boolean(v.reviewed_at) || v.source === "manual", linked: v.linked_to_primary };
    }
    const p = payments.find((x) => x.application_id === a.id);
    const payment: PaymentView | null = p ? {
      method: p.method, draftDay: a.draft_day, draftDayRecommended: p.draft_day_recommended, draftOverrideReason: p.draft_day_override_reason,
      incomeType: p.draft_income_type, incomeInputs: p.draft_income_inputs ?? {}, accountType: p.account_type, bankName: p.bank_name, nameOnAccount: p.name_on_account,
      routing: { masked: maskFromLast4(p.routing_last4), hasValue: Boolean(p.routing_last4) },
      account: { masked: maskFromLast4(p.account_last4), hasValue: Boolean(p.account_last4) },
      card: { masked: maskFromLast4(p.card_last4), hasValue: Boolean(p.card_last4), brand: p.card_brand, expMonth: p.card_exp_month, expYear: p.card_exp_year },
      nameOnCard: p.name_on_card, billingFrequency: p.billing_frequency, linked: p.linked_to_primary, draftDayLinked: draftDayLinked.has(a.id),
    } : null;
    const carrier = a.carrier_id ? carrierById.get(a.carrier_id) : undefined;
    const product = a.carrier_product_id ? productById.get(a.carrier_product_id) : undefined;
    const portal = a.carrier_id ? portalByCarrier.get(a.carrier_id) : undefined;
    const premiumValue = vals["cov.monthly_premium"]?.value;
    const effectivePremium = typeof premiumValue === "number" && Number.isInteger(premiumValue) && premiumValue > 0 ? premiumValue : null;
    const quoteViews: QuoteView[] = quotes.filter((q) => q.insured_role === a.insured_role && (q.application_id === a.id || (q.application_id === null && a.status !== "closed"))).map((q) => ({
      id: q.id, carrierId: q.carrier_id, carrierName: carrierById.get(q.carrier_id)?.name ?? "Carrier", productLabel: (q.carrier_product_id && productById.get(q.carrier_product_id)?.name) || PRODUCT_LABEL[q.product_code] || q.product_code,
      tier: q.tier, termLength: q.term_length, healthClass: q.assumed_health_class, faceAmountCents: q.face_amount_cents, monthlyPremiumCents: q.monthly_premium_cents,
      annualPremiumCents: q.annual_premium_cents, riders: (q.riders ?? []).map((r) => ({ name: r.name, monthlyPremiumCents: r.monthly_premium_cents })), ageUsed: q.age_used, status: q.status,
      appointed: appointed(q.carrier_id), acceptsPaymentMethod: p && q.carrier_product_id && productById.get(q.carrier_product_id)?.accepted_payment_methods?.length ? productById.get(q.carrier_product_id)!.accepted_payment_methods!.includes(p.method) : null,
      // The selected quote pays on the attempt's effective premium: after an accepted counteroffer
      // (LA-3.26) that is the carrier's figure, not the one quoted.
      warnings: q.warnings ?? [], payout: payoutFor(q.carrier_id, q.product_code, q.id === a.quote_id ? effectivePremium ?? q.monthly_premium_cents : q.monthly_premium_cents), createdAt: q.created_at,
    }));
    return {
      id: a.id, caseId: a.case_id, attemptNo: a.attempt_no, insuredRole: a.insured_role, status: a.status, outcome: a.outcome,
      outcomeReasonCode: a.outcome_reason_code as OutcomeReasonCode | null, outcomeReasonText: a.outcome_reason_text,
      carrierId: a.carrier_id, carrierName: carrier?.name ?? null, carrierPortalUrl: portal?.portal_url ?? (a.carrier_id ? carrierFacts.get(a.carrier_id)?.portalOrigin : null) ?? carrier?.portal_origin ?? null, portalUsername: portal?.username ?? null,
      productCode: a.product_code, productLabel: product?.name ?? null, tier: quotes.find((q) => q.id === a.quote_id)?.tier ?? null, selectedQuoteId: a.quote_id,
      values: vals, requiredKeys: requiredFor(a.carrier_id, a.product_code), payment,
      beneficiaries: beneficiaries.filter((b) => b.application_id === a.id).map((b) => ({ id: b.id, tier: b.tier, first_name: b.first_name ?? "", last_name: b.last_name, relationship: b.relationship, relationship_other: b.relationship_other ?? undefined, dob: b.dob, share_bp: b.share_bp, phone: b.phone })),
      disclosures: disclosures.filter((d) => d.application_id === a.id).map((d) => {
        const lib = libraryById.get(d.disclosure_id);
        return { id: d.disclosure_id, code: lib?.code ?? "DISCLOSURE", title: lib?.title ?? "Disclosure", body: normaliseProse(lib?.body_markdown), version: d.disclosure_version, status: d.status, method: d.method, note: d.note, acknowledgedBy: d.acknowledged_by ? userName.get(d.acknowledged_by) ?? "A colleague" : null, acknowledgedAt: d.acknowledged_at };
      }),
      quotes: quoteViews,
      requirements: requirements.filter((r) => r.application_id === a.id).map((r) => ({
        id: r.id, applicationId: a.id, caseId: a.case_id, clientName: leadName(leadValues), carrierName: carrier?.name ?? null, monthlyPremiumCents: quotes.find((q) => q.id === a.quote_id)?.monthly_premium_cents ?? null,
        kind: r.kind, description: r.description, waitingOn: r.waiting_on, status: r.status, raisedAt: r.raised_at, dueAt: r.due_at, lastChasedAt: r.last_chased_at, chaseCount: r.chase_count,
        exam: r.kind === "paramed_exam" ? { vendor: r.exam_vendor, orderedOn: r.exam_ordered_on, scheduledOn: r.exam_scheduled_on, completedOn: r.exam_completed_on, resultsOn: r.exam_results_on } : null,
      })),
      counteroffers: counteroffers.filter((o) => o.application_id === a.id).map((o) => {
        const q = quotes.find((x) => x.id === a.quote_id);
        return {
          id: o.id, receivedAt: o.received_at,
          applied: { tier: q?.tier ?? null, healthClass: q?.assumed_health_class ?? null, faceCents: q?.face_amount_cents ?? 0, monthlyCents: q?.monthly_premium_cents ?? 0 },
          offered: { tier: o.offered_tier, healthClass: o.offered_health_class, faceCents: o.offered_face_cents, monthlyCents: o.offered_monthly_premium_cents },
          reason: o.reason_text ?? o.reason_code ?? "", expiresAt: o.expires_at, status: o.status,
        };
      }),
      submissions: submissions.filter((s) => s.application_id === a.id).map((s) => ({ id: s.id, attemptNo: s.attempt_no, carrierReference: s.carrier_reference, referenceKind: s.reference_kind, policyNumber: s.policy_number, submittedAt: s.submitted_at, submittedVia: s.submitted_via, hasConfirmation: Boolean(s.confirmation_path), qaVerdict: s.qa_verdict?.verdict ?? "pass" })),
      welcomePack: (() => { const w = packs.find((x) => x.application_id === a.id); return w ? { status: w.email_status, recipient: w.recipient_email, sentAt: w.sent_at } : null; })(),
      appointment: appointed(a.carrier_id),
      product: product ? {
        issueAgeMin: product.issue_age_min, issueAgeMax: product.issue_age_max, faceMinCents: product.face_min_cents, faceMaxCents: product.face_max_cents, acceptedPaymentMethods: product.accepted_payment_methods ?? [],
        band: product.premium_per_1000_band_min != null && product.premium_per_1000_band_max != null ? { min: Number(product.premium_per_1000_band_min), max: Number(product.premium_per_1000_band_max) } : null,
      } : null,
      submittedAt: a.submitted_at, closedAt: a.closed_at, createdAt: a.created_at,
    };
  });

  const interviewViews: CaseView["interviews"] = {};
  for (const iv of interviews) {
    const tpl = templates.find((x) => x.id === iv.sales_template_id);
    const view: InterviewView = {
      id: iv.id, templateName: tpl?.name ?? "Interview", templateRevision: iv.template_version ?? tpl?.version ?? 1, startedAt: iv.started_at, completedAt: iv.completed_at,
      questions: interviewQuestions(tpl?.definition),
      answers: Object.fromEntries(answers.filter((x) => x.interview_id === iv.id).map((x) => [x.question_key, { value: x.value as InterviewView["answers"][string]["value"], notes: x.notes ?? undefined }])),
      medications: medications.filter((m) => m.interview_id === iv.id).map((m) => ({ id: m.id, name: m.name, dose: m.dose ?? "", since: m.since ?? "", prescribedFor: m.prescribed_for ?? "", prescribedForUnknown: m.prescribed_for_unknown, notes: m.notes ?? undefined })),
    };
    interviewViews[iv.insured_role] = view;
  }

  return {
    caseId: c.id, leadId: c.lead_id, status: (["open", "won", "lost"].includes(c.status) ? c.status : "open") as CaseView["status"], source: c.source,
    clientName: leadName(leadValues), clientState, clientPhone: typeof leadValues.phone === "string" ? leadValues.phone : null,
    campaignName: (campaign as { data: { name?: string } | null }).data?.name ?? null, openedAt: c.opened_at,
    interviews: interviewViews, attempts: attemptViews, verification: { workItemId: c.work_item_id, complete: verificationComplete },
    qaSettings: { appointmentBlocks: qa.appointmentBlocks, per1000Band: qa.per1000Band },
  };
}

// ── the list ───────────────────────────────────────────────────────────────

export async function listApplications(tenantId: string): Promise<ApplicationListRow[]> {
  const client = db();
  const q = await client.from("tenant_applications").select("id, case_id, lead_id, insured_role, attempt_no, carrier_id, product_code, carrier_product_id, quote_id, status, outcome, updated_at").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(1000);
  if (isMissingSchema(q.error)) throw new SchemaPendingError("The application record");
  if (q.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", q.error.message, 500);
  const list = rows<AttemptRow>(q.data);
  if (!list.length) return [];
  const leadIds = [...new Set(list.map((a) => a.lead_id))];
  const carrierIds = [...new Set(list.map((a) => a.carrier_id).filter((x): x is string => Boolean(x)))];
  const productIds = [...new Set(list.map((a) => a.carrier_product_id).filter((x): x is string => Boolean(x)))];
  const quoteIds = [...new Set(list.map((a) => a.quote_id).filter((x): x is string => Boolean(x)))];
  const [leads, carriers, products, quotes, subs] = await Promise.all([
    optional<{ id: string; values: Record<string, unknown> }>(client.from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", leadIds)),
    carrierIds.length ? optional<{ id: string; name: string }>(client.from("carriers").select("id, name").in("id", carrierIds)) : Promise.resolve([]),
    productIds.length ? optional<{ id: string; name: string }>(client.from("carrier_products").select("id, name").in("id", productIds)) : Promise.resolve([]),
    quoteIds.length ? optional<{ id: string; monthly_premium_cents: number }>(client.from("tenant_quotes").select("id, monthly_premium_cents").eq("tenant_id", tenantId).in("id", quoteIds)) : Promise.resolve([]),
    optional<{ application_id: string; carrier_reference: string | null; policy_number: string | null; qa_verdict: { verdict?: ApplicationListRow["qaVerdict"] } | null; submitted_at: string }>(client.from("tenant_application_submissions").select("application_id, carrier_reference, policy_number, qa_verdict, submitted_at").eq("tenant_id", tenantId).in("application_id", list.map((a) => a.id))),
  ]);
  const leadBy = new Map(leads.map((l) => [l.id, l.values ?? {}]));
  const carrierBy = new Map(carriers.map((x) => [x.id, x.name]));
  const productBy = new Map(products.map((x) => [x.id, x.name]));
  const quoteBy = new Map(quotes.map((x) => [x.id, x.monthly_premium_cents]));
  return list.map((a) => {
    const v = leadBy.get(a.lead_id) ?? {};
    const sub = subs.filter((s) => s.application_id === a.id).sort((x, y) => y.submitted_at.localeCompare(x.submitted_at))[0];
    return {
      caseId: a.case_id, applicationId: a.id, leadId: a.lead_id, clientName: leadName(v), insuredRole: a.insured_role,
      state: typeof v.state === "string" ? v.state.toUpperCase() : null, carrierName: a.carrier_id ? carrierBy.get(a.carrier_id) ?? null : null,
      productLabel: a.carrier_product_id ? productBy.get(a.carrier_product_id) ?? null : a.product_code, attemptNo: a.attempt_no, status: a.status, outcome: a.outcome,
      monthlyPremiumCents: a.quote_id ? quoteBy.get(a.quote_id) ?? null : null, qaVerdict: sub?.qa_verdict?.verdict ?? null,
      reference: sub?.carrier_reference ?? null, policyNumber: sub?.policy_number ?? null, updatedAt: a.updated_at,
    };
  });
}
