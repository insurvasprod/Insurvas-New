import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { mapLimit, READ_CONCURRENCY } from "@/lib/retention/batch";

/**
 * Commissions › Ledger (board 12, 2026-11-03): the Client and Agent a ledger line belongs to. Reads only.
 *
 * A carrier-file line names a carrier and a policy number; its client is the contact the policy is linked to
 * (policy_current.contact_id), and its agent the producer it is credited to (the line's own agent_user_id, else
 * the policy's). A hand-imported statement line carries its insured's name already. Unknown stays unknown: the
 * page leaves the cell empty, and drops a column that is empty on every row.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;
const CHUNK = 200;

const chunks = <T,>(items: T[]) => {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += CHUNK) out.push(items.slice(at, at + CHUNK));
  return out;
};

export type LedgerNameInput = { carrierId: string; policyNumber: string; agentUserId: string | null; account?: true; source?: "hand" };
export type LedgerNames = { clientOf: (carrierId: string, policyNumber: string) => string | null; agentOf: (carrierId: string, policyNumber: string, agentUserId: string | null) => string | null };

const key = (carrierId: string, policyNumber: string) => `${carrierId}|${policyNumber}`;
const personName = (row: { first_name?: string | null; last_name?: string | null } | undefined) => [row?.first_name, row?.last_name].map((part) => (part ?? "").trim()).filter(Boolean).join(" ") || null;

export async function ledgerNames(tenantId: string, rows: LedgerNameInput[]): Promise<LedgerNames> {
  // Carrier-file lines only: a hand line's carrier id may be a stand-in ("hand:…"), and an account line names no policy.
  const byCarrier = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.account || row.source === "hand" || !row.policyNumber) continue;
    const set = byCarrier.get(row.carrierId) ?? new Set<string>();
    set.add(row.policyNumber);
    byCarrier.set(row.carrierId, set);
  }
  const work = [...byCarrier.entries()].flatMap(([carrierId, numbers]) => chunks([...numbers]).map((part) => ({ carrierId, part })));
  const policies = (await mapLimit(work, READ_CONCURRENCY, async ({ carrierId, part }) => {
    const { data, error } = await db().from("policy_current").select("carrier_id, policy_number, contact_id, agent_user_id").eq("tenant_id", tenantId).eq("carrier_id", carrierId).in("policy_number", part);
    if (error) console.error("[ledger] policy names could not be read", error.message);
    return (data ?? []) as Array<{ carrier_id: string; policy_number: string; contact_id: string | null; agent_user_id: string | null }>;
  })).flat();
  const policy = new Map(policies.map((row) => [key(row.carrier_id, row.policy_number), row]));

  const contactIds = [...new Set(policies.map((row) => row.contact_id).filter((id): id is string => Boolean(id)))];
  const userIds = [...new Set([...rows.map((row) => row.agentUserId), ...policies.map((row) => row.agent_user_id)].filter((id): id is string => Boolean(id)))];
  const [contacts, users] = await Promise.all([
    // contacts carry the tenant: the filter keeps the read on this agency's rows (no RLS on the service role).
    mapLimit(chunks(contactIds), READ_CONCURRENCY, async (part) => ((await db().from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", part)).data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>),
    mapLimit(chunks(userIds), READ_CONCURRENCY, async (part) => ((await db().from("users").select("id, name, email").in("id", part)).data ?? []) as Array<{ id: string; name: string | null; email: string | null }>),
  ]);
  const contact = new Map(contacts.flat().map((row) => [row.id, personName(row)]));
  const user = new Map(users.flat().map((row) => [row.id, (row.name ?? "").trim() || row.email || null]));

  return {
    clientOf: (carrierId, policyNumber) => {
      const id = policy.get(key(carrierId, policyNumber))?.contact_id;
      return id ? contact.get(id) ?? null : null;
    },
    agentOf: (carrierId, policyNumber, agentUserId) => {
      const id = agentUserId ?? policy.get(key(carrierId, policyNumber))?.agent_user_id ?? null;
      return id ? user.get(id) ?? null : null;
    },
  };
}
