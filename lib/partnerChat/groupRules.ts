/**
 * Who may do what in a group conversation (owner, 2026-10-28). Pure, so the route, the service and
 * the screen read the same rules.
 *
 *   owner  - made the group; everything an admin does, makes and unmakes admins, cannot be removed.
 *   admin  - adds and removes members and viewers, changes their roles, renames the group.
 *   member - writes; adds people only when the owner or an admin turned "can add people" on.
 *   viewer - reads only.
 */
export const CHANNEL_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type ChannelRole = (typeof CHANNEL_ROLES)[number];
export type ChannelMember = { userId: string; role: ChannelRole; canAddMembers: boolean; addedAt: string };

export const ROLE_LABEL: Record<ChannelRole, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Read only" };
export const ROLE_HINT: Record<ChannelRole, string> = {
  owner: "Made the group. Can do everything.",
  admin: "Adds and removes people, changes roles, renames the group.",
  member: "Reads and writes.",
  viewer: "Reads only.",
};

export function isChannelRole(value: unknown): value is ChannelRole {
  return typeof value === "string" && (CHANNEL_ROLES as readonly string[]).includes(value);
}

/** Owner first, then admins, members and viewers; each by when they joined. */
export function sortMembers(members: ChannelMember[]) {
  return [...members].sort((a, b) => CHANNEL_ROLES.indexOf(a.role) - CHANNEL_ROLES.indexOf(b.role) || a.addedAt.localeCompare(b.addedAt));
}

export const canManage = (actor: ChannelMember | undefined) => actor?.role === "owner" || actor?.role === "admin";
export const canPost = (actor: ChannelMember | undefined) => Boolean(actor) && actor?.role !== "viewer";
export const canAddPeople = (actor: ChannelMember | undefined) => canManage(actor) || (actor?.role === "member" && actor.canAddMembers);

/** Removing someone else, or leaving (yourself). The owner leaves through `nextOwner`, never by removal. */
export function canRemove(actor: ChannelMember | undefined, target: ChannelMember) {
  if (!actor || target.role === "owner") return false;
  if (actor.userId === target.userId) return true;
  if (!canManage(actor)) return false;
  return target.role !== "admin" || actor.role === "owner";
}

/** Changing someone's role or their "can add people" switch. Only the owner makes or unmakes admins. */
export function canChangeRole(actor: ChannelMember | undefined, target: ChannelMember, next: ChannelRole) {
  if (!actor || !canManage(actor) || actor.userId === target.userId) return false;
  if (target.role === "owner" || next === "owner") return false;
  if (actor.role === "owner") return true;
  return target.role !== "admin" && next !== "admin";
}

/** When the owner leaves: the longest-standing admin takes over, else the longest-standing member, else a viewer. */
export function nextOwner(members: ChannelMember[], leavingId: string) {
  return sortMembers(members.filter((member) => member.userId !== leavingId && member.role !== "owner"))[0] ?? null;
}
