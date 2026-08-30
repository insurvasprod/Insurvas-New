import "server-only";

import { AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  auditSection,
  CONFIGURATION_AUDIT_ACTIONS,
  type ConfigurationSectionSlug,
} from "./sections";

export type RecentConfigurationChange = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string | null;
  section: ConfigurationSectionSlug;
};

type AuditRow = {
  id: string;
  ts: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
};

/**
 * The strip deliberately reads audit_log directly. There is no configuration-history table to
 * keep in sync, and the role-filtered section list prevents a billing admin from seeing payment
 * infrastructure changes while still allowing them to see offer changes.
 */
export async function getRecentConfigurationChanges(
  allowedSections: readonly ConfigurationSectionSlug[],
): Promise<RecentConfigurationChange[]> {
  const allowedActions = CONFIGURATION_AUDIT_ACTIONS.filter((action) => {
    const section = auditSection(action);
    return section !== null && allowedSections.includes(section);
  });

  if (allowedActions.length === 0) return [];

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, ts, actor_id, action, target_type, target_id")
    .in("action", [...allowedActions])
    .order("ts", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[configuration] could not load recent changes", error);
    return [];
  }

  const rows = (data ?? []) as AuditRow[];
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const { data: actors } = actorIds.length
    ? await supabase.from("admin_users").select("id, name, email").in("id", actorIds)
    : { data: [] };
  const actorById = new Map((actors ?? []).map((actor) => [actor.id, actor.name || actor.email]));

  return rows.flatMap((row) => {
    const section = auditSection(row.action);
    if (!section) return [];

    return [
      {
        id: row.id,
        ts: row.ts,
        actor: row.actor_id ? actorById.get(row.actor_id) ?? "Unknown admin" : "System",
        action: AUDIT_ACTION_LABELS[row.action as AuditAction] ?? row.action,
        target: row.target_type && row.target_id ? `${row.target_type}:${row.target_id}` : null,
        section,
      },
    ];
  });
}
