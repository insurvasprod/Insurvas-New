import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { allRows } from "@/lib/ingestion/pages";
import { spreadBps } from "./overrideCore";
import { scopeFor } from "./visibility";
import { monthBounds, monthsEnding, type HierarchyMonth } from "./hierarchyView";

/**
 * AG-1.2 · Hierarchy & Overrides. Two levels, so a list, not a tree: per producer and carrier — his manager, the
 * agency's level, his level, the spread (computed, always; nobody types an override) and the override earned this
 * period (what the carrier paid the agency on his posted rows, less his reported share). A missing level is null
 * and a prompt, never zero; a negative spread is a data error shown loudly.
 *
 * Reports round 7 (owner pick 6 · B and C, 2026-11-11): the levels, the manager and the roster are read AS OF a
 * date (the period's last day, or today when that is later), so a chosen month shows that month's contract; and
 * `readOverrideReport` reads six months in one go for the six-month line and the cards' small charts.
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

type Dated = { effective_from: string; effective_to: string | null };
type Producer = { id: string; user_id: string; display_name: string; status: string; created_at: string | null; offboarded_on: string | null };
type Hierarchy = Dated & { producer_id: string; parent_producer_id: string | null };
type ProducerLevel = Dated & { producer_id: string; carrier_id: string; level_bps: number };
type AgencyLevel = { carrier_id: string; contract_level_bp: number; effective_from: string; carriers: { name?: string } | null };
type Posted = { producer_user_id: string; carrier_id: string; occurred_on: string; amount_cents: number; commission_entry_id: string | null; commission_entry: { amount_cents: number } | null };

type Sources = { scope: readonly string[] | null; producers: Producer[]; hierarchy: Hierarchy[]; levels: ProducerLevel[]; agencyLevels: AgencyLevel[] };

const todayIso = () => new Date().toISOString().slice(0, 10);

async function readSources(context: { tenantId: string; userId: string }): Promise<Sources> {
  const t = context.tenantId;
  // the scope is read beside the rest (it filters in code below, it narrows no query)
  const [scope, producers, hierarchy, levels, agencyLevels] = await Promise.all([
    scopeFor(context),
    db().from("producer").select("id, user_id, display_name, status, created_at, offboarded_on").eq("tenant_id", t).neq("status", "invited"),
    db().from("producer_hierarchy").select("producer_id, parent_producer_id, effective_from, effective_to").eq("tenant_id", t),
    db().from("producer_contract_level").select("producer_id, carrier_id, level_bps, effective_from, effective_to").eq("tenant_id", t),
    db().from("tenant_carriers").select("carrier_id, contract_level_bp, effective_from, carriers(name)").eq("tenant_id", t),
  ]);
  for (const read of [producers, hierarchy, levels, agencyLevels]) if (read.error) throw new Error(read.error.message ?? "overrides read failed");
  return { scope, producers: producers.data ?? [], hierarchy: hierarchy.data ?? [], levels: levels.data ?? [], agencyLevels: agencyLevels.data ?? [] };
}

/** The reported ledger rows of the visible producers' business between two days (every page of them). */
async function readPosted(tenantId: string, from: string, to: string): Promise<Posted[]> {
  const { rows, error } = await allRows(() => db().from("producer_ledger_entry")
    .select("id, producer_user_id, carrier_id, occurred_on, amount_cents, commission_entry_id, commission_entry(amount_cents)")
    .eq("tenant_id", tenantId).eq("basis", "reported").in("entry_type", ["earned", "chargeback"])
    .gte("occurred_on", from).lte("occurred_on", to).order("occurred_on").order("id"));
  if (error) throw new Error(error.message ?? "ledger read failed");
  return rows as Posted[];
}

/** Override per producer user and carrier: the agency's side of each posted row, less the producer's share. */
function overrideOf(posted: readonly Posted[]): Map<string, number> {
  const override = new Map<string, number>();
  const seenEntry = new Set<string>();
  for (const e of posted) {
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
  return override;
}

/** The rows as they stood on `asOf`: who was on the roster, who he reported to, the levels in force then. */
function rowsAsOf(src: Sources, asOf: string, override: Map<string, number>): { rows: OverrideRow[]; people: number } {
  const inForce = (r: Dated) => r.effective_from <= asOf && (!r.effective_to || asOf <= r.effective_to);
  const onRoster = (p: Producer) =>
    (!p.created_at || p.created_at.slice(0, 10) <= asOf) &&
    !(p.status === "offboarded" && (!p.offboarded_on || p.offboarded_on <= asOf));
  const people = src.producers.filter((p) => onRoster(p) && (src.scope === null || src.scope.includes(p.user_id)));
  const nameById = new Map(src.producers.map((p) => [p.id, p.display_name]));
  const manager = new Map<string, string | null>();
  for (const h of src.hierarchy) if (inForce(h)) manager.set(h.producer_id, h.parent_producer_id);
  const agency = new Map<string, { bps: number; name: string; from: string }>();
  for (const a of src.agencyLevels) {
    if (a.effective_from > asOf) continue;
    const prev = agency.get(a.carrier_id);
    if (!prev || prev.from < a.effective_from) agency.set(a.carrier_id, { bps: a.contract_level_bp, name: a.carriers?.name ?? "Carrier", from: a.effective_from });
  }
  const level = new Map<string, number>();
  for (const l of src.levels) if (inForce(l)) level.set(`${l.producer_id}:${l.carrier_id}`, l.level_bps);
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
  return { rows: rows.sort((a, b) => a.producerName.localeCompare(b.producerName) || a.carrierName.localeCompare(b.carrierName)), people: people.length };
}

const asOfFor = (to: string) => { const today = todayIso(); return to < today ? to : today; };

export async function readOverrides(context: { tenantId: string; userId: string }, period: { from: string; to: string }): Promise<OverrideRow[]> {
  const [src, posted] = await Promise.all([readSources(context), readPosted(context.tenantId, period.from, period.to)]);
  return rowsAsOf(src, asOfFor(period.to), overrideOf(posted)).rows;
}

/** One month of the six-month line and the cards' small charts. */
export type OverrideMonthPoint = HierarchyMonth & { overrideCents: number; missing: number; negative: number; producers: number };

/**
 * Reports › Hierarchy & overrides: the chosen month's rows, and the six months ending with it (each read as it
 * stood at that month's end). One read of the levels and one of the ledger, however many months.
 */
export async function readOverrideReport(context: { tenantId: string; userId: string }, month: string): Promise<{ rows: OverrideRow[]; trend: OverrideMonthPoint[] }> {
  const months = monthsEnding(month, 6);
  const first = monthBounds(months[0].key).from;
  const last = monthBounds(month).to;
  const [src, posted] = await Promise.all([readSources(context), readPosted(context.tenantId, first, last)]);
  const byMonth = new Map<string, Posted[]>();
  for (const e of posted) {
    const key = e.occurred_on.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(e); else byMonth.set(key, [e]);
  }
  let rows: OverrideRow[] = [];
  const trend = months.map((m) => {
    const { rows: monthRows, people } = rowsAsOf(src, asOfFor(monthBounds(m.key).to), overrideOf(byMonth.get(m.key) ?? []));
    if (m.key === month) rows = monthRows;
    return {
      ...m,
      overrideCents: monthRows.reduce((sum, r) => sum + (r.overrideCents ?? 0), 0),
      missing: monthRows.filter((r) => r.producerLevelBps === null).length,
      negative: monthRows.filter((r) => r.spreadBps !== null && r.spreadBps < 0).length,
      producers: people,
    };
  });
  return { rows, trend };
}
