import "server-only";

import { ApplicationError, db, isMissingSchema, rows } from "@/lib/applications/db";

import { carrierSites } from "./grants";
import type { CarrierSiteView } from "./types";

/**
 * Settings round 8 · Browser extension › Who can use it. Every active owner and agent in the agency may
 * open extension grants (setters and intake never can: GRANT_ROLES in ./grants.ts). An owner can take
 * that away from one person, for every carrier site or for one carrier, in
 * tenant_extension_access_block (20261112310000). Before that table exists, nothing is blocked and
 * revoking only ends the person's live grants; the page says the rest needs a database update.
 *
 * The grant mint checks the same table with `extensionBlocked` (./accessCheck.ts), so a revoked person
 * cannot simply open a new grant.
 */

export type ExtensionPerson = {
  id: string;
  name: string;
  role: string;
  /** Revoked for every carrier site. */
  blockedAll: boolean;
  /** Revoked for these carriers only. */
  blockedCarrierIds: string[];
  /** Carrier sites they have filled on in the last 90 days. */
  usedCarrierIds: string[];
  fillsThisMonth: number;
  lastFillAt: string | null;
  firstFillAt: string | null;
  activeGrantIds: string[];
};

export type ExtensionSite = CarrierSiteView & { fillsThisMonth: number };

export type ExtensionPeople = {
  people: ExtensionPerson[];
  sites: ExtensionSite[];
  lastFill: { at: string; name: string } | null;
  /** False until 20261112310000: revoking ends live grants only, and cannot be limited to one carrier. */
  blocksReady: boolean;
};

type BlockRow = { user_id: string; carrier_id: string | null };

async function readBlocks(tenantId: string): Promise<{ ready: boolean; rows: BlockRow[] }> {
  const result = await db().from("tenant_extension_access_block").select("user_id, carrier_id").eq("tenant_id", tenantId);
  if (result.error) {
    if (isMissingSchema(result.error)) return { ready: false, rows: [] };
    throw new ApplicationError("EXTENSION_UNAVAILABLE", `Extension access: ${result.error.message}`, 500);
  }
  return { ready: true, rows: rows<BlockRow>(result.data) };
}

export async function listExtensionPeople(tenantId: string): Promise<ExtensionPeople> {
  const client = db();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [members, grants, sites, blocks] = await Promise.all([
    client.from("tenant_users").select("user_id, role, accepted_at, users!tenant_users_user_id_fkey(id, name, email, status)").eq("tenant_id", tenantId),
    client.from("tenant_extension_grants").select("id, user_id, carrier_origin, issued_at, expires_at, revoked_at").eq("tenant_id", tenantId).gte("issued_at", since).order("issued_at", { ascending: false }).limit(2000),
    carrierSites(tenantId),
    readBlocks(tenantId),
  ]);
  if (members.error) throw new ApplicationError("EXTENSION_UNAVAILABLE", `Team: ${members.error.message}`, 500);
  if (grants.error && !isMissingSchema(grants.error)) throw new ApplicationError("EXTENSION_UNAVAILABLE", `Extension grants: ${grants.error.message}`, 500);

  type Member = { user_id: string; role: string; accepted_at: string | null; users: { id: string; name: string | null; email: string; status: string } | null };
  type Grant = { id: string; user_id: string; carrier_origin: string; issued_at: string; expires_at: string; revoked_at: string | null };
  const grantRows = grants.error ? [] : rows<Grant>(grants.data);
  const carrierByOrigin = new Map(sites.map((site) => [site.origin, site.carrierId]));
  const now = Date.now();
  const nameOf = new Map<string, string>();

  const people: ExtensionPerson[] = rows<Member>(members.data)
    .filter((m) => m.accepted_at && m.users && m.users.status === "active" && (m.role === "owner" || m.role === "producer"))
    .map((m) => {
      const name = m.users?.name?.trim() || m.users?.email || "A teammate";
      nameOf.set(m.user_id, name);
      const mine = grantRows.filter((g) => g.user_id === m.user_id);
      const own = blocks.rows.filter((b) => b.user_id === m.user_id);
      return {
        id: m.user_id,
        name,
        role: m.role,
        blockedAll: own.some((b) => b.carrier_id === null),
        blockedCarrierIds: own.flatMap((b) => (b.carrier_id ? [b.carrier_id] : [])),
        usedCarrierIds: [...new Set(mine.map((g) => carrierByOrigin.get(g.carrier_origin)).filter((id): id is string => Boolean(id)))],
        fillsThisMonth: mine.filter((g) => g.issued_at >= monthStart.toISOString()).length,
        lastFillAt: mine[0]?.issued_at ?? null,
        firstFillAt: mine.at(-1)?.issued_at ?? null,
        activeGrantIds: mine.filter((g) => !g.revoked_at && Date.parse(g.expires_at) > now).map((g) => g.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const latest = grantRows[0];
  return {
    people,
    sites: sites.map((site) => ({ ...site, fillsThisMonth: grantRows.filter((g) => g.carrier_origin === site.origin && g.issued_at >= monthStart.toISOString()).length })),
    lastFill: latest ? { at: latest.issued_at, name: nameOf.get(latest.user_id) ?? "A teammate" } : null,
    blocksReady: blocks.ready,
  };
}

/** Bar a person from the extension (every carrier, or one). Idempotent. Returns false before the table exists. */
export async function blockExtension(tenantId: string, userId: string, carrierId: string | null, actorId: string): Promise<boolean> {
  const client = db();
  const existing = await client.from("tenant_extension_access_block").select("id, carrier_id").eq("tenant_id", tenantId).eq("user_id", userId);
  if (existing.error) {
    if (isMissingSchema(existing.error)) return false;
    throw new ApplicationError("EXTENSION_UNAVAILABLE", `Extension access: ${existing.error.message}`, 500);
  }
  const held = rows<{ id: string; carrier_id: string | null }>(existing.data);
  if (held.some((row) => row.carrier_id === null || row.carrier_id === carrierId)) return true;
  // Barred from every site: the per-carrier rows say nothing more.
  if (carrierId === null && held.length) await client.from("tenant_extension_access_block").delete().eq("tenant_id", tenantId).eq("user_id", userId);
  const inserted = await client.from("tenant_extension_access_block").insert({ tenant_id: tenantId, user_id: userId, carrier_id: carrierId, created_by: actorId });
  if (inserted.error) throw new ApplicationError("EXTENSION_UNAVAILABLE", `Extension access: ${inserted.error.message}`, 500);
  return true;
}

/** Give a person the extension back (every carrier, or one). */
export async function unblockExtension(tenantId: string, userId: string, carrierId: string | null): Promise<boolean> {
  let query = db().from("tenant_extension_access_block").delete().eq("tenant_id", tenantId).eq("user_id", userId);
  if (carrierId) query = query.eq("carrier_id", carrierId);
  const result = await query;
  if (result.error) {
    if (isMissingSchema(result.error)) return false;
    throw new ApplicationError("EXTENSION_UNAVAILABLE", `Extension access: ${result.error.message}`, 500);
  }
  return true;
}
