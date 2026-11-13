import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a few head counts on tables typed elsewhere
const db = () => getSupabaseServiceClient() as any;

export type SetupCounts = { carriers: number | null; states: number | null; leads: number | null; team: number | null };

/** One exact head count, tenant-filtered; a read that fails is "not known", never zero. */
async function count(read: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  try {
    const { count: total, error } = await read;
    return error ? null : total ?? 0;
  } catch {
    return null;
  }
}

/**
 * What the finished agency has set up, for Get set up's summary (R4 G2, owner 2026-11-13: "a summary worth showing
 * a client"): carriers it sells, states it is appointed in, leads brought in, and people on the team. Head counts
 * only, every one filtered by the tenant (service role, no RLS predicate). Owner only: a member's summary is their
 * own steps.
 */
export async function loadSetupCounts(tenantId: string): Promise<SetupCounts> {
  const [carriers, states, leads, team] = await Promise.all([
    // A carrier counts once whether it was added by its contract row or its "contracted" switch, and not when that
    // switch is off: the same rule as "Add your carriers" (setupProgress.ts hasCarrierReadyToSell).
    (async () => {
      try {
        const [contracts, switches] = await Promise.all([
          db().from("tenant_carriers").select("carrier_id").eq("tenant_id", tenantId).eq("is_active", true).limit(500),
          db().from("tenant_carrier_requirements").select("carrier_id, contracted").eq("tenant_id", tenantId).limit(500),
        ]);
        if (contracts.error || switches.error) return null;
        const rows = (switches.data ?? []) as { carrier_id: string; contracted: boolean | null }[];
        const off = new Set(rows.filter((row) => row.contracted === false).map((row) => row.carrier_id));
        const added = new Set([...((contracts.data ?? []) as { carrier_id: string }[]).map((row) => row.carrier_id), ...rows.filter((row) => row.contracted !== false).map((row) => row.carrier_id)]);
        return [...added].filter((id) => !off.has(id)).length;
      } catch {
        return null;
      }
    })(),
    // Distinct appointed states: the appointments in force, read as their state codes (bounded), counted here.
    (async () => {
      try {
        const { data, error } = await db().from("appointments").select("state").eq("tenant_id", tenantId).is("terminated_at", null).limit(5000);
        if (error) return null;
        return new Set(((data ?? []) as { state: string | null }[]).map((row) => row.state).filter(Boolean)).size;
      } catch {
        return null;
      }
    })(),
    count(db().from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId)),
    count(db().from("tenant_users").select("user_id", { count: "exact", head: true }).eq("tenant_id", tenantId).not("accepted_at", "is", null)),
  ]);
  return { carriers, states, leads, team };
}
