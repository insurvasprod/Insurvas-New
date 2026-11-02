/**
 * Who a partner admin's team is — the one place the portal decides it.
 *
 * A team is the members whose `partner_users.partner_admin_user_id` points at that admin: the
 * reporting line the agency already sets in its Partners panel (migration 20260915190000, with a
 * trigger that forbids self-assignment and requires the target to be a `partner_admin` in the same
 * organisation). It has been a live, managed concept that governed nothing anyone could see.
 *
 * ## Where this rule applies, and where it does not
 *
 * **Daily deal flow only** (owner, 2 Nov). Pipeline, the lead record, the CSV export, Overview and
 * Team review keep showing a `partner_admin` the whole partner organisation, which is
 * `lib/partnerLeads/scope.ts`' job and is deliberately left alone.
 *
 * So an admin will see a lead on Pipeline that is absent from Daily deal flow. That is the
 * decision, not a bug. An earlier attempt applied this rule across the portal by editing
 * `scope.ts`, which rescoped five surfaces at once; it was reverted. Consume this module from the
 * deal-flow service and nowhere else until somebody decides otherwise — and if that day comes,
 * Pipeline needs a migration, because its read model takes one closer id in SQL.
 *
 * ## Why it is its own module
 *
 * The same reason `scope.ts` is: this decides who sees whose leads, and a decision that cannot be
 * unit-tested is a decision nobody can check. Nothing here touches the database or imports server
 * code, so `team.test.mjs` asserts what it promises rather than what one query happens to do.
 */
import type { PartnerRole } from "./roles.ts";

/** A `partner_users` row, as far as the team rule is concerned. */
export type PartnerMember = {
  user_id: string;
  role: PartnerRole;
  /** The admin this member reports to; null for an admin, and for a member nobody has assigned. */
  partner_admin_user_id: string | null;
};

/** The signed-in person, from the session — never from a request. */
export type PartnerViewer = { userId: string; role: PartnerRole };

/**
 * The `created_by` ids this viewer may see, as a list to filter on.
 *
 * - **A partner user is their own team.** Their colleagues are not theirs to see.
 * - **An admin is the root of their team, never of another's.** The trigger keeps
 *   `partner_admin_user_id` null on every admin row, so there is no chain to walk and no cycle to
 *   guard: admins are peers. Admin A therefore does not see admin B's own submissions, which is
 *   the owner's intent — "their team, and their own" — not an oversight.
 * - **An unassigned member belongs to no admin** (owner, 1 Nov, reaffirmed 2 Nov). On this page
 *   their deals reach no admin at all. They remain visible to admins everywhere else in the
 *   portal, which is why this gap did not warrant warning the agency.
 * - **The list always holds the viewer, so it is never empty.** A caller turns it into
 *   `.in("agent_leads.created_by", ids)`, where `[]` matches nothing — or worse, invites a future
 *   caller to read "empty" as "no filter" and open the organisation. Asserted in the tests.
 *
 * `members` is required rather than optional: an admin handed no members would silently narrow to
 * themselves, which fails closed but looks like a data problem instead of the missing argument it
 * is.
 */
export function visibleSubmitters(viewer: PartnerViewer, members: readonly PartnerMember[]): string[] {
  const ids = [viewer.userId];
  if (viewer.role !== "partner_admin") return ids;
  for (const member of members) {
    if (member.partner_admin_user_id !== viewer.userId) continue;
    if (!ids.includes(member.user_id)) ids.push(member.user_id);
  }
  return ids;
}

/**
 * One person out of the list, when the request asked for one.
 *
 * The submitter filter is a convenience for an admin looking at one of their own people, never a
 * way to widen: an id that is not already in the list leaves the list as it was. Asking for
 * somebody you may not see gets you your own view — not theirs, and not an error, because an
 * error would confirm that the id exists.
 */
export function narrowTo(ids: readonly string[], requestedId?: string | null): string[] {
  const requested = typeof requestedId === "string" ? requestedId.trim() : "";
  if (!requested) return [...ids];
  return ids.includes(requested) ? [requested] : [...ids];
}
