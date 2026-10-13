import "server-only";

import { addressHash, addressSearch, nameSearch, normalizePhone } from "@/lib/contacts/normalization";
import type { ContactInput } from "@/lib/contacts/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { annualisedPremiumCents } from "./policyCurrent";
import { accuracy, isStrong, ladderShare, shortlist, SHORTLIST_LOOKBACK_DAYS, splitName, WRITING_ROLES, type Candidate, type CarrierSide, type LadderCounts, type Scored } from "./policyMatching";
import { recordCarrierIssues } from "./applicationIssueStore";
import { refreshPolicyCurrent } from "./policyCurrentStore";
import { noRecordPolicy, openImportSummary } from "./exceptionQueuesStore";
import { identityKey } from "./exceptionQueues";
import { allRows } from "./pages";

/**
 * LA-4.8 (Notion sprint) · the matching ladder, server side.
 *
 *   1. a policy that already has a current link — nothing to do;
 *   2. its number on an LA-3.15 submission → `submission_record`; on our own LA-2.17 issued policy →
 *      `policy_number_exact`. Linked with certainty, no AI;
 *   3. otherwise a scored shortlist (deal flow and applications, same carrier, the agent's own when
 *      the carrier's agent string is mapped, up to 14 days before the file) goes to the review queue.
 *      The AI reviewer is not configured; a person decides, and that link is `human`.
 *
 * Every link goes through record_policy_match, which supersedes rather than overwrites. Agent strings
 * resolve only through carrier_agent_map, exactly — never by a similar name.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export class MatchingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MatchingError";
  }
}

export const MATCHING_PENDING_MESSAGE = "Policy matching needs a database update (20261008170000).";
export const AI_REVIEW_PENDING = "AI review isn't configured yet, so a person decides each of these.";

function fail(error: { message: string; code?: string }, fallback: string): never {
  if (isSchemaGap(error)) throw new MatchingError(MATCHING_PENDING_MESSAGE, 503);
  if (error.code === "P0001" || error.code === "22023") throw new MatchingError(error.message, 409);
  throw new Error(`${fallback}: ${error.message}`);
}

const day = (iso: string) => iso.slice(0, 10);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${day(iso)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const sameCarrier = (text: string | null, carrier: { name: string; code: string | null }) => {
  const value = (text ?? "").trim().toLowerCase();
  return value !== "" && (value === carrier.name.trim().toLowerCase() || value === (carrier.code ?? "").trim().toLowerCase());
};
const str = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

type Snapshot = { policy_number: string; snapshot_date: string; file_id: string; premium_cents: number | null; premium_mode: string | null; face_amount_cents: number | null; effective_date: string | null; agent_identifier: string | null; extra: Loose };

async function latestSnapshots(tenantId: string, carrierId: string, policies: string[]): Promise<Map<string, Snapshot>> {
  const out = new Map<string, Snapshot>();
  const { data, error } = await db().from("policy_snapshot")
    .select("policy_number, snapshot_date, file_id, premium_cents, premium_mode, face_amount_cents, effective_date, agent_identifier, extra")
    .eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("superseded", false).in("policy_number", policies)
    .order("snapshot_date", { ascending: false });
  if (error) throw new Error(`Could not read the policies' snapshots: ${error.message}`);
  for (const row of (data ?? []) as Snapshot[]) if (!out.has(row.policy_number)) out.set(row.policy_number, row);
  return out;
}

/** The carrier side of a comparison, from the policy's latest snapshot. */
function carrierSide(snapshot: Snapshot, carrierName: string): CarrierSide {
  const fields = (snapshot.extra?.fields ?? {}) as Record<string, unknown>;
  const split = splitName(str(fields.insured_name));
  const annual = annualisedPremiumCents(snapshot.premium_cents, snapshot.premium_mode);
  return {
    policyNumber: snapshot.policy_number,
    carrierName,
    effectiveDate: snapshot.effective_date,
    firstName: str(fields.insured_first_name) ?? split.firstName,
    lastName: str(fields.insured_last_name) ?? split.lastName,
    dob: str(fields.insured_dob),
    phone: str(fields.insured_phone),
    premiumCents: annual === null ? null : Math.round(annual / 12),
    faceCents: snapshot.face_amount_cents,
  };
}

async function record(tenantId: string, carrierId: string, policyNumber: string, match: Record<string, unknown>, reviewId: string | null = null): Promise<string> {
  const { data, error } = await db().rpc("record_policy_match", { p_tenant_id: tenantId, p_carrier_id: carrierId, p_policy_number: policyNumber, p_match: match, p_review_id: reviewId });
  if (error) fail(error, "The policy link could not be saved");
  return data as string;
}

async function contactsOfLeads(leadIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!leadIds.length) return out;
  const { data } = await db().from("agent_leads").select("id, contact_id").in("id", [...new Set(leadIds)]);
  for (const row of data ?? []) out.set(row.id, row.contact_id ?? null);
  return out;
}

const leadText = (values: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) if (typeof values[key] === "string" && (values[key] as string).trim()) return (values[key] as string).trim().slice(0, 240);
  return null;
};

/**
 * The client behind a sale whose lead has none. A partner's lead creates no contact (intake only
 * links a confident existing one), so a policy linked to its application would otherwise point at
 * nobody. Once a carrier policy proves the sale, the lead's person becomes a client: the one
 * existing client with the same name and date of birth, or a new one — not provisional, because a
 * sale stands behind it. The lead is linked to it too. Null when the lead has no name, or when the
 * agency's contact records can't take a new contact (the LA-0 bridge gap noRecordPolicy also meets).
 */
async function clientForLead(tenantId: string, leadId: string): Promise<string | null> {
  const { data: lead } = await db().from("agent_leads").select("id, contact_id, values").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  if (!lead) return null;
  if (lead.contact_id) return lead.contact_id as string;
  const values = (lead.values && typeof lead.values === "object" ? lead.values : {}) as Record<string, unknown>;
  let first = leadText(values, ["first_name"]);
  let last = leadText(values, ["last_name"]);
  if (!first || !last) {
    const full = splitName(leadText(values, ["full_name", "name"]));
    first = first ?? full.firstName;
    last = last ?? full.lastName;
  }
  if (!first || !last) return null;
  const dobText = leadText(values, ["date_of_birth", "dob"]);
  const dob = dobText && /^\d{4}-\d\d-\d\d$/.test(dobText) ? dobText : null;
  const identity = identityKey({ firstName: first, lastName: last, dob });
  let contactId: string | null = null;
  if (identity) {
    const { data: near } = await db().from("contacts").select("id, first_name, last_name, dob").eq("tenant_id", tenantId).is("merged_into_id", null).eq("dob", dob).limit(50);
    const same = (near ?? []).filter((c: Loose) => identityKey({ firstName: c.first_name, lastName: c.last_name, dob: c.dob }) === identity);
    if (same.length === 1) contactId = same[0].id;
  }
  if (!contactId) {
    const phone = normalizePhone(leadText(values, ["phone", "phone_number", "primary_phone"]));
    const stateText = leadText(values, ["state", "state_code"]);
    const input = {
      first_name: first, last_name: last, dob, primary_phone: phone.length >= 7 && phone.length <= 15 ? phone : null,
      state: stateText && /^[A-Za-z]{2}$/.test(stateText) ? stateText.toUpperCase() : null,
      address_line1: leadText(values, ["address_line1", "address", "street_address"]), city: leadText(values, ["city"]), postal_code: leadText(values, ["postal_code", "zip", "zip_code"]),
    } as unknown as ContactInput;
    const { data: created, error } = await db().rpc("save_contact", {
      p_tenant_id: tenantId, p_first_name: first, p_last_name: last, p_dob: dob, p_primary_phone: input.primary_phone ?? null,
      p_state: input.state ?? null, p_name_search: nameSearch(input).slice(0, 241).padEnd(2, "x"), p_custom_fields: {}, p_address_hash: addressHash(input),
      p_address_search: addressSearch(input) || null, p_address_line1: input.address_line1 ?? null, p_city: input.city ?? null, p_postal_code: input.postal_code ?? null,
      p_phones: input.primary_phone ? [{ phone: input.primary_phone, type: "other", is_primary: true }] : [], p_emails: [],
    });
    if (error?.code === "23503") return null;
    if (error) fail(error, "The sale's client could not be created");
    contactId = created as string;
  }
  // Only a lead still without a client: never overwrite a link someone else made meanwhile.
  await db().from("agent_leads").update({ contact_id: contactId }).eq("tenant_id", tenantId).eq("id", leadId).is("contact_id", null);
  return contactId;
}

/**
 * Links made before clientForLead existed (or while the lead had no name) point at a sale but at
 * no client. Each one gets the sale's client now, as a new link that supersedes the old.
 */
async function fillSaleClients(tenantId: string, carrierId: string, policies: string[]) {
  if (!policies.length) return;
  const { data: links } = await db().from("policy_match").select("policy_number, matched_to_type, matched_to_id, household_id, method, ladder_step, confidence, reasoning, confirmed_by, confirmed_at")
    .eq("tenant_id", tenantId).eq("carrier_id", carrierId).is("superseded_by_id", null).is("contact_id", null).eq("matched_to_type", "application").in("policy_number", policies);
  if (!links?.length) return;
  const { data: apps } = await db().from("tenant_applications").select("id, lead_id").eq("tenant_id", tenantId).in("id", [...new Set(links.map((link: Loose) => link.matched_to_id))]);
  const leadOf = new Map<string, string>((apps ?? []).filter((app: Loose) => app.lead_id).map((app: Loose) => [app.id, app.lead_id]));
  for (const link of links) {
    const leadId = leadOf.get(link.matched_to_id);
    const contactId = leadId ? await clientForLead(tenantId, leadId) : null;
    if (!contactId) continue;
    const { policy_number: policyNumber, ...rest } = link;
    await record(tenantId, carrierId, policyNumber, { ...rest, contact_id: contactId });
  }
}

/** Step 2: the policies whose number we already hold. Returns those it linked. */
async function linkExact(tenantId: string, carrier: { id: string; name: string; code: string | null }, policies: string[]): Promise<Set<string>> {
  const linked = new Set<string>();
  const [byNumber, byReference] = await Promise.all([
    db().from("tenant_application_submissions").select("application_id, policy_number, carrier_reference, submitted_at").eq("tenant_id", tenantId).eq("carrier_id", carrier.id).in("policy_number", policies),
    db().from("tenant_application_submissions").select("application_id, policy_number, carrier_reference, submitted_at").eq("tenant_id", tenantId).eq("carrier_id", carrier.id).eq("reference_kind", "policy_no").in("carrier_reference", policies),
  ]);
  const submissions = [...(byNumber.data ?? []), ...(byReference.data ?? [])].sort((a: Loose, b: Loose) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
  const appIds = [...new Set(submissions.map((row: Loose) => row.application_id))];
  const { data: apps } = appIds.length ? await db().from("tenant_applications").select("id, lead_id").eq("tenant_id", tenantId).in("id", appIds) : { data: [] };
  const leadOf = new Map<string, string>((apps ?? []).map((app: Loose) => [app.id, app.lead_id]));
  const contactOf = await contactsOfLeads([...leadOf.values()]);
  for (const policy of policies) {
    const hit = submissions.find((row: Loose) => row.policy_number === policy || row.carrier_reference === policy);
    if (!hit || !leadOf.has(hit.application_id)) continue;
    const leadId = leadOf.get(hit.application_id)!;
    const contactId = contactOf.get(leadId) ?? (await clientForLead(tenantId, leadId));
    await record(tenantId, carrier.id, policy, { matched_to_type: "application", matched_to_id: hit.application_id, contact_id: contactId, method: "submission_record", ladder_step: 2 });
    linked.add(policy);
  }

  const rest = policies.filter((policy) => !linked.has(policy));
  if (!rest.length) return linked;
  const { data: issued } = await db().from("tenant_issued_policies").select("id, lead_id, deal_id, carrier, policy_number").eq("tenant_id", tenantId).in("policy_number", rest);
  const ours = (issued ?? []).filter((row: Loose) => sameCarrier(row.carrier, carrier));
  const issuedContacts = await contactsOfLeads(ours.map((row: Loose) => row.lead_id).filter(Boolean));
  for (const policy of rest) {
    const hit = ours.find((row: Loose) => row.policy_number === policy);
    if (!hit) continue;
    const contactId = hit.lead_id ? issuedContacts.get(hit.lead_id) ?? (await clientForLead(tenantId, hit.lead_id)) : null;
    const target = hit.deal_id ? { matched_to_type: "deal_flow", matched_to_id: hit.deal_id } : contactId ? { matched_to_type: "contact", matched_to_id: contactId } : null;
    if (!target) continue;
    await record(tenantId, carrier.id, policy, { ...target, contact_id: contactId, method: "policy_number_exact", ladder_step: 2 });
    linked.add(policy);
  }
  return linked;
}

/** Deal-flow entries and applications for one carrier between two dates, as comparable people. */
async function candidatesFor(tenantId: string, carrier: { id: string; name: string; code: string | null }, from: string, to: string): Promise<Array<Candidate & { agentUserId: string | null }>> {
  const [deals, apps] = await Promise.all([
    db().from("deal_flow").select("id, lead_id, insured_name, phone, monthly_premium_cents, face_amount_cents, carrier, worked_by, local_date").eq("tenant_id", tenantId).gte("local_date", from).lte("local_date", to).limit(2000),
    db().from("tenant_applications").select("id, lead_id, created_by, created_at, submitted_at, quote_id").eq("tenant_id", tenantId).eq("carrier_id", carrier.id).gte("created_at", `${addDays(from, -60)}T00:00:00Z`).limit(2000),
  ]);
  if (deals.error) throw new Error(`Could not read deal flow: ${deals.error.message}`);
  if (apps.error) throw new Error(`Could not read applications: ${apps.error.message}`);
  const dealRows = (deals.data ?? []).filter((row: Loose) => sameCarrier(row.carrier, carrier));
  const appRows = (apps.data ?? []).filter((row: Loose) => { const date = day(row.submitted_at ?? row.created_at); return date >= from && date <= to; });
  const contactOf = await contactsOfLeads([...dealRows, ...appRows].map((row: Loose) => row.lead_id));
  const contactIds = [...new Set([...contactOf.values()].filter(Boolean))] as string[];
  const quoteIds = appRows.map((row: Loose) => row.quote_id).filter(Boolean);
  const [contacts, quotes] = await Promise.all([
    contactIds.length ? db().from("contacts").select("id, first_name, last_name, dob, primary_phone").eq("tenant_id", tenantId).in("id", contactIds) : { data: [] },
    quoteIds.length ? db().from("tenant_quotes").select("id, monthly_premium_cents, face_amount_cents").eq("tenant_id", tenantId).in("id", quoteIds) : { data: [] },
  ]);
  const contact = new Map<string, Loose>((contacts.data ?? []).map((row: Loose) => [row.id, row]));
  const quote = new Map<string, Loose>((quotes.data ?? []).map((row: Loose) => [row.id, row]));
  const out: Array<Candidate & { agentUserId: string | null }> = [];
  for (const row of dealRows) {
    const contactId = contactOf.get(row.lead_id) ?? null;
    const c = contactId ? contact.get(contactId) : null;
    const split = splitName(row.insured_name);
    out.push({ type: "deal_flow", id: row.id, contactId, date: row.local_date, firstName: c?.first_name ?? split.firstName, lastName: c?.last_name ?? split.lastName, dob: c?.dob ?? null, phone: row.phone ?? c?.primary_phone ?? null, premiumCents: row.monthly_premium_cents ?? null, faceCents: row.face_amount_cents ?? null, agentUserId: row.worked_by ?? null });
  }
  for (const row of appRows) {
    const contactId = contactOf.get(row.lead_id) ?? null;
    const c = contactId ? contact.get(contactId) : null;
    const q = row.quote_id ? quote.get(row.quote_id) : null;
    out.push({ type: "application", id: row.id, contactId, date: day(row.submitted_at ?? row.created_at), firstName: c?.first_name ?? null, lastName: c?.last_name ?? null, dob: c?.dob ?? null, phone: c?.primary_phone ?? null, premiumCents: q?.monthly_premium_cents ?? null, faceCents: q?.face_amount_cents ?? null, agentUserId: row.created_by ?? null });
  }
  return out;
}

const storedEntry = (scored: Scored) => ({ ...scored.candidate, score: scored.score, fields: scored.fields, likely: isStrong(scored) });

/** How many policies of a file are matched side by side. */
const MATCH_WIDTH = 8;

/**
 * The policies of one person stay in one group, in order, so the second finds the client the first
 * created (an exact identity, or a name to suggest) instead of racing it to make another. Groups
 * run side by side, `MATCH_WIDTH` at a time; the first failure fails the whole, as one at a time did.
 */
async function byPerson(snapshots: Map<string, Snapshot>, policies: string[], carrierName: string, work: (policy: string, snapshot: Snapshot) => Promise<void>) {
  const groups = new Map<string, string[]>();
  for (const policy of policies) {
    const snapshot = snapshots.get(policy);
    if (!snapshot) continue;
    const side = carrierSide(snapshot, carrierName);
    const name = `${side.firstName ?? ""} ${side.lastName ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");
    const key = identityKey(side) ?? (name ? `name:${name}` : `policy:${policy}`);
    groups.set(key, [...(groups.get(key) ?? []), policy]);
  }
  const queue = [...groups.values()];
  await Promise.all(Array.from({ length: Math.min(MATCH_WIDTH, queue.length) }, async () => {
    for (let group = queue.shift(); group; group = queue.shift()) for (const policy of group) await work(policy, snapshots.get(policy)!);
  }));
}

/** Step 3: a scored shortlist per policy, into the review queue (one open review per policy). */
async function queueReviews(tenantId: string, carrier: { id: string; name: string; code: string | null }, policies: string[], fileId: string | null, options: { reviewEvenIfEmpty?: boolean; refreshCurrent?: boolean } = {}): Promise<number> {
  if (!policies.length) return 0;
  const snapshots = await latestSnapshots(tenantId, carrier.id, policies);
  const dates = [...snapshots.values()].map((s) => s.snapshot_date).sort();
  if (!dates.length) return 0;
  const pool = await candidatesFor(tenantId, carrier, addDays(dates[0], -SHORTLIST_LOOKBACK_DAYS), dates[dates.length - 1]);
  const identifiers = [...new Set([...snapshots.values()].map((s) => s.agent_identifier).filter(Boolean))] as string[];
  const { data: maps } = identifiers.length ? await db().from("carrier_agent_map").select("agent_identifier, user_id").eq("tenant_id", tenantId).eq("carrier_id", carrier.id).in("agent_identifier", identifiers) : { data: [] };
  const agentOf = new Map<string, string>((maps ?? []).map((row: Loose) => [row.agent_identifier, row.user_id]));
  const { data: open } = await db().from("policy_match_review").select("id, policy_number").eq("tenant_id", tenantId).eq("carrier_id", carrier.id).eq("status", "open").in("policy_number", policies);
  const openId = new Map<string, string>((open ?? []).map((row: Loose) => [row.policy_number, row.id]));

  let queued = 0;
  await byPerson(snapshots, policies, carrier.name, async (policy, snapshot) => {
    const row = carrierSide(snapshot, carrier.name);
    const agent = snapshot.agent_identifier ? agentOf.get(snapshot.agent_identifier) ?? null : null;
    const from = addDays(snapshot.snapshot_date, -SHORTLIST_LOOKBACK_DAYS);
    const candidates = pool.filter((c) => c.date >= from && c.date <= snapshot.snapshot_date && (!agent || c.agentUserId === agent));
    const listed = shortlist(row, candidates);
    // LA-4.9: nobody to choose from is not a review — it is a policy with no sale on record.
    if (!listed.length && !options.reviewEvenIfEmpty && (await noRecordPolicy(tenantId, policySide(snapshot, carrier), agent, { refreshCurrent: options.refreshCurrent }))) {
      if (openId.has(policy)) await db().from("policy_match_review").update({ updated_at: new Date().toISOString() }).eq("id", openId.get(policy));
      queued++;
      return;
    }
    const payload = {
      carrier_row: { ...row, agentIdentifier: snapshot.agent_identifier, fileDate: snapshot.snapshot_date },
      shortlist: listed.map(storedEntry),
      file_id: fileId ?? snapshot.file_id,
      updated_at: new Date().toISOString(),
    };
    const existing = openId.get(policy);
    const write = existing
      ? await db().from("policy_match_review").update(payload).eq("id", existing)
      : await db().from("policy_match_review").insert({ tenant_id: tenantId, carrier_id: carrier.id, policy_number: policy, ...payload });
    if (write.error && write.error.code !== "23505") fail(write.error, "The policy could not be queued for review");
    queued++;
  });
  return queued;
}

/** What LA-4.9 needs of a policy to build its provisional client. */
function policySide(snapshot: Snapshot, carrier: { id: string; name: string }) {
  const annual = annualisedPremiumCents(snapshot.premium_cents, snapshot.premium_mode);
  return { carrierId: carrier.id, carrierName: carrier.name, policyNumber: snapshot.policy_number, fileDate: snapshot.snapshot_date, fields: (snapshot.extra?.fields ?? {}) as Record<string, unknown>, premiumCents: annual === null ? null : Math.round(annual / 12), faceCents: snapshot.face_amount_cents, effectiveDate: snapshot.effective_date };
}

/**
 * LA-4.10: a book imported during onboarding predates us — none of its policies has a sale or a
 * submission here. Each one not linked by number gets its client (an exact-identity existing one, or
 * a provisional one) without a review or a queue item, and the file gets ONE summary item. Returns
 * how many it handled, or null when the file is not an initial import (the normal ladder runs).
 */
async function importedBook(tenantId: string, carrier: { id: string; name: string; code: string | null }, fileId: string | null, policies: string[]): Promise<number | null> {
  if (!fileId) return null;
  const { data: file } = await db().from("file_registry").select("id, is_initial_import, file_date").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (!file?.is_initial_import) return null;
  const snapshots = await latestSnapshots(tenantId, carrier.id, policies);
  const identifiers = [...new Set([...snapshots.values()].map((s) => s.agent_identifier).filter(Boolean))] as string[];
  const { data: maps } = identifiers.length ? await db().from("carrier_agent_map").select("agent_identifier, user_id").eq("tenant_id", tenantId).eq("carrier_id", carrier.id).in("agent_identifier", identifiers) : { data: [] };
  const agentOf = new Map<string, string>((maps ?? []).map((row: Loose) => [row.agent_identifier, row.user_id]));
  let handled = 0;
  let pending = false;
  await byPerson(snapshots, policies, carrier.name, async (_policy, snapshot) => {
    if (pending) return;
    const done = await noRecordPolicy(tenantId, policySide(snapshot, carrier), snapshot.agent_identifier ? agentOf.get(snapshot.agent_identifier) ?? null : null, { bulk: true });
    if (!done) pending = true; // before 20261008180000: the normal ladder
    else handled++;
  });
  if (pending) return null;
  // One summary per file, counted from what is now true of the file's policies — so a file that
  // arrives in chunks, or is reprocessed, gives the same summary, never a doubled one.
  const { data: rows } = await db().from("policy_snapshot").select("policy_number").eq("tenant_id", tenantId).eq("file_id", fileId).eq("superseded", false);
  const numbers: string[] = [...new Set<string>((rows ?? []).map((row: Loose) => String(row.policy_number)))];
  const method = new Map<string, string>();
  for (let start = 0; start < numbers.length; start += 500) {
    const { data: links } = await db().from("policy_match").select("policy_number, method").eq("tenant_id", tenantId).eq("carrier_id", carrier.id).is("superseded_by_id", null).in("policy_number", numbers.slice(start, start + 500));
    for (const link of links ?? []) method.set(link.policy_number, link.method);
  }
  const summary = { policies: numbers.length, provisional: 0, existing: 0, linkedByNumber: 0, blocked: 0 };
  for (const number of numbers) {
    const how = method.get(number);
    if (how === "no_match") summary.provisional++;
    else if (how === "identity_exact" || how === "human" || how === "ai_review" || how === "import") summary.existing++;
    else if (how === "submission_record" || how === "policy_number_exact") summary.linkedByNumber++;
    else summary.blocked++;
  }
  await openImportSummary(tenantId, { id: fileId, carrierId: carrier.id, carrierName: carrier.name, fileDate: file.file_date }, summary);  return handled;
}

async function carrierOf(carrierId: string) {
  const { data, error } = await db().from("carriers").select("id, name, code").eq("id", carrierId).maybeSingle();
  if (error || !data) throw new Error(`Could not load the carrier: ${error?.message ?? "not found"}`);
  return data as { id: string; name: string; code: string | null };
}

/**
 * The ladder for the policies one file touched (the snapshot stage calls this before refreshing
 * policy_current for the same policies — so nothing here refreshes them one by one). Returns the
 * counts per step, or null before the migration.
 */
export async function matchFilePolicies(tenantId: string, carrierId: string, fileId: string | null, policies: string[]): Promise<LadderCounts | null> {
  if (!policies.length) return { alreadyLinked: 0, exactLinked: 0, toReview: 0 };
  const { data: current, error } = await db().from("policy_match").select("policy_number").eq("tenant_id", tenantId).eq("carrier_id", carrierId).is("superseded_by_id", null).in("policy_number", policies);
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(`Could not read the policies' links: ${error.message}`);
  }
  const linked = new Set<string>((current ?? []).map((row: Loose) => row.policy_number as string));
  await fillSaleClients(tenantId, carrierId, [...linked]);
  const carrier = await carrierOf(carrierId);
  const unlinked = policies.filter((policy) => !linked.has(policy));
  const exact = await linkExact(tenantId, carrier, unlinked);
  const rest = unlinked.filter((policy) => !exact.has(policy));
  const toReview = (await importedBook(tenantId, carrier, fileId, rest)) ?? (await queueReviews(tenantId, carrier, rest, fileId, { refreshCurrent: false }));
  const counts = { alreadyLinked: linked.size, exactLinked: exact.size, toReview };
  await db().from("policy_match_ladder").insert({ tenant_id: tenantId, carrier_id: carrierId, file_id: fileId, already_linked: counts.alreadyLinked, exact_linked: counts.exactLinked, to_review: counts.toReview });
  return counts;
}

export type MatchingScope = { tenantId: string; userId: string };

/** A person decides a review: one of its shortlisted candidates, or "none of these" (provisional). */
export async function resolveReview(scope: MatchingScope, reviewId: string, choice: { ref: number } | { none: true }): Promise<{ matchId: string; policyNumber: string; carrierId: string }> {
  const { data: review, error } = await db().from("policy_match_review").select("id, carrier_id, policy_number, shortlist, status").eq("tenant_id", scope.tenantId).eq("id", reviewId).maybeSingle();
  if (error) fail(error, "Could not load the review");
  if (!review) throw new MatchingError("That review is not in this agency.", 404);
  if (review.status !== "open") throw new MatchingError("That review has already been decided.", 409);
  let match: Record<string, unknown>;
  if ("none" in choice) {
    match = { matched_to_type: "provisional", matched_to_id: null, contact_id: null };
  } else {
    const entry = (review.shortlist ?? [])[choice.ref];
    if (!entry) throw new MatchingError("Choose one of the shortlisted candidates.", 400);
    match = { matched_to_type: entry.type, matched_to_id: entry.id, contact_id: entry.contactId ?? null };
  }
  const matchId = await record(scope.tenantId, review.carrier_id, review.policy_number, { ...match, method: "human", ladder_step: 3, confirmed_by: scope.userId, created_by: scope.userId }, review.id);
  if ("none" in choice) {
    // LA-4.9: "none of these" is a policy with no sale on record — a provisional client and a queue item.
    const carrier = await carrierOf(review.carrier_id);
    const snapshot = (await latestSnapshots(scope.tenantId, review.carrier_id, [review.policy_number])).get(review.policy_number);
    const { data: map } = snapshot?.agent_identifier ? await db().from("carrier_agent_map").select("user_id").eq("tenant_id", scope.tenantId).eq("carrier_id", review.carrier_id).eq("agent_identifier", snapshot.agent_identifier).maybeSingle() : { data: null };
    if (snapshot) await noRecordPolicy(scope.tenantId, policySide(snapshot, carrier), map?.user_id ?? null);
  }
  await refreshPolicyCurrent({ tenantId: scope.tenantId, carrierId: review.carrier_id, policies: [review.policy_number] });
  // A person linked it to a sale: if the carrier already lists it issued, the application records it (LA-3.18).
  await recordCarrierIssues(scope.tenantId, review.carrier_id, [review.policy_number]);
  return { matchId, policyNumber: review.policy_number, carrierId: review.carrier_id };
}

/** Puts a linked policy back in front of a person with a fresh shortlist; deciding it supersedes the link. */
export async function reopenMatch(scope: MatchingScope, matchId: string): Promise<{ policyNumber: string; carrierId: string }> {
  const { data: match, error } = await db().from("policy_match").select("id, carrier_id, policy_number, superseded_by_id").eq("tenant_id", scope.tenantId).eq("id", matchId).maybeSingle();
  if (error) fail(error, "Could not load the link");
  if (!match) throw new MatchingError("That link is not in this agency.", 404);
  if (match.superseded_by_id) throw new MatchingError("That link has already been corrected.", 409);
  const queued = await queueReviews(scope.tenantId, await carrierOf(match.carrier_id), [match.policy_number], null, { reviewEvenIfEmpty: true });
  if (!queued) throw new MatchingError("That policy has no snapshot to review.", 409);
  return { policyNumber: match.policy_number, carrierId: match.carrier_id };
}

/** Maps a carrier's exact agent string to one of this agency's users. */
export async function mapAgent(scope: MatchingScope, carrierId: string, agentIdentifier: string, userId: string): Promise<void> {
  const { data: member } = await db().from("tenant_users").select("user_id, role, accepted_at").eq("tenant_id", scope.tenantId).eq("user_id", userId).maybeSingle();
  if (!member || !member.accepted_at) throw new MatchingError("Choose someone in this agency.", 400);
  if (!WRITING_ROLES.includes(member.role)) throw new MatchingError("An agent code can only belong to the owner or a producer.", 400);
  const { error } = await db().from("carrier_agent_map").upsert({ tenant_id: scope.tenantId, carrier_id: carrierId, agent_identifier: agentIdentifier, user_id: userId, mapped_by: scope.userId, mapped_at: new Date().toISOString() }, { onConflict: "tenant_id,carrier_id,agent_identifier" });
  if (error) fail(error, "Could not save the agent mapping");
  await refreshPolicyCurrent({ tenantId: scope.tenantId, carrierId });
}

export async function unmapAgent(scope: MatchingScope, mapId: string): Promise<{ carrierId: string; agentIdentifier: string }> {
  const { data, error } = await db().from("carrier_agent_map").delete().eq("tenant_id", scope.tenantId).eq("id", mapId).select("carrier_id, agent_identifier");
  if (error) fail(error, "Could not remove the agent mapping");
  if (!data?.length) throw new MatchingError("That mapping is not in this agency.", 404);
  await refreshPolicyCurrent({ tenantId: scope.tenantId, carrierId: data[0].carrier_id });
  return { carrierId: data[0].carrier_id, agentIdentifier: data[0].agent_identifier };
}

export type ReviewRow = { id: string; carrierId: string; carrierName: string; policyNumber: string; carrierRow: Loose; shortlist: Array<ReturnType<typeof storedEntry>>; createdAt: string };
export type LinkRow = { id: string; carrierName: string; policyNumber: string; method: string; step: number; type: string; clientName: string | null; confidence: number | null; confirmed: boolean; createdAt: string };
export type UnmappedAgent = { carrierId: string; carrierName: string; agentIdentifier: string; policies: number };
export type MappedAgent = { id: string; carrierId: string; carrierName: string; agentIdentifier: string; userId: string; userName: string };

export async function loadMatching(tenantId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [reviews, links, current, maps, members, ladder, ai, carriers] = await Promise.all([
    // The whole review queue and every unmapped code, page by page: one request stops at 1,000.
    allRows(() => db().from("policy_match_review").select("id, carrier_id, policy_number, carrier_row, shortlist, created_at").eq("tenant_id", tenantId).eq("status", "open").order("created_at").order("id"), 10_000),
    db().from("policy_match").select("id, carrier_id, policy_number, method, ladder_step, matched_to_type, contact_id, confidence, confirmed_at, created_at").eq("tenant_id", tenantId).is("superseded_by_id", null).order("created_at", { ascending: false }).limit(200),
    allRows(() => db().from("policy_current").select("carrier_id, agent_identifier").eq("tenant_id", tenantId).not("agent_identifier", "is", null).is("agent_user_id", null).order("carrier_id").order("policy_number"), 200_000),
    db().from("carrier_agent_map").select("id, carrier_id, agent_identifier, user_id").eq("tenant_id", tenantId).order("agent_identifier"),
    db().from("tenant_users").select("user_id, role, accepted_at").eq("tenant_id", tenantId),
    db().from("policy_match_ladder").select("already_linked, exact_linked, to_review").eq("tenant_id", tenantId).gte("created_at", since),
    db().from("policy_match").select("id, confirmed_at, superseded_by_id").eq("tenant_id", tenantId).eq("method", "ai_review").gte("created_at", week),
    db().from("carriers").select("id, name"),
  ]);
  for (const read of [reviews, links, maps, ladder, ai]) {
    if (read.error) {
      if (isSchemaGap(read.error)) return { available: false as const };
      throw new Error(`Could not load policy matching: ${read.error.message}`);
    }
  }
  const carrierName = new Map<string, string>((carriers.data ?? []).map((row: Loose) => [row.id, row.name]));
  const contactIds = [...new Set((links.data ?? []).map((row: Loose) => row.contact_id).filter(Boolean))];
  const userIds = [...new Set([...(members.data ?? []).map((row: Loose) => row.user_id), ...(maps.data ?? []).map((row: Loose) => row.user_id)])];
  const [contacts, users] = await Promise.all([
    contactIds.length ? db().from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", contactIds) : { data: [] },
    userIds.length ? db().from("users").select("id, name, email").in("id", userIds) : { data: [] },
  ]);
  // LA-4.9: a client built from a carrier's file is marked until confirmed (no flag before 20261008180000).
  const flagged = contactIds.length ? await db().from("contacts").select("id").eq("tenant_id", tenantId).eq("provisional", true).in("id", contactIds) : { data: [], error: null };
  const provisional = new Set<string>(flagged.error ? [] : (flagged.data ?? []).map((row: Loose) => row.id));
  const contactName = new Map<string, string>((contacts.data ?? []).map((row: Loose) => [row.id, `${row.first_name} ${row.last_name}${provisional.has(row.id) ? " (provisional)" : ""}`]));
  const userName = new Map<string, string>((users.data ?? []).map((row: Loose) => [row.id, row.name || row.email || row.id]));

  const unmapped = new Map<string, UnmappedAgent>();
  for (const row of current.rows) {
    const key = `${row.carrier_id}|${row.agent_identifier}`;
    const entry = unmapped.get(key) ?? { carrierId: row.carrier_id, carrierName: carrierName.get(row.carrier_id) ?? "", agentIdentifier: row.agent_identifier, policies: 0 };
    entry.policies++;
    unmapped.set(key, entry);
  }
  // A correction of an AI link by a person is a later human link superseding it.
  const aiRows = (ai.data ?? []) as Loose[];
  const supersededBy = aiRows.map((row) => row.superseded_by_id).filter(Boolean);
  const { data: corrections } = supersededBy.length ? await db().from("policy_match").select("id, method").in("id", supersededBy) : { data: [] };
  const humanCorrection = new Set((corrections ?? []).filter((row: Loose) => row.method === "human").map((row: Loose) => row.id));

  return {
    available: true as const,
    reviews: (reviews.rows as Loose[]).map((row: Loose): ReviewRow => ({ id: row.id, carrierId: row.carrier_id, carrierName: carrierName.get(row.carrier_id) ?? "", policyNumber: row.policy_number, carrierRow: row.carrier_row, shortlist: row.shortlist ?? [], createdAt: row.created_at })),
    links: (links.data ?? []).map((row: Loose): LinkRow => ({ id: row.id, carrierName: carrierName.get(row.carrier_id) ?? "", policyNumber: row.policy_number, method: row.method, step: row.ladder_step, type: row.matched_to_type, clientName: row.contact_id ? contactName.get(row.contact_id) ?? null : null, confidence: row.confidence, confirmed: Boolean(row.confirmed_at), createdAt: row.created_at })),
    unmapped: [...unmapped.values()].sort((a, b) => b.policies - a.policies || a.agentIdentifier.localeCompare(b.agentIdentifier)),
    mapped: (maps.data ?? []).map((row: Loose): MappedAgent => ({ id: row.id, carrierId: row.carrier_id, carrierName: carrierName.get(row.carrier_id) ?? "", agentIdentifier: row.agent_identifier, userId: row.user_id, userName: userName.get(row.user_id) ?? row.user_id })),
    members: (members.data ?? []).filter((row: Loose) => row.accepted_at && WRITING_ROLES.includes(row.role)).map((row: Loose) => ({ userId: row.user_id as string, name: userName.get(row.user_id) ?? row.user_id, role: row.role as string })),
    ladder: ladderShare((ladder.data ?? []).map((row: Loose) => ({ alreadyLinked: row.already_linked, exactLinked: row.exact_linked, toReview: row.to_review }))),
    aiAccuracy: accuracy(aiRows.map((row) => ({ confirmed: Boolean(row.confirmed_at), correctedByHuman: Boolean(row.superseded_by_id && humanCorrection.has(row.superseded_by_id)) }))),
  };
}
