import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { agencyRpc } from "./rpc";
import { producerScores, type ProducerScore } from "./scorecardStore";
import { scopeFor } from "./visibility";

/**
 * AG-0.11 · the agency dashboard: "which of my producers is actually making me money?". Four panels, every
 * figure a READ of an existing engine grouped by producer — nothing computed here that LA-4, LA-5 or LA-7 computes:
 *   1. league       submitted, issued, placement this month            (scorecardStore ← LA-4.18)
 *   2. exposure     month-4 survival, advance at risk                   (scorecardStore ← LA-4.18 / policy_current)
 *   3. payable      owed to each producer now, who is negative, override (AG-1.5 ledger, reported basis)
 *   4. health       seats against the band; licences and appointments expiring inside 60 days
 * Owner, admin and bookkeeper see the agency; a manager the same screen scoped to his reports; a producer never.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type HealthAlert = { producerUserId: string; name: string; item: string; detail: string; expiresOn: string; daysLeft: number };

export type AgencyDashboard = {
  period: { from: string; to: string };
  seats: { used: number; max: number | null };
  producers: Array<ProducerScore & { balanceCents: number | null }>;
  payableOutCents: number | null;
  negativeCount: number | null;
  overrideCents: number | null;
  alerts: HealthAlert[];
  minSample: number;
  ledgerReady: boolean;
};

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export async function readDashboard(context: { tenantId: string; userId: string; role: string }, period: { from: string; to: string }): Promise<AgencyDashboard> {
  const scope = await scopeFor(context);
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

  // Panel 3 — the payable ledger (reported basis). Empty state, not zero, until AG-1.5 is live. The sync must
  // land before the balances are read, so the two stay a chain; the chain itself runs beside the other panels.
  const ledger = (async () => {
    await agencyRpc<number>("agency_ledger_sync", { p_tenant_id: context.tenantId });
    return agencyRpc<Array<{ producer_user_id: string; basis: string; balance_cents: number }>>("agency_producer_balances", { p_tenant_id: context.tenantId, p_as_of: today });
  })().then((rows) => ({ ok: true as const, rows }), () => ({ ok: false as const, rows: null }));

  // The owner's override for the period: what the carriers paid the agency on producers' business, less the
  // producers' reported share of it. Both sides are reported basis. Read alongside the ledger and used only
  // when the ledger turned out ready, exactly as when it was read after it.
  const overrideReads = scope === null
    ? Promise.all([
      db().from("commission_entry").select("amount_cents, id").eq("tenant_id", context.tenantId).in("entry_type", ["advance", "earned", "chargeback"]).gte("transaction_date", period.from).lte("transaction_date", period.to),
      db().from("producer_ledger_entry").select("amount_cents, commission_entry_id").eq("tenant_id", context.tenantId).eq("basis", "reported").in("entry_type", ["earned", "chargeback"]).gte("occurred_on", period.from).lte("occurred_on", period.to),
    ])
    : null;

  const [scores, seatsUsed, seatLimit, producers, ledgerResult, overrideResult] = await Promise.all([
    producerScores(context, period),
    agencyRpc<number>("tenant_seats_used", { p_tenant_id: context.tenantId }).catch(() => 0),
    agencyRpc<number | null>("tenant_seat_limit", { p_tenant_id: context.tenantId }).catch(() => null),
    db().from("producer").select("id, user_id, display_name").eq("tenant_id", context.tenantId).neq("status", "offboarded"),
    ledger,
    overrideReads,
  ]);
  const visible = ((producers.data ?? []) as Array<{ id: string; user_id: string; display_name: string }>).filter((p) => scope === null || scope.includes(p.user_id));
  const producerIds = visible.map((p) => p.id);
  const nameOfProducerId = new Map(visible.map((p) => [p.id, { name: p.display_name, user: p.user_id }]));

  const ledgerReady = ledgerResult.ok;
  const balance = new Map<string, number>();
  for (const r of ledgerResult.rows ?? []) if (r.basis === "reported") balance.set(r.producer_user_id, Number(r.balance_cents));

  let overrideCents: number | null = null;
  if (ledgerReady && overrideResult) {
    const [{ data: paid }, { data: shares }] = overrideResult;
    const posted = new Set(((shares ?? []) as Array<{ commission_entry_id: string | null }>).map((s) => s.commission_entry_id).filter(Boolean));
    const agencySide = ((paid ?? []) as Array<{ id: string; amount_cents: number }>).filter((p) => posted.has(p.id)).reduce((s, p) => s + Number(p.amount_cents), 0);
    const producerSide = ((shares ?? []) as Array<{ amount_cents: number }>).reduce((s, p) => s + Number(p.amount_cents), 0);
    overrideCents = agencySide - producerSide;
  }

  // Panel 4 — licences and appointments expiring inside 60 days (the gate's own records).
  const alerts: HealthAlert[] = [];
  if (producerIds.length) {
    const [appts, lic] = await Promise.all([
      db().from("producer_appointment").select("producer_id, state, expires_on, carriers(name)").eq("tenant_id", context.tenantId).in("producer_id", producerIds).eq("status", "appointed").gte("expires_on", today).lte("expires_on", horizon),
      db().from("tenant_user_licensed_states").select("user_id, state, expires_on").eq("tenant_id", context.tenantId).in("user_id", visible.map((p) => p.user_id)).gte("expires_on", today).lte("expires_on", horizon),
    ]);
    for (const a of (appts.data ?? []) as Array<{ producer_id: string; state: string; expires_on: string; carriers: { name?: string } | null }>) {
      const who = nameOfProducerId.get(a.producer_id);
      if (who) alerts.push({ producerUserId: who.user, name: who.name, item: "Appointment", detail: `${a.carriers?.name ?? "Carrier"} · ${a.state}`, expiresOn: a.expires_on, daysLeft: days(today, a.expires_on) });
    }
    const byUser = new Map(visible.map((p) => [p.user_id, p.display_name]));
    for (const l of (lic.data ?? []) as Array<{ user_id: string; state: string; expires_on: string }>) {
      alerts.push({ producerUserId: l.user_id, name: byUser.get(l.user_id) ?? "Producer", item: "Licence", detail: `State licence · ${l.state}`, expiresOn: l.expires_on, daysLeft: days(today, l.expires_on) });
    }
  }
  alerts.sort((a, b) => a.daysLeft - b.daysLeft);

  const rows = scores.rows.map((r) => ({ ...r, balanceCents: ledgerReady ? balance.get(r.producerUserId) ?? 0 : null }));
  return {
    period,
    seats: { used: Number(seatsUsed ?? 0), max: seatLimit ?? null },
    producers: rows,
    payableOutCents: ledgerReady ? rows.reduce((s, r) => s + Math.max(r.balanceCents ?? 0, 0), 0) : null,
    negativeCount: ledgerReady ? rows.filter((r) => (r.balanceCents ?? 0) < 0).length : null,
    overrideCents,
    alerts,
    minSample: scores.minSample,
    ledgerReady,
  };
}
