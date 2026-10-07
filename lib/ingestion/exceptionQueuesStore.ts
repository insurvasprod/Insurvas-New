import "server-only";

import { addressHash, addressSearch, nameSearch, normalizePhone, normalizeText } from "@/lib/contacts/normalization";
import type { ContactInput } from "@/lib/contacts/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { effectiveRules, identityKey, QUEUE_TYPES, type OwnerRole, type QueueRule, type QueueType, type Resolution } from "./exceptionQueues";
import { refreshPolicyCurrent } from "./policyCurrentStore";
import { scoreCandidate, splitName, type Candidate, type CarrierSide } from "./policyMatching";

/**
 * LA-4.9 (Notion sprint) · the exception queues, server side. Items are written only through the
 * SQL functions (open_queue_item, resolve_queue_item, reassign_queue_item), which always resolve an
 * owner; this file decides WHEN an item exists and what each resolution does.
 *
 *   · a policy the ladder could not match (LA-4.8) → its client: an existing one with the exact same
 *     first name, last name and date of birth (silently — the normal multi-policy case), or else a
 *     new PROVISIONAL contact built from the carrier's row; then a queue-1 item to the writing agent.
 *     If the provisional client looks like someone already on file, but not certainly, a queue-3 item.
 *   · queue 2 is raised by the daily sweep in SQL; it is resolved here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export class QueueError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "QueueError";
  }
}

export const QUEUES_PENDING_MESSAGE = "The exception queues need a database update (20261008180000).";

function fail(error: { message: string; code?: string }, fallback: string): never {
  if (isSchemaGap(error)) throw new QueueError(QUEUES_PENDING_MESSAGE, 503);
  if (error.code === "P0001" || error.code === "22023") throw new QueueError(error.message, 409);
  throw new Error(`${fallback}: ${error.message}`);
}

const str = (value: unknown) => (value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim());

async function link(tenantId: string, carrierId: string, policyNumber: string, match: Record<string, unknown>): Promise<string> {
  const { data, error } = await db().rpc("record_policy_match", { p_tenant_id: tenantId, p_carrier_id: carrierId, p_policy_number: policyNumber, p_match: match, p_review_id: null });
  if (error) fail(error, "The policy link could not be saved");
  return data as string;
}

async function openItem(tenantId: string, item: { queueType: QueueType; subjectKey: string; subjectType: string; subjectId?: string | null; carrierId?: string | null; policyNumber?: string | null; dealId?: string | null; contactId?: string | null; relatedContactId?: string | null; payload: Record<string, unknown>; writingAgent?: string | null; ageFrom?: string | null }): Promise<string> {
  const { data, error } = await db().rpc("open_queue_item", {
    p_tenant_id: tenantId, p_queue_type: item.queueType, p_subject_key: item.subjectKey, p_subject_type: item.subjectType, p_subject_id: item.subjectId ?? null,
    p_carrier_id: item.carrierId ?? null, p_policy_number: item.policyNumber ?? null, p_deal_id: item.dealId ?? null, p_contact_id: item.contactId ?? null,
    p_related_contact_id: item.relatedContactId ?? null, p_payload: item.payload, p_writing_agent: item.writingAgent ?? null, p_age_from: item.ageFrom ?? null,
  });
  if (error) fail(error, "The queue item could not be opened");
  return data as string;
}

type PolicySide = { carrierId: string; carrierName: string; policyNumber: string; fileDate: string; fields: Record<string, unknown>; premiumCents: number | null; faceCents: number | null; effectiveDate: string | null };

/** The carrier's own person, read from the snapshot's extra fields. */
function carrierPerson(side: PolicySide) {
  const split = splitName(str(side.fields.insured_name));
  return {
    firstName: str(side.fields.insured_first_name) ?? split.firstName,
    lastName: str(side.fields.insured_last_name) ?? split.lastName,
    dob: str(side.fields.insured_dob),
    phone: str(side.fields.insured_phone),
    address: str(side.fields.insured_address),
    state: str(side.fields.insured_state),
    zip: str(side.fields.insured_zip),
  };
}

/**
 * A policy nobody could match: give it a client (an exact-identity existing one, or a provisional
 * one), link it, and queue it for the writing agent. Returns the client and the queue-1 item.
 */
export async function noRecordPolicy(tenantId: string, side: PolicySide, writingAgent: string | null, options: { bulk?: boolean } = {}): Promise<{ contactId: string | null; provisional: boolean; itemId: string | null } | null> {
  // Before 20261008180000 there is no provisional flag: create nothing (the caller keeps a review).
  const probe = await db().from("queue_item").select("id").limit(1);
  if (probe.error) {
    if (isSchemaGap(probe.error)) return null;
    fail(probe.error, "Could not read the queues");
  }
  const person = carrierPerson(side);
  const identity = identityKey(person);
  const nameKey = normalizeText(`${person.firstName ?? ""} ${person.lastName ?? ""}`);
  const phoneKey = normalizePhone(person.phone);
  const ors = [nameKey.length >= 2 ? `name_search.eq.${nameKey}` : null, person.dob && /^\d{4}-\d\d-\d\d$/.test(person.dob) ? `dob.eq.${person.dob}` : null, phoneKey.length >= 7 ? `primary_phone.eq.${phoneKey}` : null].filter(Boolean);
  const { data: near } = ors.length
    ? await db().from("contacts").select("id, first_name, last_name, dob, primary_phone, provisional").eq("tenant_id", tenantId).is("merged_into_id", null).or(ors.join(",")).limit(50)
    : { data: [] };
  const existing = (near ?? []).filter((c: Loose) => identity !== null && identityKey({ firstName: c.first_name, lastName: c.last_name, dob: c.dob }) === identity);

  let contactId: string | null;
  let provisional = false;
  let blocked: string | null = null;
  if (existing.length === 1) {
    // The same human, certainly: a client with one more policy. No question to ask.
    contactId = existing[0].id;
    await link(tenantId, side.carrierId, side.policyNumber, { matched_to_type: "contact", matched_to_id: contactId, contact_id: contactId, method: "identity_exact", ladder_step: 3 });
  } else {
    const input = {
      first_name: person.firstName ?? "Unknown",
      last_name: person.lastName ?? side.policyNumber,
      dob: person.dob && /^\d{4}-\d\d-\d\d$/.test(person.dob) ? person.dob : null,
      primary_phone: phoneKey.length >= 7 && phoneKey.length <= 15 ? phoneKey : null,
      state: person.state && /^[A-Za-z]{2}$/.test(person.state) ? person.state.toUpperCase() : null,
      address_line1: person.address, city: null, postal_code: person.zip,
    } as unknown as ContactInput;
    const { data: created, error } = await db().rpc("save_contact", {
      p_tenant_id: tenantId, p_first_name: input.first_name, p_last_name: input.last_name, p_dob: input.dob ?? null, p_primary_phone: input.primary_phone ?? null,
      p_state: input.state ?? null, p_name_search: nameSearch(input).slice(0, 241).padEnd(2, "x"), p_custom_fields: {}, p_address_hash: addressHash(input),
      p_address_search: addressSearch(input) || null, p_address_line1: person.address, p_city: null, p_postal_code: person.zip,
      p_phones: input.primary_phone ? [{ phone: input.primary_phone, type: "other", is_primary: true }] : [], p_emails: [],
    });
    if (error && error.code === "23503") {
      // The agency's contact records can't take a new contact (no legacy organization row behind
      // it — an LA-0 bridge gap, not this policy's fault). The policy still gets its item, with no
      // client and the reason, so it is never silently lost.
      contactId = null;
      blocked = "A client couldn't be created for this agency yet (its contact records need a fix). Link an existing client or the sale.";
    } else if (error) {
      fail(error, "The provisional client could not be created");
    } else {
      contactId = created as string;
    }
  }
  if (contactId && existing.length !== 1) {
    provisional = true;
    const { error: flagError } = await db().from("contacts").update({
      provisional: true,
      provisional_source: { kind: "carrier_policy", carrier_id: side.carrierId, carrier_name: side.carrierName, policy_number: side.policyNumber, file_date: side.fileDate },
    }).eq("tenant_id", tenantId).eq("id", contactId);
    if (flagError) fail(flagError, "The provisional client could not be marked");
    await link(tenantId, side.carrierId, side.policyNumber, { matched_to_type: "provisional", matched_to_id: null, contact_id: contactId, method: "no_match", ladder_step: 3 });

    // Looks like someone on file, but not certainly → ask operations (queue 3). Spouses at one
    // address are two people in one household (save_contact joined them by address) and are only
    // asked about when their names and dates also look alike.
    const asCandidate = (c: Loose): Candidate => ({ type: "deal_flow", id: c.id, contactId: c.id, date: side.fileDate, firstName: c.first_name, lastName: c.last_name, dob: c.dob, phone: c.primary_phone, premiumCents: null, faceCents: null });
    const row: CarrierSide = { policyNumber: side.policyNumber, carrierName: side.carrierName, effectiveDate: side.effectiveDate, firstName: person.firstName, lastName: person.lastName, dob: person.dob, phone: person.phone, premiumCents: null, faceCents: null };
    const likely = (near ?? []).filter((c: Loose) => c.id !== contactId)
      .map((c: Loose) => ({ c, scored: scoreCandidate(row, asCandidate(c)) }))
      .filter(({ scored }: { scored: ReturnType<typeof scoreCandidate> }) => scored.fields.surname !== "mismatch" && scored.fields.surname !== "missing" && (scored.fields.dob === "match" || scored.fields.phone === "match" || scored.fields.givenName === "match"))
      .sort((a: Loose, b: Loose) => b.scored.score - a.scored.score)[0];
    // LA-4.10: an imported book asks nothing per client — the file gets one summary item instead.
    if (likely && !options.bulk) {
      const [a, b] = [contactId, likely.c.id].sort();
      await openItem(tenantId, {
        queueType: "multi_policy", subjectKey: `contacts:${a}:${b}`, subjectType: "contact", subjectId: contactId, contactId, relatedContactId: likely.c.id, carrierId: side.carrierId, policyNumber: side.policyNumber,
        payload: { score: likely.scored.score, fields: likely.scored.fields, carrier_name: side.carrierName, policy_number: side.policyNumber },
      });
    }
  }

  if (options.bulk) return { contactId, provisional, itemId: null };
  const itemId = await openItem(tenantId, {
    queueType: "no_deal_flow", subjectKey: `policy:${side.carrierId}:${side.policyNumber}`, subjectType: "policy", carrierId: side.carrierId, policyNumber: side.policyNumber, contactId,
    payload: { carrier_name: side.carrierName, file_date: side.fileDate, insured: { first_name: person.firstName, last_name: person.lastName, dob: person.dob }, premium_cents: side.premiumCents, face_cents: side.faceCents, provisional, client_blocked: blocked },
    writingAgent, ageFrom: side.fileDate,
  });
  await refreshPolicyCurrent({ tenantId, carrierId: side.carrierId, policies: [side.policyNumber] });
  return { contactId, provisional, itemId };
}

/**
 * LA-4.10: the one item an imported file gets — how many policies came in and how many clients were
 * created as provisional — instead of one item per client.
 */
export async function openImportSummary(tenantId: string, file: { id: string; carrierId: string; carrierName: string; fileDate: string }, counts: { policies: number; provisional: number; existing: number; linkedByNumber: number; blocked: number }): Promise<string> {
  return openItem(tenantId, {
    queueType: "initial_import", subjectKey: `import:${file.id}`, subjectType: "file", subjectId: file.id, carrierId: file.carrierId,
    payload: { carrier_name: file.carrierName, file_date: file.fileDate, ...counts },
    ageFrom: new Date().toISOString().slice(0, 10),
  });
}

export type QueueScope = { tenantId: string; userId: string; seesAll: boolean };

async function loadOpen(scope: QueueScope, itemId: string) {
  const { data, error } = await db().from("queue_item").select("*").eq("tenant_id", scope.tenantId).eq("id", itemId).maybeSingle();
  if (error) fail(error, "Could not load the item");
  if (!data) throw new QueueError("That item is not in this agency.", 404);
  if (data.status !== "open") throw new QueueError("That item has already been closed.", 409);
  if (!scope.seesAll && data.assigned_to_user_id !== scope.userId) throw new QueueError("That item belongs to someone else.", 403);
  return data as Loose;
}

async function close(scope: QueueScope, itemId: string, status: "resolved" | "dismissed", resolution: Resolution, note: string | null, ref: Record<string, unknown> | null) {
  const { data, error } = await db().rpc("resolve_queue_item", { p_tenant_id: scope.tenantId, p_item_id: itemId, p_user_id: scope.userId, p_status: status, p_resolution: resolution, p_note: note, p_ref: ref });
  if (error) fail(error, "The item could not be closed");
  if (!data) throw new QueueError("That item has already been closed.", 409);
}

async function contactOfDeal(tenantId: string, dealId: string): Promise<{ leadId: string; contactId: string | null } | null> {
  const { data: deal } = await db().from("deal_flow").select("id, lead_id").eq("tenant_id", tenantId).eq("id", dealId).maybeSingle();
  if (!deal) return null;
  const { data: lead } = await db().from("agent_leads").select("contact_id").eq("tenant_id", tenantId).eq("id", deal.lead_id).maybeSingle();
  return { leadId: deal.lead_id, contactId: lead?.contact_id ?? null };
}

/** A provisional client no policy points at any more is folded into the real one. */
async function retireProvisional(tenantId: string, provisionalId: string | null, intoId: string | null) {
  if (!provisionalId || !intoId || provisionalId === intoId) return;
  const { data: c } = await db().from("contacts").select("provisional").eq("tenant_id", tenantId).eq("id", provisionalId).maybeSingle();
  if (!c?.provisional) return;
  const { count } = await db().from("policy_match").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("contact_id", provisionalId).is("superseded_by_id", null);
  if (count) return;
  await db().from("contacts").update({ merged_into_id: intoId }).eq("tenant_id", tenantId).eq("id", provisionalId);
}

export type ResolveInput =
  | { resolution: "confirm_client" | "not_mine" | "same_person" | "different_people" | "reviewed" }
  | { resolution: "link_existing_client"; contactId: string }
  | { resolution: "found_the_sale"; dealId: string }
  | { resolution: "found_the_policy"; carrierId: string; policyNumber: string }
  | { resolution: "never_submitted"; reason: string }
  | { resolution: "resubmitted_elsewhere"; applicationId: string };

/** Every resolution, with who and what (the route audits it too). Returns what was done. */
export async function resolveItem(scope: QueueScope, itemId: string, input: ResolveInput): Promise<{ queueType: QueueType; resolution: Resolution; ref: Record<string, unknown> | null }> {
  const item = await loadOpen(scope, itemId);
  const human = { method: "human", ladder_step: 3, confirmed_by: scope.userId, created_by: scope.userId };
  const allowed: Record<QueueType, Resolution[]> = { no_deal_flow: ["confirm_client", "link_existing_client", "found_the_sale", "not_mine"], no_policy: ["found_the_policy", "never_submitted", "resubmitted_elsewhere", "not_mine"], multi_policy: ["same_person", "different_people"], initial_import: ["reviewed"] };
  if (!allowed[item.queue_type as QueueType]?.includes(input.resolution)) throw new QueueError("That is not how this kind of item is resolved.", 400);

  if (input.resolution === "not_mine") {
    const role: OwnerRole = item.assigned_role === "operations" ? "admin" : "operations";
    const { error } = await db().rpc("reassign_queue_item", { p_tenant_id: scope.tenantId, p_item_id: itemId, p_role: role });
    if (error) fail(error, "The item could not be handed on");
    return { queueType: item.queue_type, resolution: "not_mine", ref: { handed_to_role: role } };
  }

  let ref: Record<string, unknown> | null = null;
  let note: string | null = null;
  let status: "resolved" | "dismissed" = "resolved";

  if (item.queue_type === "no_deal_flow") {
    if (input.resolution === "confirm_client") {
      if (!item.contact_id) throw new QueueError("No client could be created for this policy. Link an existing client or the sale.", 400);
      await db().from("contacts").update({ provisional: false, provisional_confirmed_at: new Date().toISOString(), provisional_confirmed_by: scope.userId }).eq("tenant_id", scope.tenantId).eq("id", item.contact_id).eq("provisional", true);
      await link(scope.tenantId, item.carrier_id, item.policy_number, { ...human, matched_to_type: "contact", matched_to_id: item.contact_id, contact_id: item.contact_id });
      ref = { contact_id: item.contact_id };
    } else if (input.resolution === "link_existing_client") {
      const { data: c } = await db().from("contacts").select("id").eq("tenant_id", scope.tenantId).eq("id", input.contactId).is("merged_into_id", null).maybeSingle();
      if (!c) throw new QueueError("Choose a client in this agency.", 400);
      await link(scope.tenantId, item.carrier_id, item.policy_number, { ...human, matched_to_type: "contact", matched_to_id: input.contactId, contact_id: input.contactId });
      await retireProvisional(scope.tenantId, item.contact_id, input.contactId);
      ref = { contact_id: input.contactId };
    } else if (input.resolution === "found_the_sale") {
      const deal = await contactOfDeal(scope.tenantId, input.dealId);
      if (!deal) throw new QueueError("Choose a sale in this agency.", 400);
      await link(scope.tenantId, item.carrier_id, item.policy_number, { ...human, matched_to_type: "deal_flow", matched_to_id: input.dealId, contact_id: deal.contactId ?? item.contact_id });
      await retireProvisional(scope.tenantId, item.contact_id, deal.contactId);
      ref = { deal_id: input.dealId };
    }
    await refreshPolicyCurrent({ tenantId: scope.tenantId, carrierId: item.carrier_id, policies: [item.policy_number] });
  } else if (item.queue_type === "no_policy") {
    const deal = await contactOfDeal(scope.tenantId, item.deal_id);
    if (!deal) throw new QueueError("The sale behind this item is gone.", 409);
    if (input.resolution === "found_the_policy") {
      const number = input.policyNumber.trim();
      const { data: policy } = await db().from("policy_current").select("policy_number").eq("tenant_id", scope.tenantId).eq("carrier_id", input.carrierId).eq("policy_number", number).maybeSingle();
      if (!policy) throw new QueueError("No policy with that number has come in from that carrier.", 400);
      await link(scope.tenantId, input.carrierId, number, { ...human, matched_to_type: "deal_flow", matched_to_id: item.deal_id, contact_id: deal.contactId });
      await refreshPolicyCurrent({ tenantId: scope.tenantId, carrierId: input.carrierId, policies: [number] });
      ref = { carrier_id: input.carrierId, policy_number: number };
    } else if (input.resolution === "never_submitted") {
      note = input.reason.trim();
      if (!note) throw new QueueError("Say why it was never submitted.", 400);
      const { data: cases } = await db().from("tenant_application_cases").select("id").eq("tenant_id", scope.tenantId).eq("lead_id", deal.leadId).eq("status", "open");
      const closed: string[] = [];
      for (const c of cases ?? []) {
        const { data: ok, error } = await db().rpc("close_case_never_submitted", { p_tenant_id: scope.tenantId, p_case_id: c.id, p_user_id: scope.userId, p_reason: note });
        if (error) fail(error, "The application case could not be closed");
        if (ok) closed.push(c.id);
      }
      ref = { cases_abandoned: closed };
    } else if (input.resolution === "resubmitted_elsewhere") {
      const { data: app } = await db().from("tenant_applications").select("id, lead_id, carrier_id, attempt_no").eq("tenant_id", scope.tenantId).eq("id", input.applicationId).maybeSingle();
      if (!app || app.lead_id !== deal.leadId) throw new QueueError("Choose an application attempt for this client.", 400);
      ref = { application_id: app.id, carrier_id: app.carrier_id, attempt_no: app.attempt_no };
    }
  } else if (item.queue_type === "initial_import") {
    ref = { file_id: item.subject_id };
  } else {
    if (input.resolution === "same_person") {
      const { data: links } = await db().from("policy_match").select("carrier_id, policy_number").eq("tenant_id", scope.tenantId).eq("contact_id", item.contact_id).is("superseded_by_id", null);
      for (const l of links ?? []) {
        await link(scope.tenantId, l.carrier_id, l.policy_number, { ...human, matched_to_type: "contact", matched_to_id: item.related_contact_id, contact_id: item.related_contact_id });
        await refreshPolicyCurrent({ tenantId: scope.tenantId, carrierId: l.carrier_id, policies: [l.policy_number] });
      }
      await retireProvisional(scope.tenantId, item.contact_id, item.related_contact_id);
      ref = { kept_contact_id: item.related_contact_id, policies_moved: (links ?? []).length };
    } else {
      status = "dismissed";
      ref = { contact_ids: [item.contact_id, item.related_contact_id] };
    }
  }
  await close(scope, itemId, status, input.resolution, note, ref);
  return { queueType: item.queue_type, resolution: input.resolution, ref };
}

/** The owner sets who owns a queue and when it escalates. */
export async function saveRule(scope: QueueScope, rule: QueueRule): Promise<void> {
  const { error } = await db().from("queue_assignment_rule").upsert({
    tenant_id: scope.tenantId, queue_type: rule.queueType, owner_role: rule.ownerRole, open_after_days: rule.openAfterDays, escalate_after_days: rule.escalateAfterDays,
    escalate_to_role: rule.escalateToRole, updated_by: scope.userId, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,queue_type" });
  if (error) fail(error, "The rule could not be saved");
}

export type QueueItemRow = {
  id: string; queueType: QueueType; status: string; ageFrom: string; createdAt: string; escalated: boolean;
  assigneeId: string; assigneeName: string; assignedRole: OwnerRole; carrierId: string | null; carrierName: string | null; policyNumber: string | null;
  contact: { id: string; name: string; provisional: boolean } | null; related: { id: string; name: string; provisional: boolean } | null;
  deal: { id: string; insuredName: string | null; date: string; premiumCents: number | null; carrier: string | null; leadId: string } | null;
  payload: Loose; resolution: string | null; resolutionNote: string | null; resolvedAt: string | null; resolvedByName: string | null;
  choices: { contacts?: Array<{ id: string; name: string; dob: string | null }>; deals?: Array<{ id: string; name: string; date: string }>; policies?: Array<{ carrierId: string; policyNumber: string; label: string }>; applications?: Array<{ id: string; label: string }> };
};

export async function loadQueues(scope: QueueScope) {
  let open = db().from("queue_item").select("*").eq("tenant_id", scope.tenantId).eq("status", "open").in("queue_type", [...QUEUE_TYPES]).order("age_from").limit(500);
  let closed = db().from("queue_item").select("*").eq("tenant_id", scope.tenantId).neq("status", "open").gte("resolved_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).order("resolved_at", { ascending: false }).limit(100);
  if (!scope.seesAll) {
    open = open.eq("assigned_to_user_id", scope.userId);
    closed = closed.eq("assigned_to_user_id", scope.userId);
  }
  const [openRes, closedRes, rules, members, carriers] = await Promise.all([open, closed, db().from("queue_assignment_rule").select("*").eq("tenant_id", scope.tenantId), db().from("tenant_users").select("user_id, role").eq("tenant_id", scope.tenantId), db().from("carriers").select("id, name")]);
  for (const read of [openRes, closedRes, rules]) {
    if (read.error) {
      if (isSchemaGap(read.error)) return { available: false as const };
      throw new Error(`Could not load the queues: ${read.error.message}`);
    }
  }
  const items = [...(openRes.data ?? []), ...(closedRes.data ?? [])] as Loose[];
  const carrierName = new Map<string, string>((carriers.data ?? []).map((c: Loose) => [c.id, c.name]));
  const userIds = [...new Set([...items.map((i) => i.assigned_to_user_id), ...items.map((i) => i.resolved_by).filter(Boolean), ...(members.data ?? []).map((m: Loose) => m.user_id)])];
  const contactIds = [...new Set(items.flatMap((i) => [i.contact_id, i.related_contact_id]).filter(Boolean))];
  const dealIds = [...new Set(items.map((i) => i.deal_id).filter(Boolean))];
  const [users, contacts, deals] = await Promise.all([
    userIds.length ? db().from("users").select("id, name, email").in("id", userIds) : { data: [] },
    contactIds.length ? db().from("contacts").select("id, first_name, last_name, provisional").eq("tenant_id", scope.tenantId).in("id", contactIds) : { data: [] },
    dealIds.length ? db().from("deal_flow").select("id, lead_id, insured_name, local_date, monthly_premium_cents, carrier").eq("tenant_id", scope.tenantId).in("id", dealIds) : { data: [] },
  ]);
  const userName = new Map<string, string>((users.data ?? []).map((u: Loose) => [u.id, u.name || u.email || u.id]));
  const contact = new Map<string, Loose>((contacts.data ?? []).map((c: Loose) => [c.id, { id: c.id, name: `${c.first_name} ${c.last_name}`, provisional: Boolean(c.provisional) }]));
  const deal = new Map<string, Loose>((deals.data ?? []).map((d: Loose) => [d.id, { id: d.id, insuredName: d.insured_name, date: d.local_date, premiumCents: d.monthly_premium_cents, carrier: d.carrier, leadId: d.lead_id }]));

  // The choices each open item's actions need, kept small.
  const openItems = (openRes.data ?? []) as Loose[];
  const choices = new Map<string, QueueItemRow["choices"]>();
  for (const item of openItems) {
    if (item.queue_type === "no_deal_flow") {
      const lastName = item.payload?.insured?.last_name ?? "";
      const [{ data: cs }, { data: ds }] = await Promise.all([
        lastName ? db().from("contacts").select("id, first_name, last_name, dob").eq("tenant_id", scope.tenantId).is("merged_into_id", null).eq("provisional", false).ilike("last_name", String(lastName).replace(/[%_]/g, "")).limit(10) : { data: [] },
        db().from("deal_flow").select("id, insured_name, local_date").eq("tenant_id", scope.tenantId).eq("call_result", "application_submitted").gte("local_date", new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)).order("local_date", { ascending: false }).limit(25),
      ]);
      choices.set(item.id, { contacts: (cs ?? []).map((c: Loose) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`, dob: c.dob })), deals: (ds ?? []).map((d: Loose) => ({ id: d.id, name: d.insured_name ?? "—", date: d.local_date })) });
    } else if (item.queue_type === "no_policy") {
      const d = deal.get(item.deal_id);
      const [{ data: ps }, { data: apps }] = await Promise.all([
        db().from("policy_current").select("carrier_id, policy_number, status_normalized").eq("tenant_id", scope.tenantId).eq("carrier_id", item.carrier_id).limit(200),
        d ? db().from("tenant_applications").select("id, carrier_id, attempt_no, status").eq("tenant_id", scope.tenantId).eq("lead_id", d.leadId).order("attempt_no") : { data: [] },
      ]);
      choices.set(item.id, {
        policies: (ps ?? []).map((p: Loose) => ({ carrierId: p.carrier_id, policyNumber: p.policy_number, label: `${p.policy_number} · ${p.status_normalized ?? "—"}` })),
        applications: (apps ?? []).map((a: Loose) => ({ id: a.id, label: `Attempt ${a.attempt_no} · ${carrierName.get(a.carrier_id) ?? "no carrier"} · ${a.status}` })),
      });
    }
  }

  const row = (i: Loose): QueueItemRow => ({
    id: i.id, queueType: i.queue_type, status: i.status, ageFrom: i.age_from, createdAt: i.created_at, escalated: Boolean(i.escalated_at),
    assigneeId: i.assigned_to_user_id, assigneeName: userName.get(i.assigned_to_user_id) ?? "—", assignedRole: i.assigned_role,
    carrierId: i.carrier_id, carrierName: i.carrier_id ? carrierName.get(i.carrier_id) ?? null : null, policyNumber: i.policy_number,
    contact: i.contact_id ? contact.get(i.contact_id) ?? null : null, related: i.related_contact_id ? contact.get(i.related_contact_id) ?? null : null,
    deal: i.deal_id ? deal.get(i.deal_id) ?? null : null, payload: i.payload ?? {}, resolution: i.resolution, resolutionNote: i.resolution_note,
    resolvedAt: i.resolved_at, resolvedByName: i.resolved_by ? userName.get(i.resolved_by) ?? null : i.status === "open" ? null : "Automatic", choices: choices.get(i.id) ?? {},
  });
  return {
    available: true as const,
    open: openItems.map(row),
    closed: ((closedRes.data ?? []) as Loose[]).map(row),
    rules: effectiveRules(((rules.data ?? []) as Loose[]).filter((r) => (QUEUE_TYPES as readonly string[]).includes(r.queue_type)).map((r) => ({ queueType: r.queue_type, ownerRole: r.owner_role, openAfterDays: r.open_after_days, escalateAfterDays: r.escalate_after_days, escalateToRole: r.escalate_to_role }))),
    carriers: (carriers.data ?? []).map((c: Loose) => ({ id: c.id as string, name: c.name as string })),
  };
}
