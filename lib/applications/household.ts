import "server-only";

import { auditAfterSubmit } from "./afterAudit";
import { isHouseholdKey } from "./afterSubmitRules";
import { decryptSensitive, encryptSensitive } from "./crypto";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError } from "./db";
import { demoteIfFailing, ensureInterview } from "./mutations";
import { attemptHead, fail, type Actor } from "./requirements";

/**
 * LA-3.24 spouse-linked applications. A spouse is a second insured on the SAME case (STATUS-MODEL
 * §7): their own attempt, statuses, interview and QA. What may be shared is the address, contact
 * details, the payment method and the draft day — each copied with `linked_to_primary`, so a later
 * change on the primary follows them until it is detached. Nothing about health, identity or the
 * interview is ever copied: `insured.*` values are typed fresh for the spouse, and the interview
 * starts empty.
 */

type ValueRow = { field_key: string; value: unknown; value_ciphertext: string | null; source: string; linked_to_primary: boolean };
const SECRET_COLUMNS = [["routing_ciphertext", "pay.routing_number", "routing_last4"], ["account_ciphertext", "pay.account_number", "account_last4"], ["card_ciphertext", "pay.card_number", "card_last4"]] as const;
const PAYMENT_COPY = "method, account_type, bank_name, name_on_account, card_exp_month, card_exp_year, card_brand, name_on_card, billing_frequency, billing_address_same_as_insured, draft_income_type, draft_income_inputs, draft_day_recommended, draft_day_override_reason, draft_day_overridden_by, draft_day_overridden_at, routing_ciphertext, routing_last4, account_ciphertext, account_last4, card_ciphertext, card_last4, key_version";

/** The primary insured's attempt a spouse follows: the live one, else the newest. */
async function primaryAttempt(tenantId: string, caseId: string) {
  const q = await db().from("tenant_applications").select("id, status, attempt_no, draft_day").eq("tenant_id", tenantId).eq("case_id", caseId).eq("insured_role", "primary").order("attempt_no", { ascending: false });
  if (q.error) { if (isMissingSchema(q.error)) throw new SchemaPendingError("The application record"); fail(q.error, "Could not load the application"); }
  const list = rows<{ id: string; status: string; attempt_no: number; draft_day: number | null }>(q.data);
  return list.find((a) => a.status !== "closed") ?? list[0] ?? null;
}

/**
 * Copy the payment method from one application to another. Ciphertext is bound to the application
 * it was written for, so each number is decrypted and re-encrypted for the target — never copied.
 */
async function copyPayment(tenantId: string, fromId: string, toId: string, userId: string, linked: boolean) {
  const src = await db().from("tenant_application_payment_methods").select(PAYMENT_COPY).eq("tenant_id", tenantId).eq("application_id", fromId).maybeSingle();
  if (src.error) fail(src.error, "Could not load the payment method");
  if (!src.data) return false;
  const p = src.data as Record<string, unknown>;
  const row: Record<string, unknown> = { ...p, application_id: toId, tenant_id: tenantId, linked_to_primary: linked, updated_by: userId };
  let keyVersion: number | null = null;
  for (const [col, key, last] of SECRET_COLUMNS) {
    row[col] = null;
    row[last] = null;
    const c = p[col] as string | null;
    if (!c) continue;
    const plain = decryptSensitive(c, (p.key_version as number | null) ?? null, { tenantId, applicationId: fromId, fieldKey: key });
    if (!plain) continue;
    const e = encryptSensitive(plain, { tenantId, applicationId: toId, fieldKey: key });
    row[col] = e.ciphertext;
    row[last] = p[last];
    keyVersion = e.keyVersion;
  }
  row.key_version = keyVersion;
  const up = await db().from("tenant_application_payment_methods").upsert(row, { onConflict: "application_id" });
  if (up.error) fail(up.error, "Could not share the payment method");
  return true;
}

// ── add spouse ─────────────────────────────────────────────────────────────

export async function addSpouse(actor: Actor, caseId: string, input: {
  first_name: string; last_name: string; dob?: string | null; gender?: "female" | "male" | null;
  share_address: boolean; share_contact: boolean; share_payment: boolean; share_draft_day: boolean;
}) {
  const client = db();
  const kase = await client.from("tenant_application_cases").select("id, lead_id, status, product_line").eq("tenant_id", actor.tenantId).eq("id", caseId).maybeSingle();
  if (kase.error) fail(kase.error, "Could not load the case");
  if (!kase.data) throw new ApplicationError("CASE_NOT_FOUND", "That case could not be found.", 404);
  if (kase.data.status !== "open") throw new ApplicationError("CASE_NOT_OPEN", "This case is closed — a spouse can only be added to an open case.", 409);
  const existing = await client.from("tenant_applications").select("id").eq("tenant_id", actor.tenantId).eq("case_id", caseId).eq("insured_role", "spouse").limit(1);
  if (rows(existing.data).length) throw new ApplicationError("SPOUSE_EXISTS", "This household already has a spouse application.", 409);
  const primary = await primaryAttempt(actor.tenantId, caseId);
  if (!primary) throw new ApplicationError("APPLICATION_NOT_FOUND", "Start the primary application first.", 409);

  const shareDraft = input.share_draft_day;
  const created = await client.from("tenant_applications").insert({
    tenant_id: actor.tenantId, case_id: caseId, lead_id: kase.data.lead_id, insured_role: "spouse", attempt_no: 1,
    product_code: kase.data.product_line ?? null, draft_day: shareDraft ? primary.draft_day : null, created_by: actor.userId,
  }).select("id").single();
  if (created.error) {
    if (created.error.code === "23505") throw new ApplicationError("SPOUSE_EXISTS", "This household already has a spouse application.", 409);
    fail(created.error, "Could not add the spouse");
  }
  const spouseId = created.data.id as string;
  if (shareDraft) {
    const link = await client.from("tenant_applications").update({ draft_day_linked: true }).eq("tenant_id", actor.tenantId).eq("id", spouseId);
    if (link.error && !isMissingSchema(link.error)) fail(link.error, "Could not link the draft day");
  }

  const now = new Date().toISOString();
  // The spouse's own identity, typed in the dialog — not copied from anyone.
  const own = [
    { key: "insured.first_name", value: input.first_name.trim() },
    { key: "insured.last_name", value: input.last_name.trim() },
    ...(input.dob ? [{ key: "insured.dob", value: input.dob }] : []),
    ...(input.gender ? [{ key: "insured.gender", value: input.gender }] : []),
  ].map((v) => ({ application_id: spouseId, tenant_id: actor.tenantId, field_key: v.key, value: v.value, source: "manual", linked_to_primary: false, reviewed_at: now, reviewed_by: actor.userId, updated_by: actor.userId }));

  // Address and contact only (the DB CHECK allows nothing else to be linked). Plain values only.
  const prefixes = [...(input.share_address ? ["addr."] : []), ...(input.share_contact ? ["contact."] : [])];
  let shared: Record<string, unknown>[] = [];
  if (prefixes.length) {
    const vals = await client.from("tenant_application_values").select("field_key, value, value_ciphertext, source, linked_to_primary").eq("tenant_id", actor.tenantId).eq("application_id", primary.id);
    if (vals.error) fail(vals.error, "Could not read the household details");
    shared = rows<ValueRow>(vals.data)
      .filter((v) => prefixes.some((p) => v.field_key.startsWith(p)) && isHouseholdKey(v.field_key) && v.value_ciphertext === null && v.value !== null)
      .map((v) => ({ application_id: spouseId, tenant_id: actor.tenantId, field_key: v.field_key, value: v.value, source: "household", linked_to_primary: true, updated_by: actor.userId }));
  }
  const ins = await client.from("tenant_application_values").upsert([...own, ...shared], { onConflict: "application_id,field_key" });
  if (ins.error) fail(ins.error, "Could not add the spouse's details");

  const paymentShared = input.share_payment ? await copyPayment(actor.tenantId, primary.id, spouseId, actor.userId, true) : false;
  // Two people, two interviews: the spouse's starts empty.
  await ensureInterview(actor, caseId, "spouse");
  await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_spouse_added", targetId: spouseId, metadata: { caseId, primaryApplicationId: primary.id, sharedKeys: shared.map((s) => s.field_key), paymentShared, draftDayShared: shareDraft }, request: actor.request });
  return { applicationId: spouseId, sharedKeys: shared.map((s) => s.field_key as string), paymentShared, draftDayShared: shareDraft };
}

// ── detach ─────────────────────────────────────────────────────────────────

/** Stop one shared value (or the payment method, or the draft day) tracking the primary. The value stays. */
export async function detachShared(actor: Actor, applicationId: string, fieldKey: string) {
  const a = await attemptHead(actor.tenantId, applicationId);
  if (a.insured_role !== "spouse") throw new ApplicationError("NOT_SPOUSE", "Only the spouse's application follows the other one.", 409);
  const client = db();
  let changed = false;
  if (fieldKey === "payment") {
    const u = await client.from("tenant_application_payment_methods").update({ linked_to_primary: false, updated_by: actor.userId }).eq("tenant_id", actor.tenantId).eq("application_id", a.id).eq("linked_to_primary", true).select("application_id");
    if (u.error) fail(u.error, "Could not detach the payment method");
    changed = rows(u.data).length > 0;
  } else if (fieldKey === "draft_day") {
    const u = await client.from("tenant_applications").update({ draft_day_linked: false }).eq("tenant_id", actor.tenantId).eq("id", a.id).eq("draft_day_linked", true).select("id");
    if (u.error) fail(u.error, "Could not detach the draft day");
    changed = rows(u.data).length > 0;
  } else {
    if (!isHouseholdKey(fieldKey)) throw new ApplicationError("FIELD_NOT_SHARED", "Only address and contact details are shared.");
    // Detached means "this one's own now": typed here, no longer the household's.
    const u = await client.from("tenant_application_values").update({ linked_to_primary: false, source: "manual", updated_by: actor.userId }).eq("tenant_id", actor.tenantId).eq("application_id", a.id).eq("field_key", fieldKey).eq("linked_to_primary", true).select("field_key");
    if (u.error) fail(u.error, "Could not detach that detail");
    changed = rows(u.data).length > 0;
  }
  if (changed) await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_household_detached", targetId: a.id, metadata: { fieldKey }, request: actor.request });
  return { detached: changed };
}

// ── keep linked values in step ─────────────────────────────────────────────

/**
 * After the primary insured's values or payment change: copy every still-linked household value,
 * the linked payment method and the linked draft day onto the spouse's live, not-yet-submitted
 * attempt. Call it from the values, payment and draft-day routes after their save succeeds. A spouse
 * already submitted is left alone — the carrier has what was sent.
 */
export async function syncHouseholdFromPrimary(tenantId: string, primaryApplicationId: string, userId: string) {
  const client = db();
  const head = await client.from("tenant_applications").select("id, case_id, insured_role, draft_day").eq("tenant_id", tenantId).eq("id", primaryApplicationId).maybeSingle();
  if (head.error) { if (isMissingSchema(head.error)) return { synced: 0 }; fail(head.error, "Could not load the application"); }
  if (!head.data || head.data.insured_role !== "primary") return { synced: 0 };
  let spouseQ = await client.from("tenant_applications").select("id, status, draft_day, draft_day_linked").eq("tenant_id", tenantId).eq("case_id", head.data.case_id).eq("insured_role", "spouse").in("status", ["draft", "ready"]);
  if (spouseQ.error && isMissingSchema(spouseQ.error)) spouseQ = await client.from("tenant_applications").select("id, status, draft_day").eq("tenant_id", tenantId).eq("case_id", head.data.case_id).eq("insured_role", "spouse").in("status", ["draft", "ready"]);
  if (spouseQ.error) fail(spouseQ.error, "Could not load the household");
  const spouses = rows<{ id: string; status: string; draft_day: number | null; draft_day_linked?: boolean }>(spouseQ.data);
  if (!spouses.length) return { synced: 0 };

  const primaryVals = await client.from("tenant_application_values").select("field_key, value, value_ciphertext").eq("tenant_id", tenantId).eq("application_id", primaryApplicationId);
  if (primaryVals.error) fail(primaryVals.error, "Could not read the household details");
  const byKey = new Map(rows<ValueRow>(primaryVals.data).filter((v) => isHouseholdKey(v.field_key) && v.value_ciphertext === null).map((v) => [v.field_key, v.value]));
  let synced = 0;
  for (const s of spouses) {
    const linked = await client.from("tenant_application_values").select("field_key, value").eq("tenant_id", tenantId).eq("application_id", s.id).eq("linked_to_primary", true);
    if (linked.error) fail(linked.error, "Could not read the spouse's details");
    const linkedKeys = rows<{ field_key: string; value: unknown }>(linked.data);
    const upserts = linkedKeys.filter((v) => byKey.has(v.field_key) && JSON.stringify(byKey.get(v.field_key)) !== JSON.stringify(v.value))
      .map((v) => ({ application_id: s.id, tenant_id: tenantId, field_key: v.field_key, value: byKey.get(v.field_key), value_ciphertext: null, value_last4: null, key_version: null, source: "household", linked_to_primary: true, reviewed_at: null, updated_by: userId }));
    // A value the primary cleared is cleared on the linked side too (a row can't hold "nothing").
    const cleared = linkedKeys.filter((v) => !byKey.has(v.field_key) || byKey.get(v.field_key) === null).map((v) => v.field_key);
    if (upserts.length) {
      const u = await client.from("tenant_application_values").upsert(upserts, { onConflict: "application_id,field_key" });
      if (u.error) fail(u.error, "Could not keep the spouse's details in step");
    }
    if (cleared.length) await client.from("tenant_application_values").delete().eq("tenant_id", tenantId).eq("application_id", s.id).eq("linked_to_primary", true).in("field_key", cleared);
    // A primary that added a household value the spouse never had does not push it: linking is per key.
    synced += upserts.length + cleared.length;

    const pay = await client.from("tenant_application_payment_methods").select("linked_to_primary").eq("tenant_id", tenantId).eq("application_id", s.id).maybeSingle();
    if (pay.data?.linked_to_primary) { await copyPayment(tenantId, primaryApplicationId, s.id, userId, true); synced += 1; }
    let changedHere = upserts.length + cleared.length + (pay.data?.linked_to_primary ? 1 : 0);
    if (s.draft_day_linked && s.draft_day !== head.data.draft_day) {
      await client.from("tenant_applications").update({ draft_day: head.data.draft_day }).eq("tenant_id", tenantId).eq("id", s.id);
      synced += 1;
      changedHere += 1;
    }
    // A `ready` spouse whose shared detail just changed is checked again: one that now fails QA goes
    // back to draft (STATUS-MODEL §4). Only the spouse's own verdict decides — the primary's never does.
    if (changedHere && s.status === "ready") await demoteIfFailing({ tenantId, userId }, s.id);
  }
  return { synced };
}
