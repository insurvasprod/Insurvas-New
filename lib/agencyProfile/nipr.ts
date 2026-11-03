import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { NpnCheckStatus } from "./types";

/**
 * "Verified against NIPR 3 March 2026." — where that check plugs in.
 *
 * NIPR's Producer Database (PDB) is the source of truth for an NPN, and looking a number up needs a
 * NIPR subscription agreement and PDB web-service credentials, billed per lookup. Insurvas has
 * neither, so no client is configured and nothing here pretends otherwise: getNiprClient() returns
 * null, the agency profile says "Not verified against NIPR yet", and npn_verified_at stays null.
 *
 * Everything around the call is in place:
 *   · the outcome columns and the recording function (migration 20260924220000:
 *     npn_check_status, npn_checked_at, record_agency_npn_check — which ignores a result for a
 *     number the owner has since changed);
 *   · checkAgencyNpn(), called after every agency-profile save that sets or changes the NPN;
 *   · the screen's states for verified, not found, a name mismatch and an unreachable NIPR.
 *
 * To connect it, implement NiprClient against the PDB entity/producer lookup with the credentials
 * NIPR issues (read from the server environment, e.g. NIPR_PDB_USERNAME / NIPR_PDB_PASSWORD), and
 * return it from getNiprClient().
 */
export type NiprLookup = { status: Exclude<NpnCheckStatus, "error"> };

export interface NiprClient {
  /** Looks the NPN up in the PDB and compares the name it is registered to with `legalName`. */
  lookupNpn(npn: string, legalName: string): Promise<NiprLookup>;
}

export function getNiprClient(): NiprClient | null {
  return null;
}

export function niprConfigured(): boolean {
  return getNiprClient() !== null;
}

/**
 * Runs one lookup and records it. Never throws: a failed lookup is recorded as `error`, which leaves
 * an earlier verification standing. Returns what happened, for logging.
 */
export async function checkAgencyNpn(tenantId: string, npn: string, legalName: string): Promise<NpnCheckStatus | "not_configured"> {
  const client = getNiprClient();
  if (!client) return "not_configured";
  let status: NpnCheckStatus;
  try {
    status = (await client.lookupNpn(npn, legalName)).status;
  } catch (error) {
    console.error("[agency-profile] NIPR lookup failed", error instanceof Error ? error.message : error);
    status = "error";
  }
  const { error } = await getSupabaseServiceClient().rpc("record_agency_npn_check" as never, { p_tenant_id: tenantId, p_npn: npn, p_status: status, p_checked_at: new Date().toISOString() } as never);
  if (error) console.error("[agency-profile] could not record the NIPR check", error.message);
  return status;
}
