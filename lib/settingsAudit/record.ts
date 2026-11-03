import "server-only";

// LA-8.8 · the app-side writer for the settings history, for the screens that save through a route
// rather than a hub table the 20261015360000 triggers already watch (owner decision 2026-10-15: the
// LA-8 screens record too — Business identity, Team & access, Plan & billing, API keys & webhooks,
// Calling windows, pipelines and dispositions).
//
// Every row goes through the database's one writer, record_settings_audit(), so the role held at the
// time is read the same way, an unchanged value writes nothing, and the table stays append-only.
// Best effort by design: the setting is already saved when this runs, and a history row that could not
// be written must not turn a saved change into an error on screen. A failure is logged loudly.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { SettingsChangeType } from "./constants";

export type SettingsChange = {
  /** Stable within the section: "plan", "api_key:<id>", "member:<user id>.role". */
  key: string;
  /** What a person reads: "Plan", "API key “Zapier”", "Dana Reed — role". */
  label: string;
  from: unknown;
  to: unknown;
  changeType?: SettingsChangeType;
};

type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }> };

const asJson = (value: unknown) => (value === undefined || value === "" ? null : value);

export async function recordSettingsChanges(input: {
  tenantId: string;
  actorId: string | null;
  /** The LA-8.1 registry id of the section, so the history links back to it. */
  section: string;
  changes: readonly SettingsChange[];
  source?: "ui" | "api";
  reason?: string | null;
}): Promise<void> {
  const db = getSupabaseServiceClient() as unknown as Rpc;
  for (const change of input.changes) {
    const { error } = await db.rpc("record_settings_audit", {
      p_tenant_id: input.tenantId,
      p_section_key: input.section,
      p_setting_key: change.key,
      p_setting_label: change.label,
      p_old: asJson(change.from),
      p_new: asJson(change.to),
      p_actor: input.actorId,
      p_source: input.source ?? "ui",
      p_reason: input.reason ?? null,
      p_change_type: change.changeType ?? null,
    });
    if (error) console.error("[settings-audit] could not record", input.section, change.key, error.message);
  }
}

/** The fields of a saved record that changed, as history rows. `mask` hides a value (a tax ID). */
export function changedFields<T extends Record<string, unknown>>(
  before: T | null,
  after: T,
  fields: readonly { key: keyof T & string; label: string; mask?: (value: unknown) => unknown }[],
): SettingsChange[] {
  return fields.flatMap(({ key, label, mask }) => {
    const from = before ? before[key] ?? null : null;
    const to = after[key] ?? null;
    if (JSON.stringify(from) === JSON.stringify(to)) return [];
    return [{ key, label, from: mask ? mask(from) : from, to: mask ? mask(to) : to }];
  });
}

/** A teammate as the history names them, and the two values Team & access edits that it diffs. */
export async function memberSnapshot(tenantId: string, userId: string): Promise<{ name: string; timezone: string | null; states: string[] }> {
  const db = getSupabaseServiceClient() as unknown as {
    from(table: string): { select(columns: string): { eq(column: string, value: string): { eq(column: string, value: string): PromiseLike<{ data: unknown[] | null }> } & PromiseLike<{ data: unknown[] | null }> } };
  };
  const [user, membership, states] = await Promise.all([
    db.from("users").select("name, email").eq("id", userId),
    db.from("tenant_users").select("timezone").eq("tenant_id", tenantId).eq("user_id", userId),
    db.from("tenant_user_licensed_states").select("state").eq("tenant_id", tenantId).eq("user_id", userId),
  ]);
  const person = (user.data?.[0] ?? null) as { name: string | null; email: string } | null;
  return {
    name: person?.name?.trim() || person?.email || "A teammate",
    timezone: ((membership.data?.[0] ?? null) as { timezone: string | null } | null)?.timezone ?? null,
    states: ((states.data ?? []) as { state: string }[]).map((row) => row.state).sort(),
  };
}
