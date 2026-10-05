import "server-only";

import type { Actor } from "@/lib/applications/http";
import { ApplicationError, db, isMissingSchema, SchemaPendingError, type DbError } from "@/lib/applications/db";
import type { AuditAction } from "@/lib/audit/actions";
import { audit } from "@/lib/audit/log";
import { settingsAuditDiff } from "./editing";
import { resolveSalesSettings, type SalesSettings } from "./schema";

/**
 * LA-3.17 · the tenant's Sales settings document (tenant_sales_settings, one row per tenant),
 * validated by `salesSettingsSchema` and read back through `resolveSalesSettings`, so a missing row
 * or a missing key is the documented default. Owners write; owners and producers read (the payment
 * step reads `draftBufferDays`, the quote and QA checks read the band and the appointment rule).
 *
 * Every change writes one audit row with the old and new value of each key that changed.
 */

/** The audit actions Settings › Sales writes, each registered in lib/audit/actions.ts. */
export const SALES_SETTINGS_AUDIT_ACTIONS = {
  "tenant.sales_settings_updated": "Sales settings changed",
  "tenant.application_disclosure_created": "Disclosure draft created",
  "tenant.application_disclosure_updated": "Disclosure draft edited",
  "tenant.application_disclosure_published": "Disclosure version published",
  "tenant.application_disclosure_discarded": "Disclosure draft discarded",
  "tenant.application_disclosure_retired": "Disclosure version retired",
  "tenant.application_disclosure_attached": "Disclosure PDF attached",
  "tenant.application_stage_map_updated": "Application pipeline sync changed",
} as const satisfies Partial<Record<AuditAction, string>>;
export type SalesSettingsAuditAction = keyof typeof SALES_SETTINGS_AUDIT_ACTIONS;

export async function auditSales(actor: Actor, action: SalesSettingsAuditAction, targetType: string, targetId: string, metadata: Record<string, unknown>) {
  await audit({ actorType: "tenant", actorId: actor.userId, action, targetType, targetId, metadata, request: actor.request });
}

export type SalesSettingsView = {
  settings: SalesSettings;
  /** False while the tenant has never saved: everything shown is a default. */
  stored: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  /** The person looking — the welcome-pack preview signs with their name and phone. */
  me: { name: string; phone: string | null; email: string };
  canEdit: boolean;
};

type Row = { settings: unknown; updated_at: string; updated_by: string | null };

function fail(error: DbError, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError("Sales settings");
  throw new ApplicationError("SALES_SETTINGS_UNAVAILABLE", `${what}: ${error?.message ?? "unknown error"}`, 500);
}

async function currentRow(tenantId: string): Promise<Row | null> {
  const { data, error } = await db().from("tenant_sales_settings").select("settings, updated_at, updated_by").eq("tenant_id", tenantId).maybeSingle();
  if (error) fail(error, "Could not load the sales settings");
  return (data as Row | null) ?? null;
}

/** For any feature that consumes a setting: the resolved document, defaults where nothing is stored. */
export async function salesSettingsFor(tenantId: string): Promise<SalesSettings> {
  const { data, error } = await db().from("tenant_sales_settings").select("settings").eq("tenant_id", tenantId).maybeSingle();
  if (error && !isMissingSchema(error)) fail(error, "Could not load the sales settings");
  return resolveSalesSettings(data?.settings);
}

export async function readSalesSettings(actor: Actor): Promise<SalesSettingsView> {
  const client = db();
  const [row, me] = await Promise.all([
    currentRow(actor.tenantId),
    client.from("users").select("name, phone, email").eq("id", actor.userId).maybeSingle(),
  ]);
  let updatedBy: string | null = null;
  if (row?.updated_by) {
    const who = await client.from("users").select("name").eq("id", row.updated_by).maybeSingle();
    updatedBy = (who.data?.name as string | undefined) ?? null;
  }
  return {
    settings: resolveSalesSettings(row?.settings),
    stored: Boolean(row),
    updatedAt: row?.updated_at ?? null,
    updatedBy,
    me: { name: me.data?.name ?? "", phone: me.data?.phone ?? null, email: me.data?.email ?? "" },
    canEdit: actor.role === "owner",
  };
}

/**
 * Replaces the whole document (already validated by the route). `expectedUpdatedAt` is what the
 * editor loaded: if someone saved since, the save is refused rather than overwriting their change.
 */
export async function saveSalesSettings(actor: Actor, next: SalesSettings, expectedUpdatedAt: string | null | undefined): Promise<SalesSettingsView> {
  const row = await currentRow(actor.tenantId);
  if (expectedUpdatedAt !== undefined && (row?.updated_at ?? null) !== expectedUpdatedAt) {
    throw new ApplicationError("SALES_SETTINGS_CHANGED", "Someone else saved these settings a moment ago. Refresh to see their change, then make yours.", 409);
  }
  const before = resolveSalesSettings(row?.settings);
  const diff = settingsAuditDiff(before, next);
  if (diff.changed.length === 0 && row) return readSalesSettings(actor);

  const { error } = await db().from("tenant_sales_settings").upsert(
    { tenant_id: actor.tenantId, settings: next, updated_by: actor.userId, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id" },
  );
  if (error) fail(error, "Could not save the sales settings");
  await auditSales(actor, "tenant.sales_settings_updated", "tenant_sales_settings", actor.tenantId, diff);
  return readSalesSettings(actor);
}
