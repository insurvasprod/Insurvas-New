import "server-only";

import type { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { LooseDb, LooseError } from "@/lib/supabase/loose";
import { isChannelRole, sortMembers, type ChannelMember } from "./groupRules";

/**
 * Reads for group roles and each person's conversation state (20261028220000). Until that migration
 * is applied the columns and the table are missing: members then read as before (whoever made the
 * conversation is its owner, everyone else a member) and nobody has a pin, archive or delete.
 */
type Service = ReturnType<typeof getSupabaseServiceClient>;
const loose = (supabase: Service) => supabase as unknown as LooseDb;

export function isMissingSchema(error: LooseError | null | undefined) {
  if (!error) return false;
  return ["42703", "42P01", "PGRST204", "PGRST205"].includes(error.code ?? "") || /does not exist|could not find the (table|column)/i.test(error.message);
}

export class GroupsNotLiveError extends Error {
  constructor() {
    super("Group roles and conversation pins are waiting on a database update. Ask your admin to apply it.");
    this.name = "GroupsNotLiveError";
  }
}

type MemberRow = { channel_id: string; user_id: string; role?: string; can_add_members?: boolean; created_at: string; removed_at?: string | null };

/** The current members of each direct or group channel, owner first. */
export async function membersOf(supabase: Service, tenantId: string, channels: Array<{ id: string; created_by: string | null }>): Promise<Map<string, ChannelMember[]>> {
  const result = new Map<string, ChannelMember[]>();
  if (!channels.length) return result;
  const ids = channels.map((channel) => channel.id);
  let rows: MemberRow[];
  const full = await loose(supabase).from<MemberRow[]>("partner_channel_members").select("channel_id, user_id, role, can_add_members, created_at, removed_at").eq("tenant_id", tenantId).in("channel_id", ids);
  if (full.error && isMissingSchema(full.error)) {
    const creators = new Map(channels.map((channel) => [channel.id, channel.created_by]));
    const legacy = await loose(supabase).from<MemberRow[]>("partner_channel_members").select("channel_id, user_id, created_at").eq("tenant_id", tenantId).in("channel_id", ids);
    if (legacy.error) throw new Error(`Could not load channel members: ${legacy.error.message}`);
    rows = (legacy.data ?? []).map((row) => ({ ...row, role: creators.get(row.channel_id) === row.user_id ? "owner" : "member" }));
  } else if (full.error) {
    throw new Error(`Could not load channel members: ${full.error.message}`);
  } else {
    rows = full.data ?? [];
  }
  for (const row of rows) {
    if (row.removed_at) continue;
    const member: ChannelMember = { userId: row.user_id, role: isChannelRole(row.role) ? row.role : "member", canAddMembers: Boolean(row.can_add_members), addedAt: row.created_at };
    result.set(row.channel_id, [...(result.get(row.channel_id) ?? []), member]);
  }
  for (const [id, members] of result) result.set(id, sortMembers(members));
  return result;
}

export type ConversationState = { pinnedAt: string | null; archivedAt: string | null; deletedAt: string | null };
type StateRow = { channel_id: string; pinned_at: string | null; archived_at: string | null; deleted_at: string | null };

/** This person's pin, archive and delete for each channel. Empty while the table is missing. */
export async function conversationStates(supabase: Service, tenantId: string, userId: string, channelIds: string[]): Promise<Map<string, ConversationState>> {
  const result = new Map<string, ConversationState>();
  if (!channelIds.length) return result;
  const { data, error } = await loose(supabase).from<StateRow[]>("partner_channel_user_state").select("channel_id, pinned_at, archived_at, deleted_at").eq("tenant_id", tenantId).eq("user_id", userId).in("channel_id", channelIds);
  if (error) {
    if (!isMissingSchema(error)) console.error("[partner-chat] conversation state read failed", error);
    return result;
  }
  for (const row of data ?? []) result.set(row.channel_id, { pinnedAt: row.pinned_at, archivedAt: row.archived_at, deletedAt: row.deleted_at });
  return result;
}

/** Pin, archive or delete (hide) a conversation for this person only. */
export async function writeConversationState(supabase: Service, input: { tenantId: string; channelId: string; userId: string; patch: Partial<{ pinned_at: string | null; archived_at: string | null; deleted_at: string | null }> }) {
  const { error } = await loose(supabase).from("partner_channel_user_state").upsert({ channel_id: input.channelId, tenant_id: input.tenantId, user_id: input.userId, ...input.patch, updated_at: new Date().toISOString() }, { onConflict: "channel_id,user_id" });
  if (error && isMissingSchema(error)) throw new GroupsNotLiveError();
  if (error) throw new Error(`Could not update the conversation: ${error.message}`);
}

/** Group membership writes; a missing column means the migration is not applied yet. */
export async function writeMembers(supabase: Service, write: (db: LooseDb) => PromiseLike<{ error: LooseError | null }>) {
  const { error } = await write(loose(supabase));
  if (error && isMissingSchema(error)) throw new GroupsNotLiveError();
  if (error) throw new Error(`Could not update the group: ${error.message}`);
}
