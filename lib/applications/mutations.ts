import "server-only";

import { audit } from "@/lib/audit/log";
import { markDealPolicyIssued } from "@/lib/issuedPolicies/service";
import { checkBeneficiaries, FULL_SHARE } from "./beneficiaries";
import { CANONICAL_GROUPS, isSensitiveKey, OUTCOMES_NEEDING_REASON, type ApplicationOutcome, type InsuredRole, type PaymentMethod } from "./constants";
import { decryptSensitive, encryptSensitive } from "./crypto";
import { applicableDisclosures, disclosureChanges, type AttachedDisclosure, type DisclosureClause } from "./disclosureRules";
import { cardBrand, cardExpiryInFuture, digitsOnly, isPlausibleSsn, isValidAbaRouting, isValidBankAccount, passesLuhn } from "./formats";
import { INTERVIEW_MAY_REPLACE, prefillFromInterview, prefillFromQuote, QUOTE_MAY_REPLACE } from "./prefill";
import { runQa, type QaVerdict } from "./qa";
import { ApplicationError, db, isMissingSchema, rows, rpcError, SchemaPendingError } from "./db";
import { getCaseView } from "./service";
import { hiddenAnswerKeys, insuredFacts, interviewQuestions, missingRequiredAnswers, pickTemplate, type StoredDefinition, type TemplateChoice } from "./templates";
import { genericTransitionRefusal } from "./transitionRules";
import { bandFallback, checkQuote, ratingAge } from "@/lib/quotes/math";
import { freezeRatingInputs, quotationFieldsOf, scopeRatingInputs } from "@/lib/quotes/quotationTemplate";
import { recommendDraftDay } from "@/lib/draftDates/optimiser";
import { resolveSalesSettings } from "@/lib/salesSettings/schema";
import { syncLeadStage, syncLeadStageForApplication } from "./stageSyncService";
import { waiveOpenRequirements } from "./requirements";
import type { BeneficiaryView, CaseView } from "./types";

/**
 * LA-3 writes. Each function names the tenant, re-reads what it guards, and refuses to touch a
 * closed attempt. Status only ever moves through `application_transition` (the SQL graph); the QA
 * guard on `ready` and `submitted` is evaluated here, from the same `runQa` the screen shows.
 */

type Actor = { tenantId: string; userId: string; request: Request };
/** Who, without the request: what the system-side re-checks (QA demotion) need. */
type Who = Pick<Actor, "tenantId" | "userId">;

const KNOWN_KEYS = new Set(CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => f.key)));

type AttemptHead = { id: string; case_id: string; lead_id: string; insured_role: InsuredRole; attempt_no: number; status: string; carrier_id: string | null; product_code: string | null; quote_id: string | null };

async function attemptHead(tenantId: string, applicationId: string, opts: { allowClosed?: boolean } = {}): Promise<AttemptHead> {
  const q = await db().from("tenant_applications").select("id, case_id, lead_id, insured_role, attempt_no, status, carrier_id, product_code, quote_id").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle();
  if (isMissingSchema(q.error)) throw new SchemaPendingError("The application record");
  if (q.error) throw new ApplicationError("APPLICATION_UNAVAILABLE", q.error.message, 500);
  if (!q.data) throw new ApplicationError("APPLICATION_NOT_FOUND", "That application could not be found.", 404);
  if (!opts.allowClosed && q.data.status === "closed") throw new ApplicationError("APPLICATION_CLOSED", "This attempt is closed. Start a new attempt instead.", 409);
  return q.data as AttemptHead;
}

function fail(error: { code?: string; message?: string } | null, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError(what);
  throw new ApplicationError("APPLICATION_UNAVAILABLE", `${what}: ${error?.message ?? "unknown error"}`, 500);
}

// ── values (LA-3.7) ────────────────────────────────────────────────────────

export async function saveValues(actor: Actor, applicationId: string, values: { key: string; value: string | number | boolean | null }[]) {
  const a = await attemptHead(actor.tenantId, applicationId);
  for (const v of values) {
    if (!KNOWN_KEYS.has(v.key)) throw new ApplicationError("FIELD_UNKNOWN", `There is no application field called ${v.key}.`);
    if (isSensitiveKey(v.key)) throw new ApplicationError("FIELD_SENSITIVE", "Sensitive fields are saved through their own secure form.");
    if (v.key.startsWith("cov.") && v.key !== "cov.effective_date") throw new ApplicationError("FIELD_FROM_QUOTE", "Coverage comes from the selected quote — change it on the Quote step.");
  }
  // LA-3.24 · a spouse's shared detail follows the primary's; typing over it here would be undone by
  // the next sync, so it is detached first, on purpose.
  if (a.insured_role === "spouse" && values.length) {
    const linked = await db().from("tenant_application_values").select("field_key").eq("tenant_id", actor.tenantId).eq("application_id", a.id).eq("linked_to_primary", true).in("field_key", values.map((v) => v.key));
    if (!linked.error && rows(linked.data).length) throw new ApplicationError("FIELD_SHARED", "This detail follows the primary insured's application. Detach it to give the spouse their own.", 409);
  }
  const now = new Date().toISOString();
  // A cleared field ("Choose…" on a select sends null) removes the value. Writing it as a row with
  // neither `value` nor `value_ciphertext` broke the one-form check, so the clear failed and the old
  // value came back on the next load.
  const cleared = values.filter((v) => v.value === null || v.value === "").map((v) => v.key);
  const payload = values.filter((v) => !cleared.includes(v.key)).map((v) => ({ application_id: a.id, tenant_id: actor.tenantId, field_key: v.key, value: v.value, value_ciphertext: null, value_last4: null, key_version: null, source: "manual", reviewed_at: now, reviewed_by: actor.userId, updated_by: actor.userId }));
  if (payload.length) {
    const { error } = await db().from("tenant_application_values").upsert(payload, { onConflict: "application_id,field_key" });
    if (error) fail(error, "Could not save the application");
  }
  if (cleared.length) {
    const { error } = await db().from("tenant_application_values").delete().eq("tenant_id", actor.tenantId).eq("application_id", a.id).in("field_key", cleared);
    if (error) fail(error, "Could not clear the field");
  }
  await refreshDisclosures(actor.tenantId, a.id);
  return { saved: values.length };
}

export async function markReviewed(actor: Actor, applicationId: string, keys: string[]) {
  const a = await attemptHead(actor.tenantId, applicationId);
  const { error } = await db().from("tenant_application_values").update({ reviewed_at: new Date().toISOString(), reviewed_by: actor.userId }).eq("tenant_id", actor.tenantId).eq("application_id", a.id).in("field_key", keys);
  if (error) fail(error, "Could not mark the fields checked");
  return { reviewed: keys.length };
}

/** SSN only, today; the payment numbers go through savePayment. Validated before it is encrypted. */
export async function saveSensitiveValue(actor: Actor, applicationId: string, fieldKey: string, raw: string) {
  const a = await attemptHead(actor.tenantId, applicationId);
  if (fieldKey !== "insured.ssn") throw new ApplicationError("FIELD_UNKNOWN", "That field is not saved here.");
  const digits = digitsOnly(raw);
  if (!isPlausibleSsn(raw)) throw new ApplicationError("SSN_INVALID", "That is not a valid Social Security number.");
  const enc = encryptSensitive(digits, { tenantId: actor.tenantId, applicationId: a.id, fieldKey });
  const { error } = await db().from("tenant_application_values").upsert({
    application_id: a.id, tenant_id: actor.tenantId, field_key: fieldKey, value: null, value_ciphertext: enc.ciphertext, value_last4: digits.slice(-4), key_version: enc.keyVersion,
    source: "manual", reviewed_at: new Date().toISOString(), reviewed_by: actor.userId, updated_by: actor.userId,
  }, { onConflict: "application_id,field_key" });
  if (error) fail(error, "Could not save the Social Security number");
  return { last4: digits.slice(-4) };
}

// ── reveal (LA-3.7; decision 5 limits the ROUTE to owner and producer) ─────

const PAY_COLUMN: Record<string, "routing_ciphertext" | "account_ciphertext" | "card_ciphertext"> = {
  "pay.routing_number": "routing_ciphertext",
  "pay.account_number": "account_ciphertext",
  "pay.card_number": "card_ciphertext",
};

export async function revealField(actor: Actor, applicationId: string, fieldKey: string, surface: "web" | "copy_assist" | "extension" = "web") {
  if (!isSensitiveKey(fieldKey)) throw new ApplicationError("FIELD_NOT_SENSITIVE", "Only sensitive fields are revealed.");
  const a = await attemptHead(actor.tenantId, applicationId, { allowClosed: true });
  const client = db();
  let ciphertext: string | null = null;
  let keyVersion: number | null = null;
  if (fieldKey === "insured.ssn") {
    const r = await client.from("tenant_application_values").select("value_ciphertext, key_version").eq("tenant_id", actor.tenantId).eq("application_id", a.id).eq("field_key", fieldKey).maybeSingle();
    if (r.error) fail(r.error, "Could not reveal the value");
    ciphertext = r.data?.value_ciphertext ?? null;
    keyVersion = r.data?.key_version ?? null;
  } else {
    const column = PAY_COLUMN[fieldKey];
    const r = await client.from("tenant_application_payment_methods").select(`${column}, key_version`).eq("tenant_id", actor.tenantId).eq("application_id", a.id).maybeSingle();
    if (r.error) fail(r.error, "Could not reveal the value");
    ciphertext = (r.data?.[column] as string | null) ?? null;
    keyVersion = r.data?.key_version ?? null;
  }
  if (!ciphertext) throw new ApplicationError("FIELD_EMPTY", "There is nothing stored to reveal.", 404);
  const value = decryptSensitive(ciphertext, keyVersion, { tenantId: actor.tenantId, applicationId: a.id, fieldKey });
  if (value === null) throw new ApplicationError("FIELD_UNREADABLE", "The stored value could not be read.", 500);

  // The access record first, then the value — a reveal that could not be recorded does not happen.
  const log = await client.from("tenant_sensitive_access_log").insert({ tenant_id: actor.tenantId, user_id: actor.userId, application_id: a.id, field_key: fieldKey, action: surface === "extension" ? "extension_read" : "reveal", surface });
  if (log.error) fail(log.error, "Could not record the reveal");
  await audit({ actorType: "tenant", actorId: actor.userId, action: "tenant.application_field_revealed", targetType: "tenant_application", targetId: a.id, metadata: { fieldKey, surface, caseId: a.case_id }, request: actor.request });
  return { value };
}

// ── payment + draft day (LA-3.19, 3.9) ─────────────────────────────────────

export type PaymentInput = {
  method: PaymentMethod;
  routing?: string | null;
  account?: string | null;
  accountType?: "checking" | "savings" | null;
  bankName?: string | null;
  nameOnAccount?: string | null;
  card?: string | null;
  cardExpMonth?: number | null;
  cardExpYear?: number | null;
  nameOnCard?: string | null;
  billingFrequency?: "monthly" | "quarterly" | "semiannual" | "annual" | null;
  billingAddressSameAsInsured?: boolean | null;
};

export async function savePayment(actor: Actor, applicationId: string, input: PaymentInput) {
  const a = await attemptHead(actor.tenantId, applicationId);
  const client = db();
  const existing = await client.from("tenant_application_payment_methods").select("method, routing_ciphertext, routing_last4, account_ciphertext, account_last4, card_ciphertext, card_last4, card_brand, key_version, linked_to_primary").eq("tenant_id", actor.tenantId).eq("application_id", a.id).maybeSingle();
  if (existing.error) fail(existing.error, "Could not load the payment method");
  // LA-3.24 · the spouse's shared payment method follows the primary's until it is detached.
  if (a.insured_role === "spouse" && (existing.data as { linked_to_primary?: boolean } | null)?.linked_to_primary) throw new ApplicationError("PAYMENT_SHARED", "This payment method follows the primary insured's application. Detach it to give the spouse their own.", 409);
  const prev = existing.data as Record<string, unknown> | null;
  const scope = (fieldKey: string) => ({ tenantId: actor.tenantId, applicationId: a.id, fieldKey });
  const row: Record<string, unknown> = {
    application_id: a.id, tenant_id: actor.tenantId, method: input.method, updated_by: actor.userId,
    routing_ciphertext: null, routing_last4: null, account_ciphertext: null, account_last4: null, account_type: null, bank_name: null, name_on_account: null,
    card_ciphertext: null, card_last4: null, card_exp_month: null, card_exp_year: null, card_brand: null, name_on_card: null,
    billing_frequency: null, billing_address_same_as_insured: null,
  };
  const keep = (method: PaymentMethod) => prev && prev.method === method;
  let keyVersion: number | null = (prev?.key_version as number | null) ?? null;

  if (input.method === "ach") {
    // A number left blank keeps the one already stored: banking details given once are never lost.
    if (input.routing) {
      if (!isValidAbaRouting(input.routing)) throw new ApplicationError("ROUTING_INVALID", "That routing number fails the bank checksum.");
      const e = encryptSensitive(digitsOnly(input.routing), scope("pay.routing_number"));
      row.routing_ciphertext = e.ciphertext; row.routing_last4 = digitsOnly(input.routing).slice(-4); keyVersion = e.keyVersion;
    } else if (keep("ach")) { row.routing_ciphertext = prev!.routing_ciphertext; row.routing_last4 = prev!.routing_last4; }
    if (input.account) {
      if (!isValidBankAccount(input.account)) throw new ApplicationError("ACCOUNT_INVALID", "An account number is 4 to 17 digits.");
      const e = encryptSensitive(digitsOnly(input.account), scope("pay.account_number"));
      row.account_ciphertext = e.ciphertext; row.account_last4 = digitsOnly(input.account).slice(-4); keyVersion = e.keyVersion;
    } else if (keep("ach")) { row.account_ciphertext = prev!.account_ciphertext; row.account_last4 = prev!.account_last4; }
    row.account_type = input.accountType ?? null;
    row.bank_name = input.bankName?.trim() || null;
    row.name_on_account = input.nameOnAccount?.trim() || null;
  } else if (input.method === "direct_express" || input.method === "debit_card" || input.method === "credit_card") {
    if (input.card) {
      if (!passesLuhn(input.card)) throw new ApplicationError("CARD_INVALID", "That card number fails its checksum — check the digits.");
      const e = encryptSensitive(digitsOnly(input.card), scope("pay.card_number"));
      row.card_ciphertext = e.ciphertext; row.card_last4 = digitsOnly(input.card).slice(-4); row.card_brand = cardBrand(input.card); keyVersion = e.keyVersion;
    } else if (prev && ["direct_express", "debit_card", "credit_card"].includes(String(prev.method))) { row.card_ciphertext = prev.card_ciphertext; row.card_last4 = prev.card_last4; row.card_brand = prev.card_brand; }
    if (input.cardExpMonth && input.cardExpYear && !cardExpiryInFuture(input.cardExpMonth, input.cardExpYear)) throw new ApplicationError("CARD_EXPIRED", "That card has expired.");
    row.card_exp_month = input.cardExpMonth ?? null;
    row.card_exp_year = input.cardExpYear ?? null;
    row.name_on_card = input.nameOnCard?.trim() || null;
  } else {
    row.billing_frequency = input.billingFrequency ?? "monthly";
    row.billing_address_same_as_insured = input.billingAddressSameAsInsured ?? true;
  }
  row.key_version = row.routing_ciphertext || row.account_ciphertext || row.card_ciphertext ? keyVersion ?? 1 : null;
  const { error } = await client.from("tenant_application_payment_methods").upsert(row, { onConflict: "application_id" });
  if (error) fail(error, "Could not save the payment method");
  if (input.method === "direct_bill") await client.from("tenant_applications").update({ draft_day: null }).eq("tenant_id", actor.tenantId).eq("id", a.id);
  return { method: input.method };
}

export async function saveDraftDay(actor: Actor, applicationId: string, input: { day: number | null; incomeType: string | null; incomeInputs: Record<string, unknown>; overrideReason?: string | null }) {
  const a = await attemptHead(actor.tenantId, applicationId);
  const client = db();
  const pay = await client.from("tenant_application_payment_methods").select("method").eq("tenant_id", actor.tenantId).eq("application_id", a.id).maybeSingle();
  if (pay.error) fail(pay.error, "Could not load the payment method");
  if (a.insured_role === "spouse") {
    const own = await client.from("tenant_applications").select("draft_day_linked").eq("tenant_id", actor.tenantId).eq("id", a.id).maybeSingle();
    if (!own.error && (own.data as { draft_day_linked?: boolean } | null)?.draft_day_linked) throw new ApplicationError("DRAFT_DAY_SHARED", "This draft day follows the primary insured's application. Detach it to set the spouse's own.", 409);
  }
  if (!pay.data) throw new ApplicationError("PAYMENT_MISSING", "Choose how they will pay first.");
  if (pay.data.method === "direct_bill") throw new ApplicationError("DIRECT_BILL_NO_DRAFT", "Direct bill isn't drafted, so there's no draft day.");
  if (input.day !== null && (!Number.isInteger(input.day) || input.day < 1 || input.day > 28)) throw new ApplicationError("DRAFT_DAY_INVALID", "Pick a draft day between the 1st and the 28th.");

  // The recommendation is recomputed here, never trusted from the browser, with the agency's own
  // buffer (LA-3.17 · 2–4 days after the latest deposit).
  const prefs = await client.from("tenant_sales_settings").select("settings").eq("tenant_id", actor.tenantId).maybeSingle();
  const buffer = resolveSalesSettings(prefs.data?.settings).draftBufferDays;
  const rec = input.incomeType ? recommendDraftDay({ incomeType: input.incomeType as never, ...(input.incomeInputs as object), buffer }) : null;
  // Only a real income schedule recommends a day. "Income unknown" offers a neutral middle-of-month
  // guess, which is not a recommendation: any day is allowed there without an override reason.
  const recommended = rec && rec.kind === "recommended" ? rec.recommended.day : null;
  const overriding = input.day !== null && recommended !== null && input.day !== recommended;
  const reason = input.overrideReason?.trim() || null;
  if (overriding && !reason) throw new ApplicationError("DRAFT_OVERRIDE_REASON", "Say why this day is right for them — it is recorded.");
  const u1 = await client.from("tenant_application_payment_methods").update({
    draft_income_type: input.incomeType, draft_income_inputs: input.incomeInputs ?? {}, draft_day_recommended: recommended,
    draft_day_override_reason: overriding ? reason : null, draft_day_overridden_by: overriding ? actor.userId : null, draft_day_overridden_at: overriding ? new Date().toISOString() : null,
  }).eq("tenant_id", actor.tenantId).eq("application_id", a.id);
  if (u1.error) fail(u1.error, "Could not save the draft day");
  const u2 = await client.from("tenant_applications").update({ draft_day: input.day }).eq("tenant_id", actor.tenantId).eq("id", a.id);
  if (u2.error) fail(u2.error, "Could not save the draft day");
  if (overriding) await audit({ actorType: "tenant", actorId: actor.userId, action: "tenant.application_draft_day_overridden", targetType: "tenant_application", targetId: a.id, metadata: { day: input.day, recommended, reason }, request: actor.request });
  return { day: input.day, recommended };
}

// ── beneficiaries (LA-3.8) ─────────────────────────────────────────────────

export async function saveBeneficiaries(actor: Actor, applicationId: string, list: BeneficiaryView[]) {
  const a = await attemptHead(actor.tenantId, applicationId);
  for (const b of list) if (!(b.share_bp > 0 && b.share_bp <= FULL_SHARE)) throw new ApplicationError("SHARE_INVALID", "Each share is between 0.01% and 100%.");
  const client = db();
  const del = await client.from("tenant_application_beneficiaries").delete().eq("tenant_id", actor.tenantId).eq("application_id", a.id);
  if (del.error) fail(del.error, "Could not save the beneficiaries");
  if (list.length) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // The client's own ids are kept, so QA deep links and the row being typed in survive a save.
    const ins = await client.from("tenant_application_beneficiaries").insert(list.map((b, i) => ({
      ...(uuid.test(b.id) ? { id: b.id } : {}),
      application_id: a.id, tenant_id: actor.tenantId, tier: b.tier,
      first_name: ["estate", "trust", "funeral_home"].includes(b.relationship) && !b.first_name?.trim() ? null : (b.first_name ?? "").trim(),
      last_name: b.last_name.trim(), relationship: b.relationship || "other",
      relationship_other: b.relationship === "other" ? b.relationship_other?.trim() || null : null, dob: b.dob || null, share_bp: b.share_bp, phone: b.phone || null, sort_order: i,
    })));
    if (ins.error) fail(ins.error, "Could not save the beneficiaries");
  }
  return { issues: checkBeneficiaries(list) };
}

// ── disclosures (LA-3.10) ──────────────────────────────────────────────────

/** Re-evaluate which disclosures apply; add newly required ones, drop required ones that no longer apply. Acknowledged ones are never removed. */
export async function refreshDisclosures(tenantId: string, applicationId: string) {
  const client = db();
  const [lib, rules, head] = await Promise.all([
    client.from("application_disclosures").select("id, tenant_id, code, version, status, states, carrier_ids").eq("status", "published").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
    client.from("application_disclosure_rules").select("disclosure_id, clauses"),
    client.from("tenant_applications").select("id, case_id, insured_role, carrier_id").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle(),
  ]);
  if (isMissingSchema(lib.error) || isMissingSchema(rules.error)) return;
  if (lib.error || rules.error || !head.data) return;
  const [vals, iv] = await Promise.all([
    client.from("tenant_application_values").select("field_key, value").eq("tenant_id", tenantId).eq("application_id", applicationId),
    client.from("tenant_uw_interviews").select("id").eq("tenant_id", tenantId).eq("case_id", head.data.case_id).eq("insured_role", head.data.insured_role).maybeSingle(),
  ]);
  const answers = iv.data ? await client.from("tenant_uw_answers").select("question_key, value").eq("tenant_id", tenantId).eq("interview_id", iv.data.id) : { data: [] };
  const values = Object.fromEntries(rows<{ field_key: string; value: unknown }>(vals.data).map((v) => [v.field_key, v.value]));
  const answerMap = Object.fromEntries(rows<{ question_key: string; value: unknown }>(answers.data).map((v) => [v.question_key, v.value]));
  // A tenant's own version of a code replaces the platform one.
  const libRows = rows<{ id: string; tenant_id: string | null; code: string; version: number; states: string[] | null; carrier_ids: string[] | null }>(lib.data);
  const byCode = new Map<string, (typeof libRows)[number]>();
  for (const d of libRows.sort((x, y) => (x.tenant_id ? 1 : 0) - (y.tenant_id ? 1 : 0) || x.version - y.version)) byCode.set(d.code, d);
  const live = [...byCode.values()];
  const apply = applicableDisclosures({
    rules: rows<{ disclosure_id: string; clauses: DisclosureClause[] }>(rules.data).filter((r) => live.some((d) => d.id === r.disclosure_id)).map((r) => ({ disclosureId: r.disclosure_id, clauses: r.clauses ?? [] })),
    scopes: new Map(live.map((d) => [d.id, { states: d.states ?? [], carrierIds: d.carrier_ids ?? [] }])),
    values, answers: answerMap, state: typeof values["addr.state"] === "string" ? (values["addr.state"] as string) : null, carrierId: head.data.carrier_id,
  });
  const current = await client.from("tenant_application_disclosures").select("disclosure_id, status").eq("tenant_id", tenantId).eq("application_id", applicationId);
  const currentRows = rows<{ disclosure_id: string; status: AttachedDisclosure["status"] }>(current.data);
  // The codes of what is already attached — an acknowledged row may point at a version since retired,
  // which the live library above no longer lists.
  const attachedIds = currentRows.map((r) => r.disclosure_id);
  const attachedCodes = attachedIds.length
    ? new Map(rows<{ id: string; code: string }>((await client.from("application_disclosures").select("id, code").in("id", attachedIds)).data).map((d) => [d.id, d.code]))
    : new Map<string, string>();
  // An acknowledged disclosure keeps the version it was given: a newer version of the same code is not
  // added beside it (LA-3.10). A still-required older version is swapped for the live one.
  const { add, drop } = disclosureChanges({
    apply,
    current: currentRows.map((r) => ({ disclosureId: r.disclosure_id, status: r.status, code: attachedCodes.get(r.disclosure_id) ?? null })),
    codeOf: new Map(live.map((d) => [d.id, d.code])),
  });
  if (add.length) await client.from("tenant_application_disclosures").insert(add.map((id) => ({ application_id: applicationId, tenant_id: tenantId, disclosure_id: id, disclosure_version: live.find((d) => d.id === id)!.version, status: "required" })));
  if (drop.length) await client.from("tenant_application_disclosures").delete().eq("tenant_id", tenantId).eq("application_id", applicationId).eq("status", "required").in("disclosure_id", drop);
}

export async function resolveDisclosure(actor: Actor, applicationId: string, disclosureId: string, input: { status: "acknowledged" | "not_applicable"; method?: "read_aloud" | "emailed" | "mailed" | null; note?: string | null }) {
  const a = await attemptHead(actor.tenantId, applicationId);
  if (input.status === "not_applicable" && !input.note?.trim()) throw new ApplicationError("DISCLOSURE_REASON", "Say why this disclosure does not apply — it is recorded.");
  if (input.status === "acknowledged" && !input.method) throw new ApplicationError("DISCLOSURE_METHOD", "Say how it was given: read aloud, emailed or mailed.");
  const { data, error } = await db().from("tenant_application_disclosures").update({
    status: input.status, method: input.status === "acknowledged" ? input.method : null, note: input.note?.trim() || null, acknowledged_by: actor.userId, acknowledged_at: new Date().toISOString(),
  }).eq("tenant_id", actor.tenantId).eq("application_id", a.id).eq("disclosure_id", disclosureId).select("disclosure_id");
  if (error) fail(error, "Could not record the disclosure");
  if (!rows(data).length) throw new ApplicationError("DISCLOSURE_NOT_FOUND", "That disclosure does not apply to this application.", 404);
  await audit({ actorType: "tenant", actorId: actor.userId, action: "tenant.application_disclosure_resolved", targetType: "tenant_application", targetId: a.id, metadata: { disclosureId, status: input.status, method: input.method ?? null }, request: actor.request });
  return { status: input.status };
}

// ── interview (LA-3.2) ─────────────────────────────────────────────────────

export async function ensureInterview(actor: Actor, caseId: string, insuredRole: InsuredRole) {
  const client = db();
  const found = await client.from("tenant_uw_interviews").select("id").eq("tenant_id", actor.tenantId).eq("case_id", caseId).eq("insured_role", insuredRole).maybeSingle();
  if (isMissingSchema(found.error)) throw new SchemaPendingError("The underwriting interview");
  if (found.data) return found.data.id as string;
  const kase = await client.from("tenant_application_cases").select("product_line").eq("tenant_id", actor.tenantId).eq("id", caseId).maybeSingle();
  if (!kase.data) throw new ApplicationError("CASE_NOT_FOUND", "That case could not be found.", 404);
  // The carrier on this insured's live attempt, when a quote has chosen one: its own template first.
  const live = await client.from("tenant_applications").select("carrier_id, product_code").eq("tenant_id", actor.tenantId).eq("case_id", caseId).eq("insured_role", insuredRole).neq("status", "closed").order("attempt_no", { ascending: false }).limit(1).maybeSingle();
  const carrierId = (live.data?.carrier_id as string | null | undefined) ?? null;
  const productCode = (live.data?.product_code as string | null | undefined) ?? (kase.data.product_line as string | null) ?? null;
  const tpl = await client.from("sales_templates").select("id, version, tenant_id, carrier_id, product_code").eq("kind", "underwriting").eq("status", "published").or(`tenant_id.is.null,tenant_id.eq.${actor.tenantId}`).in("product_code", [...new Set([productCode, kase.data.product_line, "final_expense"].filter((x): x is string => Boolean(x)))]).order("version", { ascending: false });
  if (tpl.error) fail(tpl.error, "Could not load the interview templates");
  // Only this agency's rows and the platform's; a carrier-specific one only for this carrier.
  const list = rows<TemplateChoice>(tpl.data).filter((t) => (t.tenant_id === null || t.tenant_id === actor.tenantId) && (t.carrier_id === null || t.carrier_id === carrierId));
  const pick = pickTemplate(list, { tenantId: actor.tenantId, carrierId, productCode });
  const ins = await client.from("tenant_uw_interviews").insert({ tenant_id: actor.tenantId, case_id: caseId, insured_role: insuredRole, sales_template_id: pick?.id ?? null, template_version: pick?.version ?? null, started_by: actor.userId }).select("id").single();
  if (ins.error?.code === "23505") return ensureInterview(actor, caseId, insuredRole);
  if (ins.error) fail(ins.error, "Could not start the interview");
  return ins.data.id as string;
}

export async function saveAnswers(actor: Actor, interviewId: string, answers: { key: string; value: unknown; notes?: string | null }[], hiddenKeys: string[] = []) {
  const client = db();
  const iv = await client.from("tenant_uw_interviews").select("id, case_id, insured_role, completed_at, sales_template_id").eq("tenant_id", actor.tenantId).eq("id", interviewId).maybeSingle();
  if (isMissingSchema(iv.error)) throw new SchemaPendingError("The underwriting interview");
  if (!iv.data) throw new ApplicationError("INTERVIEW_NOT_FOUND", "That interview could not be found.", 404);

  // Every stored answer, then this save on top: what the follow-up rules are judged against.
  const [stored, tpl] = await Promise.all([
    client.from("tenant_uw_answers").select("question_key, value").eq("tenant_id", actor.tenantId).eq("interview_id", interviewId),
    iv.data.sales_template_id ? client.from("sales_templates").select("definition").eq("id", iv.data.sales_template_id).or(`tenant_id.is.null,tenant_id.eq.${actor.tenantId}`).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (stored.error) fail(stored.error, "Could not load the answers");
  const old = new Map(rows<{ question_key: string; value: unknown }>(stored.data).map((r) => [r.question_key, r.value]));
  const merged: Record<string, unknown> = Object.fromEntries(old);
  for (const x of answers) merged[x.key] = x.value ?? null;
  // A follow-up that is hidden again is not stored (LA-3.1): the ones the client named, and the ones
  // the template's own rules hide now — decided here too, so a client that forgets cannot keep one.
  const questions = interviewQuestions((tpl.data as { definition?: StoredDefinition } | null)?.definition);
  const hidden = [...new Set([...hiddenKeys, ...hiddenAnswerKeys(questions, merged)])];
  const hiddenSet = new Set(hidden);
  const toSave = answers.filter((x) => !hiddenSet.has(x.key));

  if (iv.data.completed_at) {
    // After the call: every change is recorded against the value it replaced (LA-3.2), removals too.
    // The record is written first; an amendment that could not be recorded is not made.
    const changes = [
      ...toSave.filter((x) => JSON.stringify(old.get(x.key) ?? null) !== JSON.stringify(x.value ?? null)).map((x) => ({ key: x.key, from: old.get(x.key) ?? null, to: x.value ?? null })),
      ...hidden.filter((k) => old.has(k) && old.get(k) !== null).map((k) => ({ key: k, from: old.get(k) ?? null, to: null })),
    ].map((c) => ({ interview_id: interviewId, tenant_id: actor.tenantId, question_key: c.key, old_value: c.from, new_value: c.to, changed_by: actor.userId }));
    if (changes.length) {
      const logged = await client.from("tenant_uw_answer_changes").insert(changes);
      if (logged.error) fail(logged.error, "Could not record the amendment");
    }
  }
  const now = new Date().toISOString();
  if (toSave.length) {
    const { error } = await client.from("tenant_uw_answers").upsert(toSave.map((x) => ({ interview_id: interviewId, tenant_id: actor.tenantId, question_key: x.key, value: x.value ?? null, notes: x.notes?.trim() || null, answered_at: now, answered_by: actor.userId })), { onConflict: "interview_id,question_key" });
    if (error) fail(error, "Could not save the answers");
  }
  if (hidden.length) {
    const del = await client.from("tenant_uw_answers").delete().eq("tenant_id", actor.tenantId).eq("interview_id", interviewId).in("question_key", hidden);
    if (del.error) fail(del.error, "Could not remove the hidden answers");
  }
  // Existing coverage drives the replacement notice; a disclosure that is now required means a `ready`
  // attempt fails QA again and goes back to draft (STATUS-MODEL §4), its extension grants with it.
  const apps = await client.from("tenant_applications").select("id, status").eq("tenant_id", actor.tenantId).eq("case_id", iv.data.case_id).eq("insured_role", iv.data.insured_role).neq("status", "closed");
  // Height, weight and tobacco answered on the call are the application's values too (source
  // "interview", checked by the agent who asked). A value a person typed is never replaced.
  const fromInterview = prefillFromInterview(Object.fromEntries(toSave.map((x) => [x.key, x.value])));
  for (const app of rows<{ id: string; status: string }>(apps.data)) {
    if (fromInterview.length) {
      const have = await client.from("tenant_application_values").select("field_key, value, source, linked_to_primary").eq("tenant_id", actor.tenantId).eq("application_id", app.id).in("field_key", fromInterview.map((v) => v.key));
      const existing = new Map(rows<{ field_key: string; value: unknown; source: string; linked_to_primary: boolean }>(have.data).map((r) => [r.field_key, r]));
      const writes = fromInterview.filter((v) => {
        const e = existing.get(v.key);
        return !e || (!e.linked_to_primary && INTERVIEW_MAY_REPLACE.includes(e.source) && JSON.stringify(e.value) !== JSON.stringify(v.value));
      });
      if (writes.length) {
        const up = await client.from("tenant_application_values").upsert(writes.map((v) => ({ application_id: app.id, tenant_id: actor.tenantId, field_key: v.key, value: v.value, value_ciphertext: null, value_last4: null, key_version: null, source: "interview", reviewed_at: now, reviewed_by: actor.userId, updated_by: actor.userId })), { onConflict: "application_id,field_key" });
        if (up.error) fail(up.error, "Could not carry the interview's answers onto the application");
      }
    }
    await refreshDisclosures(actor.tenantId, app.id);
    if (app.status === "ready") await demoteIfFailing(actor, app.id);
  }
  return { saved: toSave.length, removed: hidden.filter((k) => old.has(k)) };
}

export async function saveMedications(actor: Actor, interviewId: string, meds: { name: string; dose?: string; since?: string; prescribedFor?: string; prescribedForUnknown?: boolean; notes?: string }[]) {
  const client = db();
  const iv = await client.from("tenant_uw_interviews").select("id, completed_at").eq("tenant_id", actor.tenantId).eq("id", interviewId).maybeSingle();
  if (!iv.data) throw new ApplicationError("INTERVIEW_NOT_FOUND", "That interview could not be found.", 404);
  const list = meds.filter((m) => m.name.trim());
  if (iv.data.completed_at) {
    // After the call the medication list is amended like any answer (LA-3.2): old and new list, recorded first.
    const before = await client.from("tenant_medications").select("name, dose, since, prescribed_for, prescribed_for_unknown, notes").eq("tenant_id", actor.tenantId).eq("interview_id", interviewId).order("sort_order");
    if (before.error) fail(before.error, "Could not load the medications");
    const shape = (m: { name: string; dose: string | null; since: string | null; prescribed_for: string | null; prescribed_for_unknown: boolean; notes: string | null }) => ({ name: m.name, dose: m.dose, since: m.since, prescribed_for: m.prescribed_for, prescribed_for_unknown: m.prescribed_for_unknown, notes: m.notes });
    const oldList = rows<Parameters<typeof shape>[0]>(before.data).map(shape);
    const newList = list.map((m) => shape({ name: m.name.trim(), dose: m.dose?.trim() || null, since: m.since?.trim() || null, prescribed_for: m.prescribedForUnknown ? null : m.prescribedFor?.trim() || null, prescribed_for_unknown: Boolean(m.prescribedForUnknown), notes: m.notes?.trim() || null }));
    if (JSON.stringify(oldList) !== JSON.stringify(newList)) {
      const logged = await client.from("tenant_uw_answer_changes").insert({ interview_id: interviewId, tenant_id: actor.tenantId, question_key: "medications", old_value: oldList, new_value: newList, changed_by: actor.userId });
      if (logged.error) fail(logged.error, "Could not record the amendment");
    }
  }
  const del = await client.from("tenant_medications").delete().eq("tenant_id", actor.tenantId).eq("interview_id", interviewId);
  if (del.error) fail(del.error, "Could not save the medications");
  if (list.length) {
    const ins = await client.from("tenant_medications").insert(list.map((m, i) => ({
      interview_id: interviewId, tenant_id: actor.tenantId, name: m.name.trim(), dose: m.dose?.trim() || null, since: m.since?.trim() || null,
      prescribed_for: m.prescribedForUnknown ? null : m.prescribedFor?.trim() || null, prescribed_for_unknown: Boolean(m.prescribedForUnknown), notes: m.notes?.trim() || null, sort_order: i, created_by: actor.userId,
    })));
    if (ins.error) fail(ins.error, "Could not save the medications");
  }
  return { saved: list.length };
}

const wrap = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, value]) => [k, { value }]));

export async function completeInterview(actor: Actor, interviewId: string) {
  const client = db();
  const iv = await client.from("tenant_uw_interviews").select("id, case_id, insured_role, completed_at, sales_template_id").eq("tenant_id", actor.tenantId).eq("id", interviewId).maybeSingle();
  if (isMissingSchema(iv.error)) throw new SchemaPendingError("The underwriting interview");
  if (iv.error) fail(iv.error, "Could not load the interview");
  if (!iv.data) throw new ApplicationError("INTERVIEW_NOT_FOUND", "That interview could not be found.", 404);
  if (iv.data.completed_at) return { completed: true };
  // The same "required still to ask" the Interview step counts, decided here too: a stale client or a
  // hand-made request cannot complete an interview with a required question unanswered.
  const [tpl, answers, meds, app] = await Promise.all([
    iv.data.sales_template_id ? client.from("sales_templates").select("definition").eq("id", iv.data.sales_template_id).or(`tenant_id.is.null,tenant_id.eq.${actor.tenantId}`).maybeSingle() : Promise.resolve({ data: null, error: null }),
    client.from("tenant_uw_answers").select("question_key, value").eq("tenant_id", actor.tenantId).eq("interview_id", interviewId),
    client.from("tenant_medications").select("id", { count: "exact", head: true }).eq("tenant_id", actor.tenantId).eq("interview_id", interviewId),
    client.from("tenant_applications").select("id").eq("tenant_id", actor.tenantId).eq("case_id", iv.data.case_id).eq("insured_role", iv.data.insured_role).neq("status", "closed").order("attempt_no", { ascending: false }).limit(1),
  ]);
  if (answers.error) fail(answers.error, "Could not load the answers");
  const given = Object.fromEntries(rows<{ question_key: string; value: unknown }>(answers.data).map((r) => [r.question_key, r.value]));
  const appId = rows<{ id: string }>(app.data)[0]?.id;
  const facts = await (async () => {
    if (!appId) return insuredFacts({}, wrap(given));
    const vals = await client.from("tenant_application_values").select("field_key, value").eq("tenant_id", actor.tenantId).eq("application_id", appId).in("field_key", ["insured.dob", "insured.tobacco"]);
    return insuredFacts(wrap(Object.fromEntries(rows<{ field_key: string; value: unknown }>(vals.data).map((r) => [r.field_key, r.value]))), wrap(given));
  })();
  const missing = missingRequiredAnswers(interviewQuestions((tpl.data as { definition?: StoredDefinition } | null)?.definition), given, meds.count ?? 0, facts);
  if (missing.length) {
    const names = missing.slice(0, 3).map((q) => `“${q.label}”`).join(", ");
    throw new ApplicationError("INTERVIEW_INCOMPLETE", `${missing.length === 1 ? "One required question is" : `${missing.length} required questions are`} still to ask: ${names}${missing.length > 3 ? "…" : ""}.`, 409);
  }
  const { error } = await client.from("tenant_uw_interviews").update({ completed_at: new Date().toISOString() }).eq("tenant_id", actor.tenantId).eq("id", interviewId).is("completed_at", null);
  if (error) fail(error, "Could not complete the interview");
  return { completed: true };
}

// ── quotes (LA-3.5) ────────────────────────────────────────────────────────

export async function saveQuote(actor: Actor, caseId: string, input: {
  insuredRole: InsuredRole; carrierId: string; carrierProductId?: string | null; productCode: string; tier: string; faceAmountCents: number; monthlyPremiumCents: number;
  termLength?: number | null; assumedHealthClass?: string | null; annualPremiumCents?: number | null; riders?: { name: string; monthlyPremiumCents: number }[];
  ratingInputs?: Record<string, unknown>; quotationTemplateId?: string | null; templateVersion?: number | null; dob?: string | null; ageBasis?: "nearest" | "last";
}) {
  const client = db();
  const kase = await client.from("tenant_application_cases").select("id, lead_id").eq("tenant_id", actor.tenantId).eq("id", caseId).maybeSingle();
  if (!kase.data) throw new ApplicationError("CASE_NOT_FOUND", "That case could not be found.", 404);
  let limits: { carrier_id: string; product_code: string; issue_age_min: number | null; issue_age_max: number | null; face_min_cents: number | null; face_max_cents: number | null; premium_per_1000_band_min: number | null; premium_per_1000_band_max: number | null } | null = null;
  if (input.carrierProductId) {
    // The platform's product or this agency's own copy — never another agency's.
    const p = await client.from("carrier_products").select("carrier_id, product_code, issue_age_min, issue_age_max, face_min_cents, face_max_cents, premium_per_1000_band_min, premium_per_1000_band_max").eq("id", input.carrierProductId).or(`tenant_id.is.null,tenant_id.eq.${actor.tenantId}`).maybeSingle();
    if (p.error && !isMissingSchema(p.error)) fail(p.error, "Could not load the product");
    limits = p.data ?? null;
    if (!limits) throw new ApplicationError("QUOTE_PRODUCT_NOT_FOUND", "That product could not be found. Pick it again.", 404);
    if (limits.carrier_id !== input.carrierId || limits.product_code !== input.productCode) throw new ApplicationError("QUOTE_PRODUCT_MISMATCH", "That product is not this carrier's. Pick it again.", 400);
  }
  // The template the rating inputs were typed on must be a published quotation template this agency
  // can see, at the version named (LA-3.4: a saved quote references (template, version)).
  let sentInputs = input.ratingInputs;
  if (input.quotationTemplateId) {
    const t = await client.from("sales_templates").select("kind, version, status, definition").eq("id", input.quotationTemplateId).or(`tenant_id.is.null,tenant_id.eq.${actor.tenantId}`).maybeSingle();
    if (t.error && !isMissingSchema(t.error)) fail(t.error, "Could not load the quotation template");
    const row = t.data as { kind: string; version: number; status: string; definition: unknown } | null;
    if (!row || row.kind !== "quotation" || row.status === "draft") throw new ApplicationError("QUOTE_TEMPLATE_NOT_FOUND", "That quotation template could not be found. Reload the Quote step.", 400);
    if (input.templateVersion != null && input.templateVersion !== row.version) throw new ApplicationError("QUOTE_TEMPLATE_VERSION", "The quotation template changed while you were typing. Reload the Quote step.", 409);
    // The template decides what is asked and what is required (LA-3.4): a required input left empty
    // is refused, and an input it switched off is not stored ("not asked, not stored").
    const scoped = scopeRatingInputs(quotationFieldsOf(row.definition), input.ratingInputs, { faceAmountCents: input.faceAmountCents, tier: input.tier, dob: input.dob ?? null });
    if (scoped.missing.length) throw new ApplicationError("QUOTE_INPUT_REQUIRED", `${scoped.missing.join(", ")} ${scoped.missing.length === 1 ? "is" : "are"} required by this quotation template.`, 400);
    sentInputs = scoped.inputs;
  }
  const ageBasis = input.ageBasis ?? "nearest";
  const age = input.dob ? ratingAge(input.dob, ageBasis) : null;
  // The product's own band; else the agency's (LA-3.17 · Settings › Sales) — except term, which is
  // not judged by a Final Expense band (LA-3.25).
  const productBand = limits?.premium_per_1000_band_min != null && limits?.premium_per_1000_band_max != null ? { min: Number(limits.premium_per_1000_band_min), max: Number(limits.premium_per_1000_band_max) } : null;
  const fallback = bandFallback(input.productCode);
  const tenantBand = fallback === null ? null : resolveSalesSettings((await client.from("tenant_sales_settings").select("settings").eq("tenant_id", actor.tenantId).maybeSingle()).data?.settings).per1000Band;
  const check = checkQuote({
    monthlyPremiumCents: input.monthlyPremiumCents, faceCents: input.faceAmountCents, age,
    band: productBand ?? tenantBand,
    faceMinCents: limits?.face_min_cents, faceMaxCents: limits?.face_max_cents, issueAgeMin: limits?.issue_age_min, issueAgeMax: limits?.issue_age_max,
  });
  if (check.error) throw new ApplicationError("QUOTE_INVALID", check.error);
  const ratingInputs = freezeRatingInputs(sentInputs, { faceAmountCents: input.faceAmountCents, tier: input.tier, dob: input.dob ?? null, ageBasis, ageUsed: age, termLength: input.termLength ?? null, healthClass: input.assumedHealthClass ?? null });
  const ins = await client.from("tenant_quotes").insert({
    tenant_id: actor.tenantId, case_id: caseId, lead_id: kase.data.lead_id, insured_role: input.insuredRole, carrier_id: input.carrierId, carrier_product_id: input.carrierProductId ?? null,
    product_code: input.productCode, quotation_template_id: input.quotationTemplateId ?? null, template_revision: input.templateVersion ?? null, tier: input.tier,
    face_amount_cents: input.faceAmountCents, monthly_premium_cents: input.monthlyPremiumCents, annual_premium_cents: input.annualPremiumCents ?? null, term_length: input.termLength ?? null,
    assumed_health_class: input.assumedHealthClass ?? null, age_used: age, rating_inputs: ratingInputs, riders: (input.riders ?? []).map((r) => ({ name: r.name, monthly_premium_cents: r.monthlyPremiumCents })),
    warnings: check.warnings, status: "draft", created_by: actor.userId,
  }).select("id").single();
  if (ins.error) fail(ins.error, "Could not save the quote");
  // The first quote is what "quoted" means on the board (LA-3.23).
  await syncLeadStage(actor.tenantId, caseId);
  return { id: ins.data.id as string, warnings: check.warnings };
}

/** Select one quote for the live attempt: the others for this insured become discarded, none are deleted. */
export async function selectQuote(actor: Actor, quoteId: string) {
  const client = db();
  const q = await client.from("tenant_quotes").select("id, case_id, insured_role, carrier_id, carrier_product_id, product_code, tier, face_amount_cents, monthly_premium_cents, rating_inputs").eq("tenant_id", actor.tenantId).eq("id", quoteId).maybeSingle();
  if (!q.data) throw new ApplicationError("QUOTE_NOT_FOUND", "That quote could not be found.", 404);
  const live = await client.from("tenant_applications").select("id, status").eq("tenant_id", actor.tenantId).eq("case_id", q.data.case_id).eq("insured_role", q.data.insured_role).neq("status", "closed").maybeSingle();
  if (!live.data) throw new ApplicationError("APPLICATION_NOT_FOUND", "There is no open attempt to put this quote on.", 409);
  if (!["draft", "ready"].includes(live.data.status)) throw new ApplicationError("APPLICATION_SUBMITTED", "This attempt has been submitted — its quote can't change.", 409);
  const appId = live.data.id as string;
  const d = await client.from("tenant_quotes").update({ status: "discarded" }).eq("tenant_id", actor.tenantId).eq("case_id", q.data.case_id).eq("insured_role", q.data.insured_role).neq("id", quoteId).in("status", ["draft", "presented", "selected"]);
  if (d.error) fail(d.error, "Could not select the quote");
  const s = await client.from("tenant_quotes").update({ status: "selected", application_id: appId }).eq("tenant_id", actor.tenantId).eq("id", quoteId);
  if (s.error) fail(s.error, "Could not select the quote");
  const u = await client.from("tenant_applications").update({ quote_id: quoteId, carrier_id: q.data.carrier_id, carrier_product_id: q.data.carrier_product_id, product_code: q.data.product_code }).eq("tenant_id", actor.tenantId).eq("id", appId);
  if (u.error) fail(u.error, "Could not select the quote");
  // A different carrier means a different form: a ready attempt goes back to draft to be checked again.
  if (live.data.status === "ready") {
    const back = await client.rpc("application_transition", { p_tenant_id: actor.tenantId, p_application_id: appId, p_actor: actor.userId, p_to: "draft", p_outcome: null, p_reason_code: null, p_reason_text: null });
    if (back.error) rpcError(back.error, "Could not reopen the application");
    await revokeGrants(actor.tenantId, appId, "quote_changed");
  }
  const cov = [
    { key: "cov.face_amount", value: q.data.face_amount_cents },
    { key: "cov.monthly_premium", value: q.data.monthly_premium_cents },
    { key: "cov.product_tier", value: q.data.tier },
  ];
  await client.from("tenant_application_values").upsert(cov.map((c) => ({ application_id: appId, tenant_id: actor.tenantId, field_key: c.key, value: c.value, value_ciphertext: null, value_last4: null, key_version: null, source: "quote", reviewed_at: new Date().toISOString(), reviewed_by: actor.userId, updated_by: actor.userId })), { onConflict: "application_id,field_key" });
  // LA-3.7 · the date of birth, gender, tobacco and state the premium was rated on reach the
  // application, marked "from the quote" and unreviewed. A value a person typed (or the interview
  // gave, or the household shares) is never replaced; one the lead or the last attempt guessed is.
  const fromQuote = prefillFromQuote(q.data.rating_inputs as Record<string, unknown> | null);
  if (fromQuote.length) {
    const have = await client.from("tenant_application_values").select("field_key, value, source, linked_to_primary").eq("tenant_id", actor.tenantId).eq("application_id", appId).in("field_key", fromQuote.map((v) => v.key));
    const existing = new Map(rows<{ field_key: string; value: unknown; source: string; linked_to_primary: boolean }>(have.data).map((r) => [r.field_key, r]));
    const writes = fromQuote.filter((v) => {
      const e = existing.get(v.key);
      return !e || (!e.linked_to_primary && QUOTE_MAY_REPLACE.includes(e.source) && JSON.stringify(e.value) !== JSON.stringify(v.value));
    });
    if (writes.length) {
      const up = await client.from("tenant_application_values").upsert(writes.map((v) => ({ application_id: appId, tenant_id: actor.tenantId, field_key: v.key, value: v.value, value_ciphertext: null, value_last4: null, key_version: null, source: "quote", reviewed_at: null, reviewed_by: null, updated_by: actor.userId })), { onConflict: "application_id,field_key" });
      if (up.error) fail(up.error, "Could not carry the quote's details onto the application");
    }
  }
  await refreshDisclosures(actor.tenantId, appId);
  await syncLeadStage(actor.tenantId, q.data.case_id);
  return { applicationId: appId };
}

// ── transitions (STATUS-MODEL §4) ──────────────────────────────────────────

/** Every live extension grant for this attempt stops working (LA-3.12). Absent schema: nothing to revoke. */
export async function revokeGrants(tenantId: string, applicationId: string, reason: string) {
  const { error } = await db().from("tenant_extension_grants").update({ revoked_at: new Date().toISOString(), revoked_reason: reason }).eq("tenant_id", tenantId).eq("application_id", applicationId).is("revoked_at", null);
  if (error && !isMissingSchema(error)) throw new ApplicationError("APPLICATION_UNAVAILABLE", error.message, 500);
}

/** `ready` → `draft` when an edit makes the verdict `fail` again (STATUS-MODEL §4). */
export async function demoteIfFailing(actor: Who, applicationId: string) {
  const head = await attemptHead(actor.tenantId, applicationId, { allowClosed: true });
  if (head.status !== "ready") return;
  const { verdict } = await qaFor(actor.tenantId, applicationId);
  if (verdict.verdict !== "fail") return;
  const back = await db().rpc("application_transition", { p_tenant_id: actor.tenantId, p_application_id: applicationId, p_actor: actor.userId, p_to: "draft", p_outcome: null, p_reason_code: null, p_reason_text: null });
  if (back.error) rpcError(back.error, "Could not reopen the application");
  await revokeGrants(actor.tenantId, applicationId, "qa_failed_after_edit");
}

async function qaFor(tenantId: string, applicationId: string): Promise<{ view: CaseView; verdict: QaVerdict }> {
  const head = await attemptHead(tenantId, applicationId, { allowClosed: true });
  const view = await getCaseView(tenantId, head.case_id);
  const attempt = view.attempts.find((x) => x.id === applicationId)!;
  const settings = await db().from("tenant_sales_settings").select("settings").eq("tenant_id", tenantId).maybeSingle();
  const s = resolveSalesSettings(settings.data?.settings);
  return { view, verdict: runQa({ caseId: view.caseId, attempt, interview: view.interviews[attempt.insuredRole] ?? null, settings: { appointmentBlocks: s.appointmentBlocks, per1000Band: s.per1000Band } }) };
}

export async function transition(actor: Actor, applicationId: string, input: { to: string; outcome?: ApplicationOutcome | null; reasonCode?: string | null; reasonText?: string | null; policyNumber?: string | null; issuedOn?: string | null }) {
  // The edges that carry their own record go through their own service (transitionRules.ts).
  const refused = genericTransitionRefusal(input.to, input.outcome ?? null);
  if (refused) throw new ApplicationError(refused.code, refused.message, 409);
  if (input.to === "ready") {
    const { verdict } = await qaFor(actor.tenantId, applicationId);
    if (verdict.verdict === "fail") throw new ApplicationError("QA_FAILED", `${verdict.blocking.length} thing${verdict.blocking.length === 1 ? "" : "s"} will get this kicked back — fix them first.`, 409);
  }
  if (input.to === "closed" && input.outcome && OUTCOMES_NEEDING_REASON.includes(input.outcome) && !input.reasonCode) throw new ApplicationError("APPLICATION_OUTCOME_REASON_REQUIRED", "Choose a reason for this outcome.");
  if (input.to === "closed" && input.reasonCode === "other" && !input.reasonText?.trim()) throw new ApplicationError("APPLICATION_OUTCOME_REASON_REQUIRED", "Say what the reason was.");
  const { data, error } = await db().rpc("application_transition", { p_tenant_id: actor.tenantId, p_application_id: applicationId, p_actor: actor.userId, p_to: input.to, p_outcome: input.outcome ?? null, p_reason_code: input.reasonCode ?? null, p_reason_text: input.reasonText ?? null });
  if (error) rpcError(error, "Could not move the application");
  const row = rows<{ application_id: string; status: string; outcome: string | null; case_status: string }>(data)[0];
  // Back to draft: no extension grant outlives the `ready` state it was minted for (STATUS-MODEL §4).
  if (input.to === "draft") await revokeGrants(actor.tenantId, applicationId, "returned_to_draft");

  // An attempt closed while the client was still weighing a counteroffer (withdrawn, say) answers it:
  // the offer is not left open against a closed attempt, and its waiting-on-client requirement goes too.
  if (input.to === "closed") {
    await closeOpenCounteroffer(actor, applicationId, input.outcome ?? null);
    await waiveOpenRequirements(actor, applicationId);
  }

  let policy: { linked: boolean; message: string | null } | null = null;
  if (input.to === "closed" && input.outcome === "issued") policy = await linkIssuedPolicy(actor, applicationId, input.policyNumber ?? null, input.issuedOn ?? null);
  await audit({ actorType: "tenant", actorId: actor.userId, action: "tenant.application_transitioned", targetType: "tenant_application", targetId: applicationId, metadata: { to: input.to, outcome: input.outcome ?? null, reasonCode: input.reasonCode ?? null }, request: actor.request });
  await syncLeadStageForApplication(actor.tenantId, applicationId);
  return { ...row, policy };
}

async function closeOpenCounteroffer(actor: Actor, applicationId: string, outcome: ApplicationOutcome | null) {
  const client = db();
  const now = new Date().toISOString();
  const status = outcome === "offer_expired" ? "expired" : "rejected";
  const upd = await client.from("tenant_application_counteroffers")
    .update({ status, responded_at: status === "expired" ? null : now, responded_by: status === "expired" ? null : actor.userId, client_response_note: status === "rejected" ? "The attempt was closed before the client answered." : null })
    .eq("tenant_id", actor.tenantId).eq("application_id", applicationId).eq("status", "pending_client").select("requirement_id");
  if (upd.error) {
    if (isMissingSchema(upd.error)) return;
    fail(upd.error, "Could not close the open counteroffer");
  }
  const reqIds = rows<{ requirement_id: string | null }>(upd.data).map((r) => r.requirement_id).filter((x): x is string => Boolean(x));
  if (reqIds.length) {
    await client.from("tenant_application_requirements").update({ status: status === "expired" ? "expired" : "waived", satisfied_at: status === "expired" ? null : now.slice(0, 10) })
      .eq("tenant_id", actor.tenantId).in("id", reqIds).in("status", ["open", "in_progress"]);
  }
}

/** On issue: the policy number joins Module 4 through the existing LA-2.17 RPC (tenant_issued_policies). */
async function linkIssuedPolicy(actor: Actor, applicationId: string, policyNumber: string | null, issuedOn: string | null) {
  const client = db();
  const head = await attemptHead(actor.tenantId, applicationId, { allowClosed: true });
  const sub = await client.from("tenant_application_submissions").select("id, carrier_reference, policy_number").eq("tenant_id", actor.tenantId).eq("application_id", applicationId).order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  const number = policyNumber?.trim() || sub.data?.policy_number || null;
  if (policyNumber?.trim() && sub.data) await client.from("tenant_application_submissions").update({ policy_number: policyNumber.trim() }).eq("tenant_id", actor.tenantId).eq("id", sub.data.id);
  if (!number) return { linked: false, message: "Recorded as issued. Add the policy number so the commission can find this sale." };
  const [deal, carrier] = await Promise.all([
    client.from("deal_flow").select("id").eq("tenant_id", actor.tenantId).eq("lead_id", head.lead_id).maybeSingle(),
    head.carrier_id ? client.from("carriers").select("name").eq("id", head.carrier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!deal.data || !carrier.data) return { linked: false, message: "Recorded as issued, but the deal row was not found to attach the policy to." };
  try {
    await markDealPolicyIssued(actor.tenantId, { dealId: deal.data.id, carrier: carrier.data.name, policyNumber: number, issuedOn: issuedOn ?? new Date().toISOString().slice(0, 10) });
    return { linked: true, message: null };
  } catch (e) {
    return { linked: false, message: e instanceof Error ? e.message : "The policy could not be attached to the deal." };
  }
}

// ── submission capture (LA-3.15) ───────────────────────────────────────────

export async function recordSubmission(actor: Actor, applicationId: string, input: { reference: string | null; referenceKind: "application_no" | "policy_no"; submittedAt: string | null; submittedVia: "extension" | "copy_assist" | "carrier_portal_manual"; notes?: string | null }) {
  const head = await attemptHead(actor.tenantId, applicationId);
  if (head.status !== "ready") throw new ApplicationError("APPLICATION_NOT_READY", "Mark the application ready before recording the submission.", 409);
  const { view, verdict } = await qaFor(actor.tenantId, applicationId);
  if (verdict.verdict === "fail") throw new ApplicationError("QA_FAILED", "Something changed since it was marked ready — fix the items on the Review step.", 409);
  const attempt = view.attempts.find((a) => a.id === applicationId)!;
  const interview = view.interviews[attempt.insuredRole] ?? null;
  const client = db();
  const reference = input.reference?.trim() || null;
  let duplicate: { applicationId: string; caseId: string } | null = null;
  if (reference && head.carrier_id) {
    const dup = await client.from("tenant_application_submissions").select("application_id").eq("tenant_id", actor.tenantId).eq("carrier_id", head.carrier_id).eq("carrier_reference", reference).neq("application_id", applicationId).limit(1).maybeSingle();
    if (dup.data) {
      const other = await client.from("tenant_applications").select("case_id").eq("tenant_id", actor.tenantId).eq("id", dup.data.application_id).maybeSingle();
      duplicate = { applicationId: dup.data.application_id, caseId: other.data?.case_id ?? "" };
    }
  }
  const ins = await client.from("tenant_application_submissions").insert({
    tenant_id: actor.tenantId, application_id: applicationId, attempt_no: head.attempt_no, carrier_id: head.carrier_id, carrier_reference: reference,
    reference_kind: reference ? input.referenceKind : null, policy_number: reference && input.referenceKind === "policy_no" ? reference : null,
    submitted_at: input.submittedAt ?? new Date().toISOString(), submitted_via: input.submittedVia, qa_verdict: verdict,
    health_snapshot: interview ? { answers: interview.answers, medications: interview.medications, template: interview.templateName, revision: interview.templateRevision } : {}, notes: input.notes?.trim() || null, created_by: actor.userId,
  }).select("id").single();
  if (ins.error) fail(ins.error, "Could not record the submission");
  const moved = await client.rpc("application_transition", { p_tenant_id: actor.tenantId, p_application_id: applicationId, p_actor: actor.userId, p_to: "submitted", p_outcome: null, p_reason_code: null, p_reason_text: null });
  if (moved.error) rpcError(moved.error, "Could not mark the application submitted");
  // The fill is done: no extension grant outlives the `ready` state it was minted for (LA-3.12).
  await revokeGrants(actor.tenantId, applicationId, "submitted");
  // The deal row (LA-1.13) takes its figures from the attempt, not from typed text. draft_date is left alone (Q8).
  const quote = attempt.quotes.find((q) => q.id === attempt.selectedQuoteId);
  if (quote) {
    await client.from("deal_flow").update({ carrier: attempt.carrierName, product_type: attempt.productLabel ?? attempt.productCode, monthly_premium_cents: quote.monthlyPremiumCents, face_amount_cents: quote.faceAmountCents, updated_at: new Date().toISOString() })
      .eq("tenant_id", actor.tenantId).eq("lead_id", head.lead_id);
  }
  await audit({ actorType: "tenant", actorId: actor.userId, action: "tenant.application_submitted", targetType: "tenant_application", targetId: applicationId, metadata: { reference, via: input.submittedVia, verdict: verdict.verdict }, request: actor.request });
  await syncLeadStageForApplication(actor.tenantId, applicationId);
  return { submissionId: ins.data.id as string, duplicate };
}

export async function setSubmissionReference(actor: Actor, applicationId: string, submissionId: string, input: { reference?: string | null; policyNumber?: string | null }) {
  await attemptHead(actor.tenantId, applicationId, { allowClosed: true });
  const patch: Record<string, unknown> = {};
  if (input.reference !== undefined) { patch.carrier_reference = input.reference?.trim() || null; patch.reference_kind = input.reference?.trim() ? "application_no" : null; }
  // A later policy number never overwrites the application number it was submitted under.
  if (input.policyNumber !== undefined) patch.policy_number = input.policyNumber?.trim() || null;
  const { error } = await db().from("tenant_application_submissions").update(patch).eq("tenant_id", actor.tenantId).eq("application_id", applicationId).eq("id", submissionId);
  if (error) fail(error, "Could not save the reference");
  return { saved: true };
}

// ── next attempt (LA-3.16) ─────────────────────────────────────────────────

export async function openNextAttempt(actor: Actor, applicationId: string) {
  const client = db();
  const { data, error } = await client.rpc("open_next_attempt", { p_tenant_id: actor.tenantId, p_application_id: applicationId, p_actor: actor.userId });
  if (error) rpcError(error, "Could not open the next attempt");
  const nextId = (typeof data === "string" ? data : rows<{ open_next_attempt: string }>(data)[0]?.open_next_attempt) as string;
  // The RPC does not carry the product line: without it the retry's Quote step opened on Final
  // Expense for a Term Life case, and its field set fell back to the generic one. The case's line
  // (what the first attempt started on) until a quote picks the product.
  const prev = await attemptHead(actor.tenantId, applicationId, { allowClosed: true });
  const kase = await client.from("tenant_application_cases").select("product_line").eq("tenant_id", actor.tenantId).eq("id", prev.case_id).maybeSingle();
  const productCode = (kase.data?.product_line as string | null | undefined) ?? prev.product_code;
  if (productCode) {
    const set = await client.from("tenant_applications").update({ product_code: productCode }).eq("tenant_id", actor.tenantId).eq("id", nextId).is("product_code", null);
    if (set.error) fail(set.error, "Could not set the new attempt's product");
  }
  // Ciphertext is bound to its application, so carried sensitive values are re-encrypted, not copied.
  const ssnRow = await client.from("tenant_application_values").select("value_ciphertext, key_version").eq("tenant_id", actor.tenantId).eq("application_id", applicationId).eq("field_key", "insured.ssn").maybeSingle();
  if (ssnRow.data?.value_ciphertext) {
    const plain = decryptSensitive(ssnRow.data.value_ciphertext, ssnRow.data.key_version, { tenantId: actor.tenantId, applicationId, fieldKey: "insured.ssn" });
    if (plain) {
      const e = encryptSensitive(plain, { tenantId: actor.tenantId, applicationId: nextId, fieldKey: "insured.ssn" });
      await client.from("tenant_application_values").upsert({ application_id: nextId, tenant_id: actor.tenantId, field_key: "insured.ssn", value: null, value_ciphertext: e.ciphertext, value_last4: plain.slice(-4), key_version: e.keyVersion, source: "carried_forward", updated_by: actor.userId }, { onConflict: "application_id,field_key" });
    }
  }
  const pay = await client.from("tenant_application_payment_methods").select("routing_ciphertext, account_ciphertext, card_ciphertext, key_version, routing_last4, account_last4, card_last4").eq("tenant_id", actor.tenantId).eq("application_id", applicationId).maybeSingle();
  if (pay.data) {
    const patch: Record<string, unknown> = {};
    for (const [col, key, last] of [["routing_ciphertext", "pay.routing_number", "routing_last4"], ["account_ciphertext", "pay.account_number", "account_last4"], ["card_ciphertext", "pay.card_number", "card_last4"]] as const) {
      const c = pay.data[col] as string | null;
      if (!c) continue;
      const plain = decryptSensitive(c, pay.data.key_version, { tenantId: actor.tenantId, applicationId, fieldKey: key });
      if (!plain) continue;
      const e = encryptSensitive(plain, { tenantId: actor.tenantId, applicationId: nextId, fieldKey: key });
      patch[col] = e.ciphertext; patch[last] = pay.data[last]; patch.key_version = e.keyVersion;
    }
    if (Object.keys(patch).length) await client.from("tenant_application_payment_methods").update(patch).eq("tenant_id", actor.tenantId).eq("application_id", nextId);
  }
  await audit({ actorType: "tenant", actorId: actor.userId, action: "tenant.application_attempt_opened", targetType: "tenant_application", targetId: nextId, metadata: { supersedes: applicationId }, request: actor.request });
  await syncLeadStageForApplication(actor.tenantId, nextId);
  return { applicationId: nextId };
}

export async function closeCase(actor: Actor, caseId: string, input: { reasonCode: string; reasonText?: string | null }) {
  const client = db();
  const live = await client.from("tenant_applications").select("id").eq("tenant_id", actor.tenantId).eq("case_id", caseId).neq("status", "closed");
  if (rows(live.data).length) throw new ApplicationError("CASE_HAS_LIVE_ATTEMPT", "Close or withdraw the open attempt first.", 409);
  const { data, error } = await client.from("tenant_application_cases").update({ status: "lost", outcome_reason_code: input.reasonCode, outcome_reason_text: input.reasonText?.trim() || null, closed_at: new Date().toISOString(), closed_by: actor.userId, updated_at: new Date().toISOString() })
    .eq("tenant_id", actor.tenantId).eq("id", caseId).eq("status", "open").select("id");
  if (error) fail(error, "Could not close the case");
  if (!rows(data).length) throw new ApplicationError("CASE_NOT_OPEN", "That case is not open.", 409);
  await syncLeadStage(actor.tenantId, caseId);
  return { status: "lost" };
}
