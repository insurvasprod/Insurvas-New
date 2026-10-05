import "server-only";

import { NextResponse } from "next/server";

import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError, type DbError } from "@/lib/applications/db";
import { getEntitlement } from "@/lib/entitlements/get";
import { effectiveCarrierFacts } from "@/lib/salesSettings/carriers";
import type { CarrierFacts } from "@/lib/salesSettings/views";
import { hasFeature } from "@/lib/entitlements/types";
import { featureKillState } from "@/lib/features/killSwitch";
import { isTenantSuspended } from "@/lib/tenants/suspension";
import { auditExtension } from "./audit";
import { GRANT_SCOPE } from "./constants";
import {
  bearerToken, checkGrant, grantExpiry, grantStatus, httpsOrigin, REFUSAL_MESSAGE, REFUSAL_STATUS, signGrantToken, signingKey,
  verifyGrantToken, type GrantClaims, type GrantRefusal, type GrantRow,
} from "./token";
import type { CarrierSiteView, GrantView } from "./types";

/**
 * LA-3.12 — extension grants. One grant = one application, one carrier origin, 60 minutes. The
 * token names the grant; the row decides. Every extension request runs `authenticateExtension`,
 * which re-reads the row (revocation), the application (still `ready`), the person (still an owner
 * or producer here) and the agency's entitlement (still has `carrier_extension`).
 */

export const EXTENSION_FEATURE = "carrier_extension";
const GRANT_ROLES = ["owner", "producer"];
const GRANT_COLUMNS = "id, tenant_id, user_id, application_id, carrier_origin, scope, issued_at, expires_at, revoked_at, revoked_reason, field_reads";

type Actor = { tenantId: string; userId: string; role: string; request: Request };
type FullGrantRow = GrantRow & { revoked_reason: string | null; field_reads: number };
type AppHead = { id: string; case_id: string; lead_id: string; attempt_no: number; status: string; carrier_id: string | null; carrier_product_id: string | null };

function fail(error: DbError, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError(what);
  throw new ApplicationError("EXTENSION_UNAVAILABLE", `${what}: ${error?.message ?? "unknown error"}`, 500);
}

function key() {
  const k = signingKey(process.env.EXTENSION_GRANT_SIGNING_KEY);
  if (!k) throw new ApplicationError("EXTENSION_KEY_MISSING", "The browser extension can't be used until EXTENSION_GRANT_SIGNING_KEY (32 characters or more) is set on the server.", 503);
  return k;
}

export async function applicationHead(tenantId: string, applicationId: string): Promise<AppHead> {
  const q = await db().from("tenant_applications").select("id, case_id, lead_id, attempt_no, status, carrier_id, carrier_product_id").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle();
  if (q.error) fail(q.error, "The application record");
  if (!q.data) throw new ApplicationError("APPLICATION_NOT_FOUND", "That application could not be found.", 404);
  return q.data as AppHead;
}

/**
 * The carrier site a grant is bound to: the agency's own portal login URL when it has one
 * (tenant_carrier_portal_accounts, optional table), else the carrier's portal origin.
 */
export async function carrierOriginFor(tenantId: string, carrierId: string): Promise<string | null> {
  const client = db();
  const [portal, carrier, facts] = await Promise.all([
    client.from("tenant_carrier_portal_accounts").select("portal_url").eq("tenant_id", tenantId).eq("carrier_id", carrierId).limit(1),
    client.from("carriers").select("portal_origin").eq("id", carrierId).maybeSingle(),
    // The agency's own portal origin (LA-3.17) outranks the library's.
    effectiveCarrierFacts(tenantId, [carrierId]).catch(() => new Map<string, CarrierFacts>()),
  ]);
  if (portal.error && !isMissingSchema(portal.error)) fail(portal.error, "The carrier portal account");
  if (carrier.error) fail(carrier.error, "The carrier");
  const fromPortal = httpsOrigin(rows<{ portal_url: string | null }>(portal.data)[0]?.portal_url ?? null);
  return fromPortal
    ?? httpsOrigin(facts.get(carrierId)?.portalOrigin ?? null)
    ?? httpsOrigin((carrier.data as { portal_origin: string | null } | null)?.portal_origin ?? null);
}

async function logEvent(row: { tenant_id: string; grant_id: string | null; kind: "granted" | "read" | "rejected" | "revoked" | "expired"; field_key?: string | null; origin?: string | null; status_code?: number | null }) {
  const { error } = await db().from("tenant_extension_events").insert({ ...row, origin: row.origin ? row.origin.slice(0, 300) : null });
  // The event log is evidence, but a failed event must not turn a refusal into a success or vice
  // versa; it is reported and the request goes on being decided by the grant row.
  if (error) console.error("[extension] event log insert failed", row.kind, error.message);
}

// ── mint (session) ─────────────────────────────────────────────────────────

export async function mintGrant(actor: Actor, input: { applicationId: string; carrierId: string }) {
  const signing = key();
  const app = await applicationHead(actor.tenantId, input.applicationId);
  if (app.status !== "ready") throw new ApplicationError("APPLICATION_NOT_READY", "Mark the application ready on the Review step before filling the carrier's form.", 409);
  if (!app.carrier_id || app.carrier_id !== input.carrierId) throw new ApplicationError("CARRIER_MISMATCH", "That carrier is not the one this application is for.", 409);
  const origin = await carrierOriginFor(actor.tenantId, app.carrier_id);
  if (!origin) throw new ApplicationError("CARRIER_ORIGIN_MISSING", "This carrier has no portal address yet. Add it in Settings › Sales › Carriers and products.", 409);

  const client = db();
  // One live grant per person per application: opening a new one ends the old.
  const superseded = await client.from("tenant_extension_grants").update({ revoked_at: new Date().toISOString(), revoked_reason: "superseded" })
    .eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("application_id", app.id).is("revoked_at", null).select("id");
  if (superseded.error) fail(superseded.error, "Extension grants");

  const issuedAt = new Date();
  const expiresAt = grantExpiry(issuedAt);
  const inserted = await client.from("tenant_extension_grants").insert({
    tenant_id: actor.tenantId, user_id: actor.userId, application_id: app.id, carrier_origin: origin, scope: GRANT_SCOPE,
    issued_at: issuedAt.toISOString(), expires_at: expiresAt.toISOString(),
  }).select("id").single();
  if (inserted.error) fail(inserted.error, "Extension grants");
  const grantId = inserted.data.id as string;

  const token = await signGrantToken({ jti: grantId, sub: actor.userId, tenantId: actor.tenantId, applicationId: app.id, origin, scope: GRANT_SCOPE }, signing, issuedAt);
  for (const old of rows<{ id: string }>(superseded.data)) await logEvent({ tenant_id: actor.tenantId, grant_id: old.id, kind: "revoked", origin });
  await logEvent({ tenant_id: actor.tenantId, grant_id: grantId, kind: "granted", origin, status_code: 201 });
  await auditExtension({ actorType: "tenant", actorId: actor.userId, action: "tenant.extension_grant_issued", targetType: "tenant_application", targetId: app.id, metadata: { grantId, origin, caseId: app.case_id, expiresAt: expiresAt.toISOString() }, request: actor.request });
  return { token, grantId, expiresAt: expiresAt.toISOString(), origin, applicationId: app.id };
}

// ── authenticate (bearer) ──────────────────────────────────────────────────

/** A refusal. `allowOrigin` is set only when the caller's origin is the grant's own. */
export class ExtensionRefused extends ApplicationError {
  constructor(public reason: GrantRefusal | "application_not_ready" | "not_entitled" | "member_inactive", message: string, status: number, public allowOrigin: string | null) {
    super(`EXTENSION_${reason.toUpperCase()}`, message, status);
    this.name = "ExtensionRefused";
  }
}

export type ExtensionContext = {
  tenantId: string;
  userId: string;
  grant: FullGrantRow;
  claims: GrantClaims;
  origin: string;
  application: AppHead;
  request: Request;
};

async function memberStillAllowed(tenantId: string, userId: string) {
  const client = db();
  const [membership, user, tenant, entitlement, kill] = await Promise.all([
    client.from("tenant_users").select("role").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
    client.from("users").select("status").eq("id", userId).maybeSingle(),
    client.from("tenants").select("status").eq("id", tenantId).maybeSingle(),
    getEntitlement(tenantId),
    featureKillState(EXTENSION_FEATURE, tenantId),
  ]);
  const role = (membership.data as { role?: string } | null)?.role;
  if (!role || !GRANT_ROLES.includes(role)) return "member_inactive" as const;
  if ((user.data as { status?: string } | null)?.status !== "active") return "member_inactive" as const;
  if (isTenantSuspended((tenant.data as { status?: string } | null)?.status)) return "member_inactive" as const;
  if (kill.killed || !hasFeature(entitlement, EXTENSION_FEATURE)) return "not_entitled" as const;
  return null;
}

/**
 * Every extension request: token → grant row → origin → application → person → entitlement.
 * No session cookie is read. Refusals are logged against the grant when the token is authentic.
 */
export async function authenticateExtension(request: Request, opts: { applicationId?: string | null; fieldKey?: string | null } = {}): Promise<ExtensionContext> {
  const origin = request.headers.get("origin");
  const verified = await verifyGrantToken(bearerToken(request.headers.get("authorization")), key());
  const claims = verified.claims;

  const refuse = async (reason: ExtensionRefused["reason"], row: FullGrantRow | null, status?: number, message?: string): Promise<never> => {
    const code = status ?? (reason in REFUSAL_STATUS ? REFUSAL_STATUS[reason as GrantRefusal] : 403);
    if (claims) await logEvent({ tenant_id: claims.tenantId, grant_id: row?.id ?? null, kind: reason === "expired" ? "expired" : "rejected", field_key: opts.fieldKey ?? null, origin, status_code: code });
    const allow = origin && row && origin === row.carrier_origin ? origin : null;
    throw new ExtensionRefused(reason, message ?? (reason in REFUSAL_MESSAGE ? REFUSAL_MESSAGE[reason as GrantRefusal] : "This grant cannot be used."), code, allow);
  };

  if (!claims) return refuse(verified.ok ? "invalid_token" : verified.reason, null);
  const q = await db().from("tenant_extension_grants").select(GRANT_COLUMNS).eq("tenant_id", claims.tenantId).eq("id", claims.jti).maybeSingle();
  if (q.error) fail(q.error, "Extension grants");
  const row = (q.data as FullGrantRow | null) ?? null;
  if (!verified.ok) return refuse(verified.reason, row);

  const check = checkGrant({ claims, row, origin, applicationId: opts.applicationId });
  if (!check.ok) return refuse(check.reason, row);
  const grant = row!;

  const application = await applicationHead(grant.tenant_id, grant.application_id).catch(() => null);
  if (!application) return refuse("application_mismatch", grant, 404, "That application could not be found.");
  if (application.status !== "ready") return refuse("application_not_ready", grant, 409, "This application is no longer ready to submit. Reopen it in Insurvas.");
  const member = await memberStillAllowed(grant.tenant_id, grant.user_id);
  if (member === "member_inactive") return refuse("member_inactive", grant, 403, "Your Insurvas access has changed. Sign in again and open a new grant.");
  if (member === "not_entitled") return refuse("not_entitled", grant, 403, "The browser extension is not available on your account.");

  return { tenantId: grant.tenant_id, userId: grant.user_id, grant, claims, origin: grant.carrier_origin, application, request };
}

/** Adds to `field_reads` and logs a `read` event. */
export async function recordRead(ctx: ExtensionContext, count: number, fieldKey: string | null) {
  const next = ctx.grant.field_reads + Math.max(0, count);
  const { error } = await db().from("tenant_extension_grants").update({ field_reads: next }).eq("tenant_id", ctx.tenantId).eq("id", ctx.grant.id);
  if (error) console.error("[extension] field_reads update failed", error.message);
  ctx.grant.field_reads = next;
  await logEvent({ tenant_id: ctx.tenantId, grant_id: ctx.grant.id, kind: "read", field_key: fieldKey, origin: ctx.origin, status_code: 200 });
}

// ── CORS ───────────────────────────────────────────────────────────────────

const CORS_BASE = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};

/** Headers for a response to `origin` — the grant's own origin, never `*`. */
export function corsHeaders(origin: string | null): Record<string, string> {
  return origin ? { ...CORS_BASE, "Access-Control-Allow-Origin": origin, "Cache-Control": "no-store" } : { Vary: "Origin", "Cache-Control": "no-store" };
}

export function extensionJson(ctx: Pick<ExtensionContext, "origin">, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(ctx.origin) });
}

export function extensionFailure(error: unknown) {
  if (error instanceof ExtensionRefused) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: corsHeaders(error.allowOrigin) });
  if (error instanceof ApplicationError) return NextResponse.json({ error: error.message, code: error.code, ...(error.code === "SCHEMA_PENDING" ? { schemaPending: true } : {}) }, { status: error.status, headers: corsHeaders(null) });
  console.error("[extension]", error);
  return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500, headers: corsHeaders(null) });
}

/**
 * A preflight carries no Authorization header, so it cannot name its grant. It is answered for an
 * origin that has at least one live grant, and for no other.
 */
export async function preflight(request: Request) {
  const origin = httpsOrigin(request.headers.get("origin"));
  if (!origin || origin !== request.headers.get("origin")) return new Response(null, { status: 204, headers: corsHeaders(null) });
  const live = await db().from("tenant_extension_grants").select("id").eq("carrier_origin", origin).is("revoked_at", null).gt("expires_at", new Date().toISOString()).limit(1);
  const allowed = !live.error && rows(live.data).length > 0;
  const headers = corsHeaders(allowed ? origin : null);
  // Chrome's Private Network Access: a public carrier page calling a local Insurvas (development).
  if (allowed && request.headers.get("access-control-request-private-network") === "true") headers["Access-Control-Allow-Private-Network"] = "true";
  return new Response(null, { status: 204, headers });
}

// ── revoke + list (session) ────────────────────────────────────────────────

export async function revokeGrants(actor: Actor, grantId: string | null) {
  const client = db();
  let query = client.from("tenant_extension_grants").update({ revoked_at: new Date().toISOString(), revoked_reason: grantId ? "revoked_by_user" : "revoked_all_by_owner" })
    .eq("tenant_id", actor.tenantId).is("revoked_at", null).gt("expires_at", new Date().toISOString());
  if (grantId) {
    const one = await client.from("tenant_extension_grants").select("id, user_id").eq("tenant_id", actor.tenantId).eq("id", grantId).maybeSingle();
    if (one.error) fail(one.error, "Extension grants");
    if (!one.data) throw new ApplicationError("GRANT_NOT_FOUND", "That grant could not be found.", 404);
    if (actor.role !== "owner" && one.data.user_id !== actor.userId) throw new ApplicationError("GRANT_NOT_YOURS", "Only an owner can revoke someone else's grant.", 403);
    query = query.eq("id", grantId);
  } else if (actor.role !== "owner") {
    throw new ApplicationError("OWNER_ONLY", "Only an owner can revoke every grant in the agency.", 403);
  }
  const updated = await query.select("id, carrier_origin");
  if (updated.error) fail(updated.error, "Extension grants");
  const revoked = rows<{ id: string; carrier_origin: string }>(updated.data);
  for (const g of revoked) await logEvent({ tenant_id: actor.tenantId, grant_id: g.id, kind: "revoked", origin: g.carrier_origin });
  if (revoked.length) {
    await auditExtension({ actorType: "tenant", actorId: actor.userId, action: "tenant.extension_grants_revoked", targetType: grantId ? "tenant_extension_grant" : "tenant", targetId: grantId ?? actor.tenantId, metadata: { count: revoked.length, grantIds: revoked.map((g) => g.id) }, request: actor.request });
  }
  return { revoked: revoked.length };
}

function leadName(values: Record<string, unknown> | null | undefined) {
  const v = values ?? {};
  const full = typeof v.full_name === "string" ? v.full_name.trim() : "";
  if (full) return full;
  return [v.first_name, v.last_name].filter((x) => typeof x === "string" && x.trim()).join(" ").trim() || "Unnamed client";
}

/** Recent grants (30 days, 200 rows) and the carrier sites the extension may work on. */
export async function listGrantActivity(actor: Actor): Promise<{ grants: GrantView[]; sites: CarrierSiteView[]; canRevokeAll: boolean }> {
  const canRevokeAll = actor.role === "owner";
  const client = db();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  let q = client.from("tenant_extension_grants").select(GRANT_COLUMNS).eq("tenant_id", actor.tenantId).gte("issued_at", since).order("issued_at", { ascending: false }).limit(200);
  if (actor.role !== "owner") q = q.eq("user_id", actor.userId);
  const [grantsQ, sites] = await Promise.all([q, carrierSites(actor.tenantId)]);
  if (grantsQ.error) fail(grantsQ.error, "Extension grants");
  const grants = rows<FullGrantRow>(grantsQ.data);
  if (!grants.length) return { grants: [], sites, canRevokeAll };

  const appIds = [...new Set(grants.map((g) => g.application_id))];
  const apps = await client.from("tenant_applications").select("id, case_id, lead_id, carrier_id").eq("tenant_id", actor.tenantId).in("id", appIds);
  if (apps.error) fail(apps.error, "The application record");
  const appRows = rows<{ id: string; case_id: string; lead_id: string; carrier_id: string | null }>(apps.data);
  const leadIds = [...new Set(appRows.map((a) => a.lead_id))];
  const carrierIds = [...new Set(appRows.map((a) => a.carrier_id).filter((x): x is string => Boolean(x)))];
  const [leads, carriers, subs] = await Promise.all([
    leadIds.length ? client.from("agent_leads").select("id, values").eq("tenant_id", actor.tenantId).in("id", leadIds) : Promise.resolve({ data: [], error: null }),
    carrierIds.length ? client.from("carriers").select("id, name").in("id", carrierIds) : Promise.resolve({ data: [], error: null }),
    client.from("tenant_application_submissions").select("application_id, carrier_reference, submitted_at").eq("tenant_id", actor.tenantId).in("application_id", appIds),
  ]);
  const leadBy = new Map(rows<{ id: string; values: Record<string, unknown> }>(leads.data).map((l) => [l.id, l.values]));
  const carrierBy = new Map(rows<{ id: string; name: string }>(carriers.data).map((c) => [c.id, c.name]));
  const subsRows = subs.error ? [] : rows<{ application_id: string; carrier_reference: string | null; submitted_at: string }>(subs.data);
  const appBy = new Map(appRows.map((a) => [a.id, a]));
  const now = new Date();
  return {
    sites,
    canRevokeAll,
    grants: grants.map((g) => {
      const a = appBy.get(g.application_id);
      const ref = subsRows.filter((s) => s.application_id === g.application_id && s.carrier_reference).sort((x, y) => y.submitted_at.localeCompare(x.submitted_at))[0]?.carrier_reference ?? null;
      return {
        id: g.id, applicationId: g.application_id, caseId: a?.case_id ?? null, clientName: leadName(a ? leadBy.get(a.lead_id) : null), reference: ref,
        carrierName: (a?.carrier_id && carrierBy.get(a.carrier_id)) || "Carrier", origin: g.carrier_origin, issuedAt: g.issued_at, expiresAt: g.expires_at,
        revokedAt: g.revoked_at, fieldsRead: g.field_reads, status: grantStatus(g, now), mine: g.user_id === actor.userId,
      };
    }),
  };
}

/** The agency's carriers with a portal origin — the extension's host allowlist — and their map status. */
export async function carrierSites(tenantId: string): Promise<CarrierSiteView[]> {
  const client = db();
  const contracted = await client.from("tenant_carriers").select("carrier_id, is_active").eq("tenant_id", tenantId);
  if (contracted.error && !isMissingSchema(contracted.error)) fail(contracted.error, "Carriers");
  const ids = [...new Set(rows<{ carrier_id: string; is_active: boolean }>(contracted.data).filter((c) => c.is_active !== false).map((c) => c.carrier_id))];
  if (!ids.length) return [];
  const [carriers, portals, maps, facts] = await Promise.all([
    client.from("carriers").select("id, name, portal_origin").in("id", ids),
    client.from("tenant_carrier_portal_accounts").select("carrier_id, portal_url").eq("tenant_id", tenantId).in("carrier_id", ids),
    client.from("carrier_field_map").select("carrier_id, status, tenant_id, version").in("carrier_id", ids).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
    effectiveCarrierFacts(tenantId, ids).catch(() => new Map<string, CarrierFacts>()),
  ]);
  if (carriers.error) fail(carriers.error, "Carriers");
  const portalBy = new Map((portals.error ? [] : rows<{ carrier_id: string; portal_url: string }>(portals.data)).map((p) => [p.carrier_id, httpsOrigin(p.portal_url)]));
  const mapRows = maps.error ? [] : rows<{ carrier_id: string; status: string }>(maps.data);
  const rank: Record<string, number> = { needs_review: 3, published: 2, draft: 1, in_review: 1 };
  return rows<{ id: string; name: string; portal_origin: string | null }>(carriers.data)
    .map((c) => {
      const origin = portalBy.get(c.id) ?? httpsOrigin(facts.get(c.id)?.portalOrigin ?? null) ?? httpsOrigin(c.portal_origin);
      const best = mapRows.filter((m) => m.carrier_id === c.id && m.status in rank).sort((a, b) => rank[b.status] - rank[a.status])[0]?.status;
      const fieldMap: CarrierSiteView["fieldMap"] = best === "needs_review" ? "needs_review" : best === "published" ? "published" : best ? "draft" : "none";
      return origin ? { carrierId: c.id, name: c.name, origin, fieldMap } : null;
    })
    .filter((x): x is CarrierSiteView => Boolean(x))
    .sort((a, b) => a.name.localeCompare(b.name));
}
