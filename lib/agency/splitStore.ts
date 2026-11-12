import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * AG-1.6 · Commission splits, as round 7 lists them (owner pick 8·A, 2026-11-10; docs/la4/mockups-r7/commissions.html):
 * Active and Ended, each with the policy's client and every producer's name.
 *
 * Ending a split needs no new column. `set_policy_split` with no shares closes the live set (`superseded_at = now()`)
 * and writes nothing in its place, so the writer keeps the whole pool again. A change closes the old set and writes
 * the new one in the same statement, with `created_at` equal to the old set's `superseded_at` (one now() per
 * transaction). So a closed set with no set written at that moment for the same policy was ENDED, on that day; a
 * closed set that was replaced is history and is not listed.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type SplitShare = { producerUserId: string; shareBps: number; isWriter: boolean };
export type SplitRow = {
  setId: string; carrierId: string; carrierName: string | null; policyNumber: string; clientName: string | null;
  writerUserId: string | null; shares: SplitShare[]; createdAt: string; endedAt: string | null;
};
export type SplitPerson = { userId: string; producerId: string; name: string };

export async function readSplitBook(tenantId: string): Promise<{ active: SplitRow[]; ended: SplitRow[]; people: SplitPerson[] }> {
  const [{ data, error }, people] = await Promise.all([
    db().from("policy_split").select("set_id, carrier_id, policy_number, producer_user_id, share_bps, is_writer, created_at, superseded_at, carriers(name)").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5000),
    db().from("producer").select("id, user_id, display_name").eq("tenant_id", tenantId).order("display_name"),
  ]);
  if (error) throw new Error(`readSplitBook: ${error.message}`);
  const sets = new Map<string, SplitRow & { supersededAt: string | null }>();
  const startedAt = new Set<string>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const key = r.set_id as string;
    startedAt.add(`${r.carrier_id}|${r.policy_number}|${new Date(r.created_at as string).getTime()}`);
    const set = sets.get(key) ?? {
      setId: key, carrierId: r.carrier_id as string, carrierName: ((r.carriers as { name?: string } | null)?.name) ?? null, policyNumber: r.policy_number as string,
      clientName: null, writerUserId: null, shares: [], createdAt: r.created_at as string, endedAt: null, supersededAt: (r.superseded_at as string | null) ?? null,
    };
    set.shares.push({ producerUserId: r.producer_user_id as string, shareBps: Number(r.share_bps), isWriter: Boolean(r.is_writer) });
    if (r.is_writer) set.writerUserId = r.producer_user_id as string;
    sets.set(key, set);
  }
  const active: SplitRow[] = [];
  const ended: SplitRow[] = [];
  for (const { supersededAt, ...set } of sets.values()) {
    set.shares.sort((a, b) => Number(b.isWriter) - Number(a.isWriter) || b.shareBps - a.shareBps);
    if (!supersededAt) active.push(set);
    else if (!startedAt.has(`${set.carrierId}|${set.policyNumber}|${new Date(supersededAt).getTime()}`)) ended.push({ ...set, endedAt: supersededAt });
  }
  ended.sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
  // The client on each policy, from the book (read only; a policy not in the book shows no client).
  const all = [...active, ...ended];
  const numbers = [...new Set(all.map((s) => s.policyNumber))];
  const clients = new Map<string, string>();
  for (let i = 0; i < numbers.length; i += 200) {
    const { data: pcs } = await db().from("policy_current").select("carrier_id, policy_number, contact_id").eq("tenant_id", tenantId).in("policy_number", numbers.slice(i, i + 200));
    const rows = (pcs ?? []) as Array<{ carrier_id: string; policy_number: string; contact_id: string | null }>;
    const ids = [...new Set(rows.map((p) => p.contact_id).filter(Boolean))] as string[];
    const { data: contacts } = ids.length ? await db().from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", ids) : { data: [] };
    const nameOf = new Map(((contacts ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>).map((c) => [c.id, [c.first_name, c.last_name].filter(Boolean).join(" ")]));
    for (const p of rows) if (p.contact_id && nameOf.get(p.contact_id)) clients.set(`${p.carrier_id}|${p.policy_number}`, nameOf.get(p.contact_id)!);
  }
  for (const s of all) s.clientName = clients.get(`${s.carrierId}|${s.policyNumber}`) ?? null;
  return {
    active,
    ended,
    people: ((people.data ?? []) as Array<{ id: string; user_id: string; display_name: string | null }>).map((p) => ({ userId: p.user_id, producerId: p.id, name: p.display_name ?? "Producer" })),
  };
}

export type PolicyHit = { carrierId: string; carrierName: string; policyNumber: string; clientName: string | null; writerUserId: string | null };

/**
 * New split's policy lookup (8·1): the book by policy number (from its start) or the client's name. At most 12.
 * Read only.
 */
export async function lookupPolicies(tenantId: string, raw: string): Promise<PolicyHit[]> {
  const q = raw.trim().replace(/\s+/g, " ").slice(0, 80);
  if (q.length < 2) return [];
  const escape = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const words = q.replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/).filter((w) => w.length >= 2).slice(0, 3);
  const base = () => db().from("policy_current").select("carrier_id, policy_number, contact_id, agent_user_id").eq("tenant_id", tenantId);
  const [byNumber, people] = await Promise.all([
    /^[A-Za-z0-9-]{2,}$/.test(q) ? base().ilike("policy_number", `${escape(q)}%`).limit(12) : { data: [] },
    words.length ? db().from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).or(`first_name.ilike.%${words[0]}%,last_name.ilike.%${words[0]}%`).limit(100) : { data: [] },
  ]);
  if (byNumber.error) throw new Error(`lookupPolicies: ${byNumber.error.message}`);
  const matched = ((people.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>).filter((c) => words.every((w) => `${c.first_name ?? ""} ${c.last_name ?? ""}`.toLowerCase().includes(w.toLowerCase())));
  const byContact = matched.length ? await base().in("contact_id", matched.slice(0, 40).map((c) => c.id)).limit(12) : { data: [] };
  const seen = new Set<string>();
  const found = ([...(byNumber.data ?? []), ...(byContact.data ?? [])] as Array<{ carrier_id: string; policy_number: string; contact_id: string | null; agent_user_id: string | null }>)
    .filter((p) => { const key = `${p.carrier_id}|${p.policy_number}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, 12);
  if (!found.length) return [];
  const contactIds = [...new Set(found.map((p) => p.contact_id).filter(Boolean))] as string[];
  const [{ data: contacts }, { data: carriers }] = await Promise.all([
    contactIds.length ? db().from("contacts").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", contactIds) : { data: [] },
    db().from("carriers").select("id, name").in("id", [...new Set(found.map((p) => p.carrier_id))]),
  ]);
  const client = new Map(((contacts ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>).map((c) => [c.id, [c.first_name, c.last_name].filter(Boolean).join(" ") || null]));
  const carrier = new Map(((carriers ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  return found.map((p) => ({ carrierId: p.carrier_id, carrierName: carrier.get(p.carrier_id) ?? "Carrier", policyNumber: p.policy_number, clientName: p.contact_id ? client.get(p.contact_id) ?? null : null, writerUserId: p.agent_user_id }));
}
