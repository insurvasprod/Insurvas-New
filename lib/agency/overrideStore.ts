import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { spreadBps } from "./overrideCore";
import { scopeFor } from "./visibility";

/**
 * AG-1.2 · Hierarchy & Overrides. Two levels, so a list, not a tree: per producer and carrier — his manager, the
 * agency's level, his level, the spread (computed, always; nobody types an override) and the override earned this
 * period (what the carrier paid the agency on his posted rows, less his reported share). A missing level is null
 * and a prompt, never zero; a negative spread is a data error shown loudly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type OverrideRow = {
  producerId: string;
  producerUserId: string;
  producerName: string;
  managerProducerId: string | null;
  managerName: string;
  carrierId: string;
  carrierName: string;
  agencyLevelBps: number | null;
  producerLevelBps: number | null;
  spreadBps: number | null;
  overrideCents: number | null;
};

export async function readOverrides(context: { tenantId: string; userId: string }, period: { from: string; to: string }): Promise<OverrideRow[]> {
  const scope = await scopeFor(context);
  const today = new Date().toISOString().slice(0, 10);
  const t = context.tenantId;
  const [producers, hierarchy, levels, agencyLevels, posted] = await Promise.all([
    db().from("producer").select("id, user_id, display_name, status").eq("tenant_id", t).neq("status", "invited").neq("status", "offboarded"),
    db().from("producer_hierarchy").select("producer_id, parent_producer_id, effective_from, effective_to").eq("tenant_id", t),
    db().from("producer_contract_level").select("producer_id, carrier_id, level_bps, effective_from, effective_to").eq("tenant_id", t),
    db().from("tenant_carriers").select("carrier_id, contract_level_bp, effective_from, carriers(name)").eq("tenant_id", t),
    db().from("producer_ledger_entry").select("producer_user_id, carrier_id, amount_cents, commission_entry_id, commission_entry(amount_cents)").eq("tenant_id", t).eq("basis", "reported").in("entry_type", ["earned", "chargeback"]).gte("occurred_on", period.from).lte("occurred_on", period.to),
  ]);
  const people = ((producers.data ?? []) as Array<{ id: string; user_id: string; display_name: string }>).filter((p) => scope === null || scope.includes(p.user_id));
  const nameById = new Map(((producers.data ?? []) as Array<{ id: string; display_name: string }>).map((p) => [p.id, p.display_name]));
  const inForce = (r: { effective_from: string; effective_to: string | null }) => r.effective_from <= today && (!r.effective_to || today <= r.effective_to);
  const manager = new Map<string, string | null>();
  for (const h of (hierarchy.data ?? []) as Array<{ producer_id: string; parent_producer_id: string | null; effective_from: string; effective_to: string | null }>) if (inForce(h)) manager.set(h.producer_id, h.parent_producer_id);
  const agency = new Map<string, { bps: number; name: string; from: string }>();
  for (const a of (agencyLevels.data ?? []) as Array<{ carrier_id: string; contract_level_bp: number; effective_from: string; carriers: { name?: string } | null }>) {
    if (a.effective_from > today) continue;
    const prev = agency.get(a.carrier_id);
    if (!prev || prev.from < a.effective_from) agency.set(a.carrier_id, { bps: a.contract_level_bp, name: a.carriers?.name ?? "Carrier", from: a.effective_from });
  }
  const level = new Map<string, number>();
  for (const l of (levels.data ?? []) as Array<{ producer_id: string; carrier_id: string; level_bps: number; effective_from: string; effective_to: string | null }>) if (inForce(l)) level.set(`${l.producer_id}:${l.carrier_id}`, l.level_bps);
  // override this period per producer and carrier: the agency's side of each posted row, less the producer's share
  const override = new Map<string, number>();
  const seenEntry = new Set<string>();
  for (const e of (posted.data ?? []) as Array<{ producer_user_id: string; carrier_id: string; amount_cents: number; commission_entry_id: string | null; commission_entry: { amount_cents: number } | null }>) {
    const key = `${e.producer_user_id}:${e.carrier_id}`;
    let value = override.get(key) ?? 0;
    // a split row appears once per producer; the agency's side is counted once, on the first producer seen
    if (e.commission_entry_id && !seenEntry.has(e.commission_entry_id)) {
      value += Number(e.commission_entry?.amount_cents ?? 0);
      seenEntry.add(e.commission_entry_id);
    }
    value -= Number(e.amount_cents);
    override.set(key, value);
  }
  const rows: OverrideRow[] = [];
  for (const p of people) {
    // Every carrier the agency holds a contract with: a producer without a level for one shows the prompt row.
    for (const carrierId of agency.keys()) {
      const agencyBps = agency.get(carrierId)?.bps ?? null;
      const producerBps = level.get(`${p.id}:${carrierId}`) ?? null;
      const mgr = manager.get(p.id) ?? null;
      rows.push({
        producerId: p.id,
        producerUserId: p.user_id,
        producerName: p.display_name,
        managerProducerId: mgr,
        managerName: mgr ? nameById.get(mgr) ?? "Manager" : "Owner",
        carrierId,
        carrierName: agency.get(carrierId)?.name ?? "Carrier",
        agencyLevelBps: agencyBps,
        producerLevelBps: producerBps,
        spreadBps: spreadBps(agencyBps, producerBps),
        overrideCents: producerBps === null ? null : override.get(`${p.user_id}:${carrierId}`) ?? 0,
      });
    }
  }
  return rows.sort((a, b) => a.producerName.localeCompare(b.producerName) || a.carrierName.localeCompare(b.carrierName));
}
