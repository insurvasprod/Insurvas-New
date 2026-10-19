import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getPlanAudience } from "./audience";
import { SEAT_BANDS, bandFor } from "./constants";

/**
 * AG-0.12 · what SA-5's tenant record shows for an agency instead of a per-seat line: the seat band (from the
 * plan's seat limit — 50, 150 or none), and how many producers the agency has (offboarded ones excluded). Null
 * for a solo tenant, whose record is unchanged.
 */
export async function agencySeatSummary(tenantId: string, maxSeats: number | null | undefined): Promise<{ bandLabel: string; producers: number } | null> {
  if ((await getPlanAudience(tenantId)) !== "agency") return null;
  const band = maxSeats === null || maxSeats === undefined ? SEAT_BANDS[SEAT_BANDS.length - 1] : bandFor(maxSeats) ?? SEAT_BANDS[0];
  const { count } = await getSupabaseServiceClient()
    .from("producer" as never)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .neq("status", "offboarded");
  return { bandLabel: band.label, producers: count ?? 0 };
}
