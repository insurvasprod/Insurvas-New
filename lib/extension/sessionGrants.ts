import "server-only";

import { db, isMissingSchema, rows } from "@/lib/applications/db";

/**
 * LA-3.12 · an extension grant never outlives the sign-in that opened it. When sessions end — sign
 * out, "end this session", a password, email or two-factor change, a workspace switch — the grants
 * bound to those sessions are revoked, and so is any grant with no session recorded (opened before
 * grants carried one, or from a cookie issued before sessions were rows): with nothing to tie it to
 * a live sign-in, it ends with the person's sign-in rather than running on for its hour.
 *
 * authenticateExtension also checks the bound session on every request, so a grant whose revoke was
 * missed here still stops working the moment its session does.
 */
export async function revokeExtensionGrantsForSessionEnd(input: { userId: string; sessionId?: string | null; except?: string | null; reason: string }): Promise<number> {
  const now = new Date().toISOString();
  const reason = `session_ended:${input.reason}`.slice(0, 200);
  const base = () => db().from("tenant_extension_grants").update({ revoked_at: now, revoked_reason: reason }).eq("user_id", input.userId).is("revoked_at", null);
  let query = base();
  if (input.sessionId) query = query.or(`session_id.eq.${input.sessionId},session_id.is.null`);
  else if (input.except) query = query.or(`session_id.neq.${input.except},session_id.is.null`);
  let result = await query.select("id, tenant_id, carrier_origin");
  // Before 20261015570000 grants carry no session: every live grant of this person ends.
  if (result.error && isMissingSchema(result.error) && /session_id/.test(result.error.message ?? "")) result = await base().select("id, tenant_id, carrier_origin");
  if (result.error) {
    if (isMissingSchema(result.error)) return 0;
    throw new Error(`Could not revoke the extension grants: ${result.error.message}`);
  }
  const revoked = rows<{ id: string; tenant_id: string; carrier_origin: string }>(result.data);
  if (revoked.length) {
    const events = await db().from("tenant_extension_events").insert(revoked.map((g) => ({ tenant_id: g.tenant_id, grant_id: g.id, kind: "revoked", origin: g.carrier_origin })));
    if (events.error) console.error("[extension] revoke event log insert failed", events.error.message);
  }
  return revoked.length;
}
