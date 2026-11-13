import "server-only";

import { db, rows } from "@/lib/applications/db";

/**
 * Settings round 8 · the check the grant mint makes (mintGrant in ./grants.ts): is this person barred
 * from opening an extension grant on this carrier's site (tenant_extension_access_block, 20261112310000)?
 * Kept apart from ./accessBlocks.ts, which reads ./grants.ts, so grants.ts can import it without a cycle.
 * False before the table exists, and on a failed read: the mint's own role and feature checks still hold.
 */
export async function extensionBlocked(tenantId: string, userId: string, carrierId: string): Promise<boolean> {
  const result = await db().from("tenant_extension_access_block").select("carrier_id").eq("tenant_id", tenantId).eq("user_id", userId);
  if (result.error) return false;
  return rows<{ carrier_id: string | null }>(result.data).some((row) => row.carrier_id === null || row.carrier_id === carrierId);
}
