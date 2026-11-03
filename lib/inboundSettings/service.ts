import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Settings › Inbound transfers (redesign 2026-10-25): the per-workspace choices that sit beside the
 * waiting-time ladder. No row means the defaults, which are exactly the behaviour before the
 * setting existed. Migration 20261025100000 adds the table; until it is applied every read returns
 * the defaults and says so (`ready: false`), and nothing that honours a setting changes behaviour.
 */
export type InboundSettings = {
  alertNewTransfer: boolean;
  emailOwnersOnEscalation: boolean;
  handoffTimeoutSeconds: number;
  licensedOnly: boolean;
  skipOnBreak: boolean;
};

export const INBOUND_DEFAULTS: InboundSettings = {
  alertNewTransfer: true,
  emailOwnersOnEscalation: true,
  handoffTimeoutSeconds: 30,
  licensedOnly: false,
  skipOnBreak: false,
};

/** The same range offer_buffer_handoff enforces (INVALID_HANDOFF_TIMEOUT). */
export const HANDOFF_TIMEOUT_RANGE = { min: 5, max: 300 } as const;

type Row = { alert_new_transfer: boolean; email_owners_on_escalation: boolean; handoff_timeout_seconds: number; licensed_only: boolean; skip_on_break: boolean; updated_at: string };

// The generated types are refreshed from the live schema separately; the new table stays local here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

function isMissingTable(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /tenant_inbound_settings/.test(error.message ?? "")));
}

function fromRow(row: Row): InboundSettings {
  return {
    alertNewTransfer: row.alert_new_transfer,
    emailOwnersOnEscalation: row.email_owners_on_escalation,
    handoffTimeoutSeconds: row.handoff_timeout_seconds,
    licensedOnly: row.licensed_only,
    skipOnBreak: row.skip_on_break,
  };
}

export async function readInboundSettings(tenantId: string): Promise<{ settings: InboundSettings; ready: boolean; updatedAt: string | null }> {
  const { data, error } = await db().from("tenant_inbound_settings").select("alert_new_transfer, email_owners_on_escalation, handoff_timeout_seconds, licensed_only, skip_on_break, updated_at").eq("tenant_id", tenantId).maybeSingle();
  if (isMissingTable(error)) return { settings: INBOUND_DEFAULTS, ready: false, updatedAt: null };
  if (error) throw new Error(`Could not load the inbound settings: ${error.message}`);
  return { settings: data ? fromRow(data as Row) : INBOUND_DEFAULTS, ready: true, updatedAt: (data as Row | null)?.updated_at ?? null };
}

/** For the places that honour one setting: never throws, falls back to today's behaviour. */
export async function inboundSettingsOrDefaults(tenantId: string): Promise<InboundSettings> {
  try {
    return (await readInboundSettings(tenantId)).settings;
  } catch (error) {
    console.error("[inboundSettings] read failed; using the defaults", error);
    return INBOUND_DEFAULTS;
  }
}

export class InboundSettingsError extends Error {
  constructor(public readonly code: "role_not_allowed" | "invalid" | "schema_pending" | "failed", message: string) { super(message); }
}

export async function updateInboundSettings(params: { tenantId: string; actorId: string; settings: InboundSettings }): Promise<InboundSettings> {
  const { settings } = params;
  const { data, error } = await db().rpc("update_tenant_inbound_settings", {
    p_tenant_id: params.tenantId,
    p_actor: params.actorId,
    p_alert_new_transfer: settings.alertNewTransfer,
    p_email_owners_on_escalation: settings.emailOwnersOnEscalation,
    p_handoff_timeout_seconds: settings.handoffTimeoutSeconds,
    p_licensed_only: settings.licensedOnly,
    p_skip_on_break: settings.skipOnBreak,
  });
  if (error) {
    if (error.message === "ROLE_NOT_ALLOWED") throw new InboundSettingsError("role_not_allowed", "Only the account owner can change the inbound settings.");
    if (error.message === "INVALID_INBOUND_SETTINGS") throw new InboundSettingsError("invalid", `The handoff wait has to be between ${HANDOFF_TIMEOUT_RANGE.min} seconds and ${HANDOFF_TIMEOUT_RANGE.max / 60} minutes.`);
    if (error.code === "42883" || error.code === "PGRST202" || isMissingTable(error)) throw new InboundSettingsError("schema_pending", "These settings need a database update that has not been applied yet.");
    throw new InboundSettingsError("failed", `Could not save the inbound settings: ${error.message}`);
  }
  return fromRow(data as Row);
}
