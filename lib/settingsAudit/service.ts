import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { SETTINGS_CHANGE_TYPES, type SettingsAuditEntry, type SettingsAuditFilter, type SettingsChangeType } from "./constants";

/**
 * LA-8.8 · reading the settings audit log (20261015360000). Read only: there is no write here, and
 * the table refuses UPDATE and DELETE from every role. The hubs write it from the database.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

export class SettingsAuditPendingError extends Error {
  constructor() {
    super("The settings history is not available yet: migration 20261015360000 has not been applied.");
    this.name = "SettingsAuditPendingError";
  }
}
const isMissing = (error: { code?: string; message?: string }) => error.code === "42P01" || error.code === "PGRST205" || /settings_audit/.test(error.message ?? "") && /does not exist|schema cache/.test(error.message ?? "");

type Row = { id: string; section_key: string; setting_key: string; setting_label: string; old_value: string | null; new_value: string | null; change_type: string; actor_user_id: string | null; actor_role: string | null; occurred_at: string; source: string; reason: string | null };
const COLUMNS = "id, section_key, setting_key, setting_label, old_value, new_value, change_type, actor_user_id, actor_role, occurred_at, source, reason";

async function names(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const users = await db().from("users").select("id, name").in("id", unique);
  return new Map(((users.data ?? []) as { id: string; name: string | null }[]).filter((u) => u.name).map((u) => [u.id, u.name as string]));
}

function toEntry(row: Row, who: Map<string, string>): SettingsAuditEntry {
  return {
    id: row.id,
    sectionKey: row.section_key,
    settingKey: row.setting_key,
    settingLabel: row.setting_label,
    oldValue: row.old_value,
    newValue: row.new_value,
    changeType: ((SETTINGS_CHANGE_TYPES as readonly string[]).includes(row.change_type) ? row.change_type : "update") as SettingsChangeType,
    actorUserId: row.actor_user_id,
    actorName: row.actor_user_id ? who.get(row.actor_user_id) ?? null : null,
    actorRole: row.actor_role,
    occurredAt: row.occurred_at,
    source: row.source as SettingsAuditEntry["source"],
    reason: row.reason,
  };
}

export const SETTINGS_AUDIT_MAX_ROWS = 5000;

/** Newest first. `onlyActor` pins the log to one person (a non-admin's own entries). */
export async function listSettingsAudit(tenantId: string, filter: SettingsAuditFilter, options: { onlyActor?: string; limit?: number } = {}): Promise<SettingsAuditEntry[]> {
  let query = db().from("settings_audit").select(COLUMNS).eq("tenant_id", tenantId);
  const actor = options.onlyActor ?? filter.actor ?? null;
  if (actor) query = query.eq("actor_user_id", actor);
  if (filter.section) query = query.eq("section_key", filter.section);
  if (filter.changeType) query = query.eq("change_type", filter.changeType);
  if (filter.from) query = query.gte("occurred_at", `${filter.from}T00:00:00Z`);
  if (filter.to) query = query.lt("occurred_at", new Date(Date.parse(`${filter.to}T00:00:00Z`) + 86_400_000).toISOString());
  const result = await query.order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(Math.min(options.limit ?? 1000, SETTINGS_AUDIT_MAX_ROWS));
  if (result.error) {
    if (isMissing(result.error)) throw new SettingsAuditPendingError();
    throw new Error(`Could not read the settings history: ${result.error.message}`);
  }
  const rows = (result.data ?? []) as Row[];
  const who = await names(rows.map((row) => row.actor_user_id));
  return rows.map((row) => toEntry(row, who));
}

/** The newest change in a section: the "last changed by X on Y" line. Null when there is none. */
export async function lastSettingsChange(tenantId: string, sectionKey: string): Promise<SettingsAuditEntry | null> {
  const result = await db().from("settings_audit").select(COLUMNS).eq("tenant_id", tenantId).eq("section_key", sectionKey).order("occurred_at", { ascending: false }).limit(1);
  if (result.error) {
    if (isMissing(result.error)) return null;
    throw new Error(`Could not read the settings history: ${result.error.message}`);
  }
  const row = ((result.data ?? []) as Row[])[0];
  if (!row) return null;
  return toEntry(row, await names([row.actor_user_id]));
}

/** The people who appear in the log, for the "changed by" filter. */
export async function settingsAuditActors(tenantId: string): Promise<Array<{ id: string; name: string }>> {
  const members = await db().from("tenant_users").select("user_id, users!tenant_users_user_id_fkey(name)").eq("tenant_id", tenantId);
  return ((members.data ?? []) as Array<{ user_id: string; users: { name: string | null } | null }>).filter((m) => m.users?.name).map((m) => ({ id: m.user_id, name: m.users?.name as string })).sort((a, b) => a.name.localeCompare(b.name));
}
