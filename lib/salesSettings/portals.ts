import "server-only";

import type { Actor } from "@/lib/applications/http";
import { ApplicationError, SchemaPendingError, db, isMissingSchema, rows, type DbError } from "@/lib/applications/db";

import { auditSalesSetting } from "./audit";
import type { PortalAccountBody } from "./portalSchemas";
import { PORTAL_VERIFY_NUDGE_DAYS, type PortalAccountView } from "./views";

/**
 * LA-3.22 · the carrier portal register: one account per carrier, held by the agency. Where to sign
 * in, the shared username, the writing number and the MFA method — never a password. No column,
 * schema, payload or log line here carries one.
 */

// Named column by column so a column added later is never sent without someone choosing to.
const COLUMNS = "id, carrier_id, portal_url, username, writing_number, mfa_type, notes, last_verified_at";

type Row = { id: string; carrier_id: string; portal_url: string; username: string | null; writing_number: string | null; mfa_type: PortalAccountView["mfaType"]; notes: string | null; last_verified_at: string | null };

function fail(error: DbError, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError(what);
  if (error?.code === "23505") throw new ApplicationError("PORTAL_ACCOUNT_EXISTS", "This carrier already has a portal account. Refresh to see it.", 409);
  if (error?.code === "23514") throw new ApplicationError("PORTAL_ACCOUNT_INVALID", "One of the values is outside what a portal account allows.", 400);
  throw new ApplicationError("PORTAL_ACCOUNT_UNAVAILABLE", `${what}: ${error?.message ?? "unknown error"}`, 500);
}

export function needsCheck(lastVerifiedAt: string | null, now = Date.now()) {
  if (!lastVerifiedAt) return true;
  return now - new Date(lastVerifiedAt).getTime() > PORTAL_VERIFY_NUDGE_DAYS * 86_400_000;
}

function view(r: Row): PortalAccountView {
  return { id: r.id, carrierId: r.carrier_id, portalUrl: r.portal_url, username: r.username, writingNumber: r.writing_number, mfaType: r.mfa_type, notes: r.notes, lastVerifiedAt: r.last_verified_at, needsCheck: needsCheck(r.last_verified_at) };
}

const snapshot = (r: Row | null) => (r ? { portal_url: r.portal_url, username: r.username, writing_number: r.writing_number, mfa_type: r.mfa_type, notes: r.notes, last_verified_at: r.last_verified_at } : null);

/** A missing table (20260926101100 not applied) reads as no accounts. */
export async function portalAccountsFor(tenantId: string, carrierIds: string[]): Promise<PortalAccountView[]> {
  if (!carrierIds.length) return [];
  const res = await db().from("tenant_carrier_portal_accounts").select(COLUMNS).eq("tenant_id", tenantId).in("carrier_id", carrierIds);
  if (res.error) {
    if (isMissingSchema(res.error)) return [];
    fail(res.error, "Portal accounts");
  }
  return rows<Row>(res.data).map(view);
}

async function platformCarrierName(carrierId: string) {
  const res = await db().from("carriers").select("name").eq("id", carrierId).is("organization_id", null).maybeSingle();
  if (res.error) fail(res.error, "Portal accounts");
  if (!res.data) throw new ApplicationError("CARRIER_NOT_FOUND", "That carrier is not in the Insurvas library.", 404);
  return res.data.name as string;
}

/** Create or replace the agency's account for one carrier. */
export async function savePortalAccount(actor: Actor, input: PortalAccountBody): Promise<PortalAccountView> {
  const carrierName = await platformCarrierName(input.carrier_id);
  const client = db();
  const prev = await client.from("tenant_carrier_portal_accounts").select(COLUMNS).eq("tenant_id", actor.tenantId).eq("carrier_id", input.carrier_id).maybeSingle();
  if (prev.error) fail(prev.error, "Portal accounts");
  const before = (prev.data as Row | null) ?? null;
  const values = {
    portal_url: input.portal_url,
    username: input.username,
    writing_number: input.writing_number,
    mfa_type: input.mfa_type,
    notes: input.notes,
    // A date picked on the form is that day; an unchanged date keeps its exact time.
    last_verified_at: input.last_verified_on === null ? null
      : before?.last_verified_at?.slice(0, 10) === input.last_verified_on ? before.last_verified_at
        : `${input.last_verified_on}T12:00:00Z`,
    updated_by: actor.userId,
  };
  const write = before
    ? await client.from("tenant_carrier_portal_accounts").update(values).eq("tenant_id", actor.tenantId).eq("id", before.id).select(COLUMNS).single()
    : await client.from("tenant_carrier_portal_accounts").insert({ tenant_id: actor.tenantId, carrier_id: input.carrier_id, ...values }).select(COLUMNS).single();
  if (write.error) fail(write.error, "Portal accounts");
  const after = write.data as Row;
  await auditSalesSetting(actor, "tenant.carrier_portal_account_saved", { type: "carrier_portal_account", id: after.id }, { before: snapshot(before), after: snapshot(after) }, { carrierId: input.carrier_id, carrierName });
  return view(after);
}

/**
 * "Remove account": the agency no longer signs in to this carrier's portal (or set one up by
 * mistake). The row goes; the audit row keeps what it held. The workspace falls back to the
 * carrier's portal origin, as it did before an account existed.
 */
export async function removePortalAccount(actor: Actor, id: string): Promise<{ removed: true; carrierId: string }> {
  const client = db();
  const prev = await client.from("tenant_carrier_portal_accounts").select(COLUMNS).eq("tenant_id", actor.tenantId).eq("id", id).maybeSingle();
  if (prev.error) fail(prev.error, "Portal accounts");
  if (!prev.data) throw new ApplicationError("PORTAL_ACCOUNT_NOT_FOUND", "That portal account could not be found. Refresh to see the current list.", 404);
  const before = prev.data as Row;
  const del = await client.from("tenant_carrier_portal_accounts").delete().eq("tenant_id", actor.tenantId).eq("id", id);
  if (del.error) fail(del.error, "Portal accounts");
  await auditSalesSetting(actor, "tenant.carrier_portal_account_saved", { type: "carrier_portal_account", id }, { before: snapshot(before), after: null }, { carrierId: before.carrier_id, removed: true });
  return { removed: true, carrierId: before.carrier_id };
}

/** "Mark verified": someone signed in today and the writing number still reads right. */
export async function markPortalVerified(actor: Actor, id: string): Promise<PortalAccountView> {
  const client = db();
  const prev = await client.from("tenant_carrier_portal_accounts").select(COLUMNS).eq("tenant_id", actor.tenantId).eq("id", id).maybeSingle();
  if (prev.error) fail(prev.error, "Portal accounts");
  if (!prev.data) throw new ApplicationError("PORTAL_ACCOUNT_NOT_FOUND", "That portal account could not be found.", 404);
  const now = new Date().toISOString();
  const upd = await client.from("tenant_carrier_portal_accounts").update({ last_verified_at: now, updated_by: actor.userId }).eq("tenant_id", actor.tenantId).eq("id", id).select(COLUMNS).single();
  if (upd.error) fail(upd.error, "Portal accounts");
  await auditSalesSetting(actor, "tenant.carrier_portal_account_verified", { type: "carrier_portal_account", id }, { before: { last_verified_at: (prev.data as Row).last_verified_at }, after: { last_verified_at: now } }, { carrierId: (prev.data as Row).carrier_id });
  return view(upd.data as Row);
}
