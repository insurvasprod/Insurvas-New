import "server-only";

import { getContactDirectory } from "@/lib/contacts/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import type { ProducerScope } from "@/lib/agency/visibility";

import { recordCarrierIssues } from "./applicationIssueStore";
import { closeAnsweredItems } from "./exceptionQueuesStore";
import { splitName } from "./policyMatching";
import { MATCHING_PENDING_MESSAGE, MatchingError } from "./policyMatchingStore";
import { refreshPolicyCurrent } from "./policyCurrentStore";
import { matchCount, WHY_MAX, type CarrierPerson } from "./policyPage";

/**
 * Book of business, round 2 · Policy › Client › Change client (its own page, was a side sheet).
 *
 * The search reuses the contact directory's search (name and phone; contact_directory_page), plus the two
 * things it doesn't search: a date of birth typed as a date, and a policy number (the client another policy
 * is linked to). Each match is set against the carrier's row with the five-fact count (policyPage.ts).
 *
 * The write goes through the one link write path, record_policy_match (LA-4.8), which supersedes the old
 * link rather than overwriting it, so the Client tab's link history keeps every link and the why. Then, as
 * Policy matching's resolveReview does after a person decides: the current-state row is rebuilt (the
 * policy's history and money follow the client with it), a sale the carrier lists as issued is recorded
 * on the application, and the Needs you items the link answers close.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

const str = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

/** The carrier's person on this policy, from its latest snapshot (the same fields Policy matching compares). */
export async function carrierPerson(tenantId: string, carrierId: string, policyNumber: string): Promise<CarrierPerson | null> {
  const { data, error } = await db().from("policy_snapshot").select("extra, snapshot_date").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).eq("superseded", false).order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  const fields = (data.extra?.fields ?? {}) as Record<string, unknown>;
  const split = splitName(str(fields.insured_name));
  return { firstName: str(fields.insured_first_name) ?? split.firstName, lastName: str(fields.insured_last_name) ?? split.lastName, dob: str(fields.insured_dob), phone: str(fields.insured_phone) };
}

export type ClientMatch = {
  contactId: string;
  name: string;
  dob: string | null;
  phone: string | null;
  provisional: boolean;
  /** The newest sale on record for this client: an application, with its date and agent. */
  sale: { date: string | null; agentName: string | null; carrierMatches: boolean } | null;
  matched: number;
  of: number;
  facts: string[];
  linkedNow: boolean;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const US_DAY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
function asDay(query: string): string | null {
  const text = query.trim();
  if (ISO_DAY.test(text)) return text;
  const us = US_DAY.exec(text);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : null;
}

/** Clients for the Change client page: by name, phone, date of birth or a policy number; at most 20, best match first. */
export async function searchClients(input: { tenantId: string; carrierId: string; policyNumber: string; query: string; scope: ProducerScope; currentContactId: string | null; carrier: CarrierPerson | null }): Promise<ClientMatch[]> {
  const query = input.query.trim().slice(0, 120);
  if (query.length < 2) return [];
  const day = asDay(query);
  const [directory, byDob, byPolicy] = await Promise.all([
    day ? Promise.resolve({ rows: [] as Loose[] }) : getContactDirectory(input.tenantId, { q: query, pageSize: 20 }, input.scope).catch(() => ({ rows: [] as Loose[] })),
    day ? db().from("contacts").select("id").eq("tenant_id", input.tenantId).eq("dob", day).is("merged_into_id", null).limit(20) : { data: [] },
    /^[A-Za-z0-9-]{4,}$/.test(query) ? db().from("policy_current").select("contact_id").eq("tenant_id", input.tenantId).ilike("policy_number", `${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`).not("contact_id", "is", null).limit(20) : { data: [] },
  ]);
  const ids = [...new Set([...(directory.rows ?? []).map((r: Loose) => r.id), ...(byDob.data ?? []).map((r: Loose) => r.id), ...(byPolicy.data ?? []).map((r: Loose) => r.contact_id)].filter(Boolean))].slice(0, 40) as string[];
  if (!ids.length) return [];
  let contactQuery = db().from("contacts").select("id, first_name, last_name, dob, primary_phone, provisional").eq("tenant_id", input.tenantId).in("id", ids);
  let contacts = await contactQuery;
  if (contacts.error && isSchemaGap(contacts.error)) {
    contactQuery = db().from("contacts").select("id, first_name, last_name, dob, primary_phone").eq("tenant_id", input.tenantId).in("id", ids);
    contacts = await contactQuery;
  }
  if (contacts.error) throw new Error(`Could not search clients: ${contacts.error.message}`);
  // A narrowed agency session sees only the clients its directory search returns (AG-0.5); a date or policy-number
  // hit outside that scope is dropped rather than shown.
  const allowed = input.scope === null ? null : new Set((directory.rows ?? []).map((r: Loose) => r.id));
  const people = ((contacts.data ?? []) as Loose[]).filter((c) => allowed === null || allowed.has(c.id));
  const sales = await salesOf(input.tenantId, people.map((c) => c.id), input.carrierId);
  const carrier = input.carrier ?? { firstName: null, lastName: null, dob: null, phone: null };
  return people.map((c): ClientMatch => {
    const sale = sales.get(c.id) ?? null;
    const count = matchCount(carrier, { firstName: c.first_name, lastName: c.last_name, dob: c.dob, phone: c.primary_phone, hasSaleWithCarrier: Boolean(sale?.carrierMatches) });
    return { contactId: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "A client", dob: c.dob ?? null, phone: c.primary_phone ?? null, provisional: Boolean(c.provisional), sale, ...count, linkedNow: c.id === input.currentContactId };
  }).sort((a, b) => b.matched - a.matched || a.name.localeCompare(b.name)).slice(0, 20);
}

/** Each client's newest application (through their leads), and whether it is with this carrier. */
async function salesOf(tenantId: string, contactIds: string[], carrierId: string): Promise<Map<string, { date: string | null; agentName: string | null; carrierMatches: boolean; applicationId: string }>> {
  const out = new Map<string, { date: string | null; agentName: string | null; carrierMatches: boolean; applicationId: string }>();
  if (!contactIds.length) return out;
  const { data: leads } = await db().from("agent_leads").select("id, contact_id").eq("tenant_id", tenantId).in("contact_id", contactIds).limit(500);
  const contactOf = new Map<string, string>(((leads ?? []) as Loose[]).map((l) => [l.id, l.contact_id]));
  if (!contactOf.size) return out;
  const { data: apps } = await db().from("tenant_applications").select("id, lead_id, carrier_id, created_at, submitted_at, created_by").eq("tenant_id", tenantId).in("lead_id", [...contactOf.keys()]).order("created_at", { ascending: false }).limit(500);
  const rows = (apps ?? []) as Loose[];
  const userIds = [...new Set(rows.map((a) => a.created_by).filter(Boolean))];
  const { data: users } = userIds.length ? await db().from("users").select("id, name, email").in("id", userIds) : { data: [] };
  const userName = new Map<string, string>(((users ?? []) as Loose[]).map((u) => [u.id, u.name || u.email]));
  for (const app of rows) {
    const contactId = contactOf.get(app.lead_id);
    if (!contactId) continue;
    const existing = out.get(contactId);
    // Prefer this carrier's newest sale; otherwise the newest sale of all.
    if (existing && (existing.carrierMatches || app.carrier_id !== carrierId)) continue;
    out.set(contactId, { date: app.submitted_at ?? app.created_at ?? null, agentName: app.created_by ? userName.get(app.created_by) ?? null : null, carrierMatches: app.carrier_id === carrierId, applicationId: app.id });
  }
  return out;
}

/**
 * Link the policy to another client. To the client's application with this carrier when there is one (so
 * the sale, its card and its money follow), else to the client. The old link is superseded, not removed.
 */
export async function linkPolicyToClient(scope: { tenantId: string; userId: string }, input: { carrierId: string; policyNumber: string; contactId: string; reason: string }): Promise<{ matchId: string; applicationId: string | null; previousContactId: string | null }> {
  const reason = input.reason.trim().slice(0, WHY_MAX);
  if (!reason) throw new MatchingError("Say why, so the link history explains the change.", 400);
  const [policy, contact, link] = await Promise.all([
    db().from("policy_current").select("policy_number, contact_id").eq("tenant_id", scope.tenantId).eq("carrier_id", input.carrierId).eq("policy_number", input.policyNumber).maybeSingle(),
    db().from("contacts").select("id, merged_into_id").eq("tenant_id", scope.tenantId).eq("id", input.contactId).maybeSingle(),
    db().from("policy_match").select("id, contact_id").eq("tenant_id", scope.tenantId).eq("carrier_id", input.carrierId).eq("policy_number", input.policyNumber).is("superseded_by_id", null).maybeSingle(),
  ]);
  if (link.error && isSchemaGap(link.error)) throw new MatchingError(MATCHING_PENDING_MESSAGE, 503);
  if (policy.error) throw new Error(`Could not read the policy: ${policy.error.message}`);
  if (!policy.data) throw new MatchingError("That policy is not in your book.", 404);
  if (!contact.data) throw new MatchingError("Choose a client from this agency.", 400);
  if (contact.data.merged_into_id) throw new MatchingError("That client was merged into another one. Search again and choose the one it was merged into.", 409);
  if (link.data?.contact_id === input.contactId) throw new MatchingError("The policy is already linked to that client.", 409);

  const sale = (await salesOf(scope.tenantId, [input.contactId], input.carrierId)).get(input.contactId);
  const applicationId = sale?.carrierMatches ? sale.applicationId : null;
  const match = applicationId
    ? { matched_to_type: "application", matched_to_id: applicationId, contact_id: input.contactId }
    : { matched_to_type: "contact", matched_to_id: input.contactId, contact_id: input.contactId };
  const { data: matchId, error } = await db().rpc("record_policy_match", {
    p_tenant_id: scope.tenantId, p_carrier_id: input.carrierId, p_policy_number: input.policyNumber,
    p_match: { ...match, method: "human", ladder_step: 3, reasoning: reason, confirmed_by: scope.userId, created_by: scope.userId },
    p_review_id: null,
  });
  if (error) {
    if (isSchemaGap(error)) throw new MatchingError(MATCHING_PENDING_MESSAGE, 503);
    if (error.code === "P0001" || error.code === "22023") throw new MatchingError(error.message, 409);
    throw new Error(`The policy link could not be saved: ${error.message}`);
  }
  await refreshPolicyCurrent({ tenantId: scope.tenantId, carrierId: input.carrierId, policies: [input.policyNumber] });
  if (applicationId) await recordCarrierIssues(scope.tenantId, input.carrierId, [input.policyNumber]);
  await closeAnsweredItems(scope.tenantId, input.carrierId, [input.policyNumber]);
  // PIPELINE RULES EXTENSION SPOT: once lib/pipelineRules/ lands, undo the rule moves this policy made on the
  // old client's card and let the new client's card follow the rule once. Today no rule moves cards, and the
  // application's own stage sync moves the new client's card when recordCarrierIssues records the issue.
  return { matchId: matchId as string, applicationId, previousContactId: link.data?.contact_id ?? policy.data.contact_id ?? null };
}
