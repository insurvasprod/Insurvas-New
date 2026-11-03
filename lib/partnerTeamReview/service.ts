import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { teamPulse, type PulseMessage, type TeamPulse } from "./pulse";

// How far back an unanswered conversation still counts as waiting. Older than this, a thread has
// been left, not missed, and counting it forever would make the figure meaningless.
const FOLLOW_UP_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
const MESSAGE_CAP = 10_000;

/**
 * The partner's chat, read for Team pulse. Only this partner's rows: partner_id is on every message
 * and every channel, and both are filtered on it.
 */
export async function partnerTeamPulse(
  tenantId: string,
  partnerId: string,
  window: { from: number; to: number },
  now = Date.now(),
): Promise<TeamPulse & { capped: boolean }> {
  const db = getSupabaseServiceClient();
  const since = new Date(Math.min(window.from, now - FOLLOW_UP_HORIZON_MS)).toISOString();

  const [team, channels, messages] = await Promise.all([
    // Everyone who has been on the team: a deactivated member's past reply was still the team's.
    db.from("partner_users").select("user_id").eq("tenant_id", tenantId).eq("partner_id", partnerId),
    db.from("partner_channels").select("id").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("status", "active"),
    db
      .from("partner_messages")
      .select("channel_id, created_by, created_at, message_kind")
      .eq("tenant_id", tenantId)
      .eq("partner_id", partnerId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(MESSAGE_CAP),
  ]);
  if (team.error) throw new Error(`Could not load the partner team: ${team.error.message}`);
  if (channels.error) throw new Error(`Could not load partner conversations: ${channels.error.message}`);
  if (messages.error) throw new Error(`Could not load partner messages: ${messages.error.message}`);

  const open = new Set((channels.data ?? []).map((row) => row.id as string));
  const rows: PulseMessage[] = (messages.data ?? [])
    .filter((row) => row.channel_id && open.has(row.channel_id as string))
    .map((row) => ({
      channelId: row.channel_id as string,
      createdBy: (row.created_by as string | null) ?? null,
      createdAt: row.created_at as string,
      kind: row.message_kind as string,
    }));
  const teamIds = new Set((team.data ?? []).map((row) => row.user_id as string));
  return { ...teamPulse(rows, teamIds, window), capped: (messages.data ?? []).length >= MESSAGE_CAP };
}
