/**
 * Pure: who a partner request is allowed to see, in one place with a name.
 *
 * A partner organisation never sees another's — `partnerId` and `tenantId` come from the signed
 * session, never from the request, and the route rejects a `partner_id` that is not the caller's.
 * Inside an organisation the rule is this file's: a `partner_user` sees only the leads they
 * submitted, a `partner_admin` sees the organisation's.
 *
 * It lived as one ternary in the middle of `listPartnerLeads`. It is extracted so the rule can be
 * tested for what it promises rather than read and hoped about — in particular that a partner user
 * passing someone else's `closer_id` is still scoped to themselves.
 */
import type { PartnerRole } from "../partnerAuth/roles.ts";

export type PartnerLeadAccess = { userId: string; role: PartnerRole };

/**
 * The `created_by` every read on the page is narrowed to, or null for "everyone in this partner".
 *
 * A partner user is pinned to their own id whatever the request asked for: the closer filter is a
 * convenience for an admin, never a way to widen. Null for an admin who asked for nobody in
 * particular — the partner scope still applies, one level up.
 */
export function effectiveCloser(
  access: PartnerLeadAccess | undefined,
  filters: { closerId?: string | null } = {},
): string | null {
  if (access?.role === "partner_user") return access.userId;
  return filters.closerId ?? null;
}

/** Whether a partner user may open this record: only one they submitted themselves. */
export function canSeeLead(
  access: PartnerLeadAccess | undefined,
  lead: { created_by: string | null },
): boolean {
  if (access?.role !== "partner_user") return true;
  return lead.created_by === access.userId;
}
